import type { ActivityRepository, AttemptRepository, GoalRepository } from '@studio/persistence'
import type { AttemptOutcome, AttemptRecord } from '@studio/shared'
import type { TaskManager } from '@studio/task-manager'
import type { WorktreeManager } from '@studio/worktree-manager'
import type { InboxManager } from './inbox.js'

export const DEFAULT_MAX_ATTEMPTS = 3

export interface AttemptManagerDeps {
  attempts: AttemptRepository
  goals: GoalRepository
  tasks: TaskManager
  worktrees: WorktreeManager
  inbox: InboxManager
  activity: ActivityRepository
  /** Per-project policy attempt ceiling (already policy-sanitized). */
  policyMaxAttempts?: (projectId: string) => number
  now?: () => Date
  newId?: () => string
}

/**
 * Attempt ledger + retry orchestration (spec §17 / P2.3).
 *
 * The cap is mechanical: maxAttempts comes from the goal contract (user
 * settable only while draft) clamped by project policy. No agent, model,
 * or decision-engine output can raise it — attempts flow exclusively
 * through startAttempt, which refuses to exceed the cap.
 */
export class AttemptManager {
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: AttemptManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /** The effective cap for a task: goal contract clamped by policy. */
  capFor(task: { projectId: string; goalId?: string }): number {
    const policyCap = this.deps.policyMaxAttempts?.(task.projectId) ?? DEFAULT_MAX_ATTEMPTS
    const goalCap = task.goalId
      ? (this.deps.goals.get(task.goalId)?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
      : DEFAULT_MAX_ATTEMPTS
    return Math.min(goalCap, policyCap)
  }

  attemptsUsed(taskId: string): number {
    return this.deps.attempts.maxAttemptFor(taskId)
  }

  history(taskId: string): AttemptRecord[] {
    return this.deps.attempts.listForTask(taskId)
  }

  /**
   * Starts the next attempt for a task: enforces the cap, creates the
   * isolated worktree, and moves the task into running.
   */
  async startAttempt(input: {
    projectId: string
    projectPath: string
    taskId: string
    agentId?: string
    model?: string
  }): Promise<{ record: AttemptRecord; worktreeId: string }> {
    const task = this.deps.tasks
      .stateForProject(input.projectId)
      .tasks.find((entry) => entry.id === input.taskId)
    if (!task) throw new Error(`Task not found: ${input.taskId}`)

    const cap = this.capFor(task)
    const used = this.attemptsUsed(input.taskId)
    if (used >= cap) {
      throw new Error(
        `Attempt cap reached: ${used}/${cap} attempts used for task ${input.taskId}. Human required.`,
      )
    }

    // The task must be in a state that can start running (retry, ready,
    // planning, or the v1 pending/in_progress entries).
    if (task.status === 'human_required') {
      throw new Error('Task is waiting for a human decision; approve it in the inbox first')
    }

    // Idempotency against external effects: a worktree for this exact
    // task/attempt is reused, never duplicated.
    const nextAttempt = used + 1
    const worktree = await this.deps.worktrees.createForAttempt(
      { id: input.projectId, path: input.projectPath },
      input.taskId,
      nextAttempt,
    )

    const at = this.now().toISOString()
    const record: AttemptRecord = {
      id: this.newId(),
      taskId: input.taskId,
      projectId: input.projectId,
      attempt: nextAttempt,
      agentId: input.agentId,
      model: input.model,
      worktreeId: worktree.id,
      startedAt: at,
      evidenceIds: [],
    }
    this.deps.attempts.insert(record)
    this.deps.activity.record('attempt.started', `Attempt ${nextAttempt}/${cap} started`, {
      projectId: input.projectId,
      payload: { taskId: input.taskId, attempt: nextAttempt, cap, worktreeId: worktree.id },
    })

    // Transition into running where the machine allows (retry → running,
    // ready → running, planning → ready → running is left to the caller).
    if (task.status === 'ready' || task.status === 'retry') {
      this.deps.tasks.applyTransition(input.taskId, 'running', `attempt ${nextAttempt} started`)
    }

    return { record, worktreeId: worktree.id }
  }

  /** Ends an attempt with its outcome and evidence links. */
  endAttempt(
    attemptId: string,
    input: {
      outcome: AttemptOutcome
      failureClass?: string
      summary?: string
      evidenceIds?: string[]
    },
  ): AttemptRecord {
    const record = this.deps.attempts.get(attemptId)
    if (!record) throw new Error(`Attempt not found: ${attemptId}`)
    if (record.endedAt) throw new Error(`Attempt already ended (${record.outcome ?? 'unknown'})`)

    this.deps.attempts.end(attemptId, input, this.now().toISOString())
    this.deps.activity.record('attempt.ended', `Attempt ${record.attempt} ${input.outcome}`, {
      projectId: record.projectId,
      payload: {
        taskId: record.taskId,
        attempt: record.attempt,
        outcome: input.outcome,
        failureClass: input.failureClass,
      },
    })
    const updated = this.deps.attempts.get(attemptId)
    if (!updated) throw new Error('Attempt disappeared')
    return updated
  }

  /**
   * The retry loop (spec §17): after a rejection, either start the next
   * attempt or — at the cap — flip the task to HUMAN_REQUIRED and
   * escalate with the full preserved history.
   */
  async retryOrEscalate(input: {
    projectId: string
    projectPath: string
    taskId: string
    rejectionReason?: string
  }): Promise<{ escalated: boolean; attempt?: AttemptRecord }> {
    const task = this.deps.tasks
      .stateForProject(input.projectId)
      .tasks.find((entry) => entry.id === input.taskId)
    if (!task) throw new Error(`Task not found: ${input.taskId}`)

    const cap = this.capFor(task)
    const used = this.attemptsUsed(input.taskId)

    if (used >= cap) {
      // Hard cap: preserve everything, hand off to the human.
      if (task.status !== 'human_required') {
        this.deps.tasks.applyTransition(
          input.taskId,
          'human_required',
          `attempt cap ${cap}/${cap} reached`,
        )
      }
      this.deps.inbox.escalate({
        projectId: input.projectId,
        taskId: input.taskId,
        goalId: task.goalId,
        kind: 'attempts-exhausted',
        title: `Task ${input.taskId}: all ${cap} attempts exhausted`,
        detail: [
          input.rejectionReason ?? 'Last attempt did not pass.',
          'Preserved: failure reasons, diffs (patch files), verification evidence, attempt history.',
        ].join(' '),
        evidenceIds: this.history(input.taskId).map((entry) => entry.id),
      })
      return { escalated: true }
    }

    if (task.status === 'verifying') {
      this.deps.tasks.applyTransition(input.taskId, 'rejected', input.rejectionReason)
      this.deps.tasks.applyTransition(input.taskId, 'retry')
    } else if (task.status === 'rejected') {
      this.deps.tasks.applyTransition(input.taskId, 'retry')
    }

    const { record } = await this.startAttempt({
      projectId: input.projectId,
      projectPath: input.projectPath,
      taskId: input.taskId,
    })
    return { escalated: false, attempt: record }
  }
}
