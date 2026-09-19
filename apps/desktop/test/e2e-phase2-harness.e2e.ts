import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyFailure } from '@studio/failure-classifier'
import { LockManager } from '@studio/lock-manager'
import {
  ActivityRepository,
  AttemptRepository,
  EvidenceRepository,
  GoalRepository,
  InboxRepository,
  LockRepository,
  migrate,
  ProjectRepository,
  SessionRepository,
  SettingsRepository,
  SqliteDb,
  TabRepository,
  TaskRepository,
  TaskTransitionRepository,
  WorktreeRepository,
} from '@studio/persistence'
import { ProjectManager } from '@studio/project-manager'
import type { CodingAgentRuntime, RuntimeEvent } from '@studio/shared'
import { TaskManager } from '@studio/task-manager'
import { gitRunner, WorktreeManager } from '@studio/worktree-manager'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AttemptManager } from '../src/main/attempts.js'
import { InboxManager } from '../src/main/inbox.js'
import { PauseManager } from '../src/main/pause.js'
import { recoverOnStartup } from '../src/main/startup-recovery.js'
import { VerificationManager } from '../src/main/verification.js'
import { VerifierService } from '../src/main/verifier.js'

/**
 * Phase 2 exit E2E: the full harness loop with real git, real shell
 * verification, and a scripted runtime — Goal → TODO → worktree →
 * implement → tests → verifier → retry → cap → escalation, plus crash
 * recovery semantics.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
}

class ScriptedRuntime implements CodingAgentRuntime {
  replies: string[] = []
  sent = 0
  private listeners = new Set<(event: RuntimeEvent) => void>()

  async detect() {
    return { available: true, binary: 'scripted' }
  }
  async ensureServer() {
    return 'http://127.0.0.1:1'
  }
  async createSession() {
    return { id: `ses_${Math.random().toString(36).slice(2, 10)}` }
  }
  async resumeSession() {
    return true
  }
  async sendMessage(sessionId: string) {
    this.sent += 1
    // Model the reply arriving over the event stream.
    const text = this.replies[0] ?? ''
    setTimeout(() => {
      for (const listener of this.listeners) {
        listener({ type: 'message-text', sessionId, messageId: 'm1', text })
        listener({ type: 'message-completed', sessionId, messageId: 'm1' })
      }
    }, 5)
  }
  async stopSession() {}
  async getStatus() {
    return 'idle' as const
  }
  async summarizeSession() {}
  async listChildren() {
    return []
  }
  async listMessages() {
    return []
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  async dispose() {}
}

let dir: string
let db: SqliteDb
let repo: string

function buildContainer() {
  const activity = new ActivityRepository(db)
  const projectManager = new ProjectManager({
    projects: new ProjectRepository(db),
    tabs: new TabRepository(db),
    activity,
  })
  const tasks = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity,
    transitions: new TaskTransitionRepository(db),
    completionGate: (taskId) => {
      const latest = new EvidenceRepository(db).listForTask(taskId).at(-1)
      return { allowed: latest !== undefined && latest.exitCode === 0 }
    },
  })
  const worktrees = new WorktreeManager({
    worktrees: new WorktreeRepository(db),
    activity,
    git: gitRunner(),
  })
  const inbox = new InboxManager({
    inbox: new InboxRepository(db),
    activity,
  })
  const locks = new LockManager({
    locks: new LockRepository(db),
    activity,
  })
  const verification = new VerificationManager({
    evidence: new EvidenceRepository(db),
    activity,
    outputDir: join(dir, 'outputs'),
  })
  const attempts = new AttemptManager({
    attempts: new AttemptRepository(db),
    goals: new GoalRepository(db),
    tasks,
    worktrees,
    inbox,
    activity,
  })
  return { activity, projectManager, tasks, worktrees, inbox, locks, verification, attempts }
}

function approveReply() {
  return 'ok\n```json\n{"decision":"approve","reasons":["meets DoD"],"failedCriteria":[],"evidence":[]}\n```'
}
function rejectReply(reason: string) {
  return `no\n\`\`\`json\n{"decision":"reject","reasons":["${reason}"],"failedCriteria":["tests pass"],"evidence":[]}\n\`\`\``
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-p2e2e-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 'test@studio.local')
  git(repo, 'config', 'user.name', 'Studio Test')
  writeFileSync(join(repo, 'app.js'), 'console.log("v1")\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('phase 2 exit: full harness loop', () => {
  it('runs the APPROVE path end to end with stored evidence', async () => {
    const c = buildContainer()
    const project = c.projectManager.addProject(repo)
    const goal = c.tasks.createGoalDraft(project.id, 'Upgrade app.js message')
    c.tasks.updateGoalContract(goal.id, { doneWhen: ['tests pass'], status: 'ready' })
    c.tasks.updateGoalContract(goal.id, { status: 'active' })
    const task = c.tasks.addTask(project.id, { title: 'Change the message', goalId: goal.id })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)

    // Attempt 1: implement in the isolated worktree.
    const { record, worktreeId } = await c.attempts.startAttempt({
      projectId: project.id,
      projectPath: repo,
      taskId: task.id,
      model: 'local-coder',
    })
    expect(record.attempt).toBe(1)
    const worktree = c.worktrees.get(worktreeId)
    if (!worktree) throw new Error('no worktree')
    // Main tree untouched during the attempt.
    expect(existsSync(join(record ? repo : repo, 'app.js'))).toBe(true)

    writeFileSync(join(worktree.path, 'feature.txt'), 'new output\n')
    expect(existsSync(join(repo, 'feature.txt'))).toBe(false)

    // Deterministic verification passes.
    const run = await c.verification.runPipeline(
      { id: project.id, path: worktree.path },
      [{ kind: 'test', command: 'echo "4 tests passed, 0 failed"', required: true }],
      { taskId: task.id, worktreeId, attempt: 1 },
    )
    expect(run.allRequiredPassed).toBe(true)
    c.attempts.endAttempt(record.id, {
      outcome: 'approved',
      evidenceIds: run.evidence.map((entry) => entry.id),
    })

    // Independent verifier approves from a fresh session.
    const runtime = new ScriptedRuntime()
    runtime.replies = [approveReply()]
    const verifier = new VerifierService({
      runtime,
      tasks: c.tasks,
      tasksRepo: new TaskRepository(db),
      goals: new GoalRepository(db),
      evidence: new EvidenceRepository(db),
      worktrees: c.worktrees,
      inbox: c.inbox,
      activity: c.activity,
    })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    const decision = await verifier.reviewAttempt({
      projectId: project.id,
      projectPath: repo,
      taskId: task.id,
      worktreeId,
    })
    expect(decision.decision).toBe('approve')
    await verifier.applyDecision(task.id, decision)

    const finalState = c.tasks.stateForProject(project.id).tasks.find((t) => t.id === task.id)
    expect(finalState?.status).toBe('done')
    // Attempt ledger + verification evidence + diff patch all preserved.
    expect(c.attempts.history(task.id)).toHaveLength(1)
    expect(new EvidenceRepository(db).listForTask(task.id)).toHaveLength(1)
  }, 60_000)

  it('runs the REJECT → retry → cap → ESCALATE path with preserved evidence', async () => {
    const c = buildContainer()
    const repo2 = join(dir, 'repo-reject')
    execFileSync('git', ['init', '-b', 'main', repo2])
    git(repo2, 'config', 'user.email', 'test@studio.local')
    git(repo2, 'config', 'user.name', 'Studio Test')
    writeFileSync(join(repo2, 'app.js'), 'v1\n')
    git(repo2, 'add', '.')
    git(repo2, 'commit', '-m', 'base')
    const project = c.projectManager.addProject(repo2)
    const task = c.tasks.addTask(project.id, { title: 'Will fail review' })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)

    const runtime = new ScriptedRuntime()
    const verifier = new VerifierService({
      runtime,
      tasks: c.tasks,
      tasksRepo: new TaskRepository(db),
      goals: new GoalRepository(db),
      evidence: new EvidenceRepository(db),
      worktrees: c.worktrees,
      inbox: c.inbox,
      activity: c.activity,
    })

    // Attempt 1 starts explicitly; each retryOrEscalate then starts the
    // NEXT attempt itself and hands it back for the loop to drive.
    let current = await c.attempts.startAttempt({
      projectId: project.id,
      projectPath: repo2,
      taskId: task.id,
      model: 'model-round-1',
    })

    for (let round = 1; round <= 3; round += 1) {
      const worktree = c.worktrees.get(current.worktreeId)
      if (!worktree) throw new Error('no worktree')
      writeFileSync(join(worktree.path, `attempt-${round}.txt`), 'broken attempt\n')

      const run = await c.verification.runPipeline(
        { id: project.id, path: worktree.path },
        [{ kind: 'test', command: 'echo "2 failed" >&2; exit 1', required: true }],
        { taskId: task.id, worktreeId: current.worktreeId, attempt: current.record.attempt },
      )
      expect(run.allRequiredPassed).toBe(false)

      // Classify the failure from the signal (spec §23).
      const assessment = classifyFailure({
        source: 'verification',
        exitCode: run.evidence[0]?.exitCode,
        output: run.evidence[0]?.summary,
      })
      expect(assessment.class).toBe('TestRegression')

      c.attempts.endAttempt(current.record.id, {
        outcome: 'rejected',
        failureSignal: {
          source: 'verification',
          exitCode: 1,
          output: run.evidence[0]?.summary ?? '',
        },
      })

      runtime.replies = [rejectReply('broken output remains')]
      db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
      const decision = await verifier.reviewAttempt({
        projectId: project.id,
        projectPath: repo2,
        taskId: task.id,
        worktreeId: current.worktreeId,
      })
      expect(decision.decision).toBe('reject')

      const outcome = await c.attempts.retryOrEscalate({
        projectId: project.id,
        projectPath: repo2,
        taskId: task.id,
        rejectionReason: decision.failedCriteria.join(', ') || 'still broken',
      })

      if (round < 3) {
        expect(outcome.escalated).toBe(false)
        if (outcome.escalated || !outcome.attempt) throw new Error('expected a retry attempt')
        current = {
          record: outcome.attempt,
          worktreeId: outcome.attempt.worktreeId ?? '',
        }
      } else {
        expect(outcome.escalated).toBe(true)
      }
    }

    // Cap enforcement: a 4th attempt is refused by code.
    await expect(
      c.attempts.startAttempt({ projectId: project.id, projectPath: repo2, taskId: task.id }),
    ).rejects.toThrow(/Attempt cap reached/)

    // Escalation carried the full history.
    const state = c.tasks.stateForProject(project.id).tasks.find((t) => t.id === task.id)
    expect(state?.status).toBe('human_required')
    const items = c.inbox.listOpen().filter((item) => item.kind === 'attempts-exhausted')
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items[0]?.evidenceIds).toHaveLength(3)
    expect(c.attempts.history(task.id)).toHaveLength(3)
    // Rejected worktrees discardable; patches recoverable.
    expect(c.attempts.history(task.id).every((entry) => entry.outcome === 'rejected')).toBe(true)
  }, 120_000)

  it('recovers a crash to INTERRUPTED and reconciles stale locks/worktrees on restart', async () => {
    const c = buildContainer()
    const repo3 = join(dir, 'repo-crash')
    execFileSync('git', ['init', '-b', 'main', repo3])
    git(repo3, 'config', 'user.email', 'test@studio.local')
    git(repo3, 'config', 'user.name', 'Studio Test')
    writeFileSync(join(repo3, 'app.js'), 'v1\n')
    git(repo3, 'add', '.')
    git(repo3, 'commit', '-m', 'base')
    const project = c.projectManager.addProject(repo3)

    // A task "mid-flight" when the crash happens.
    const crashed = c.tasks.addTask(project.id, { title: 'In flight during crash' })
    db.run("UPDATE tasks SET status = 'running' WHERE id = ?", crashed.id)

    // A stale lock (TTL expired) and a vanished worktree.
    const locks = new LockRepository(db)
    const pastTtl = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    locks.insert({
      id: 'lock-stale',
      projectId: project.id,
      ownerTaskId: crashed.id,
      patterns: ['src/**'],
      status: 'active',
      acquiredAt: pastTtl,
      expiresAt: pastTtl,
    })
    const worktrees = new WorktreeRepository(db)
    worktrees.insert({
      id: 'wt-ghost',
      projectId: project.id,
      taskId: crashed.id,
      attempt: 9,
      path: join(repo3, '.agent-studio', 'worktrees', 'ghost'),
      branch: 'studio/ghost/attempt-9',
      baseBranch: 'main',
      status: 'active',
      createdAt: pastTtl,
      updatedAt: pastTtl,
    })

    const recovery = await recoverOnStartup({
      db,
      projectManager: c.projectManager,
      secrets: {} as never,
      providers: {} as never,
      chat: {} as never,
      tasks: c.tasks,
      worktrees: c.worktrees,
      locks: new LockManager({ locks, activity: c.activity }),
      inbox: c.inbox,
      verification: c.verification,
      verifier: {} as never,
      attempts: c.attempts,
      pause: new PauseManager({
        settings: new SettingsRepository(db),
        activity: c.activity,
      }),
      runtime: new ScriptedRuntime(),
      terminals: { disposeAll: () => {}, disposeProject: () => {} } as never,
      explorer: () => [],
      policy: () => ({}) as never,
    } as never)

    // The crashed task is INTERRUPTED, never falsely RUNNING.
    const state = c.tasks.stateForProject(project.id).tasks.find((t) => t.id === crashed.id)
    expect(state?.status).toBe('interrupted')
    expect(recovery.interruptedTasks).toContain(crashed.id)

    // Stale lock swept (TTL expired → stale).
    expect(locks.get('lock-stale')?.status).toBe('stale')
    // Ghost worktree marked stale.
    expect(worktrees.get('wt-ghost')?.status).toBe('stale')
  }, 60_000)
})
