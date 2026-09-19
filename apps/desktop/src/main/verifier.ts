import type {
  ActivityRepository,
  EvidenceRepository,
  GoalRepository,
  TaskRepository,
  TaskTransitionRepository,
} from '@studio/persistence'
import type {
  ChatMessage,
  CodingAgentRuntime,
  VerificationEvidence,
  VerifierDecision,
} from '@studio/shared'
import type { TaskManager } from '@studio/task-manager'
import type { WorktreeManager } from '@studio/worktree-manager'
import type { InboxManager } from './inbox.js'

export type { VerifierDecision }

type VerificationDecision = VerifierDecision

export interface VerifierServiceDeps {
  runtime: CodingAgentRuntime
  tasks: TaskManager
  tasksRepo: TaskRepository
  goals: GoalRepository
  evidence: EvidenceRepository
  worktrees: WorktreeManager
  inbox: InboxManager
  activity: ActivityRepository
  transitions?: TaskTransitionRepository
  /** Await the verifier's reply, collecting assistant text. */
  awaitReply?: (
    runtime: CodingAgentRuntime,
    sessionId: string,
    timeoutMs: number,
  ) => Promise<string>
  now?: () => Date
  newId?: () => string
  replyTimeoutMs?: number
}

/** Extracts the JSON decision block from a verifier reply. */
export function parseDecision(
  text: string,
): Omit<VerificationDecision, 'verifierSessionId'> | null {
  const match = text.match(/```json\s*([\s\S]*?)```/)
  const raw = match?.[1] ?? extractLooseJson(text)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      decision?: string
      reasons?: unknown
      failedCriteria?: unknown
      evidence?: unknown
    }
    if (
      parsed.decision !== 'approve' &&
      parsed.decision !== 'reject' &&
      parsed.decision !== 'human_required'
    ) {
      return null
    }
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((entry) => String(entry)) : []
    return {
      decision: parsed.decision,
      reasons: strings(parsed.reasons),
      failedCriteria: strings(parsed.failedCriteria),
      evidence: strings(parsed.evidence),
    }
  } catch {
    return null
  }
}

function extractLooseJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

/** Default reply awaiter: resolves on the session's first completed assistant message. */
function defaultAwaitReply(
  runtime: CodingAgentRuntime,
  sessionId: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    let done = false
    const unsubscribe = runtime.subscribe((event) => {
      if (done) return
      if (event.type === 'message-text' && event.sessionId === sessionId) {
        text = event.text
        return
      }
      if (event.type === 'message-completed' && event.sessionId === sessionId) {
        done = true
        unsubscribe()
        if (event.error) {
          reject(new Error(`verifier session error: ${event.error}`))
          return
        }
        resolve(text)
      }
    })
    setTimeout(() => {
      if (!done) {
        done = true
        unsubscribe()
        reject(new Error(`verifier reply timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)
  })
}

/**
 * Independent verifier (spec §15 / P2.8): a fresh child session reviews
 * the diff and deterministic evidence and returns a structured decision.
 * The implementer cannot self-approve: the decision must originate from
 * the verifier session (enforced by session identity) and any file
 * mutation by the verifier invalidates the review (read-only policy,
 * checked mechanically via the worktree).
 */
export class VerifierService {
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly awaitReply: (
    runtime: CodingAgentRuntime,
    sessionId: string,
    timeoutMs: number,
  ) => Promise<string>

  constructor(private readonly deps: VerifierServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
    this.awaitReply = deps.awaitReply ?? defaultAwaitReply
  }

  async reviewAttempt(input: {
    projectId: string
    projectPath: string
    taskId: string
    worktreeId: string
    implementerSessionId?: string
  }): Promise<VerificationDecision> {
    const worktree = this.deps.worktrees.get(input.worktreeId)
    if (!worktree) throw new Error(`Worktree not found: ${input.worktreeId}`)

    // Fresh child session — never reuse the implementer's session.
    const session = await this.deps.runtime.createSession(
      input.projectPath,
      `verifier ${worktree.branch}`,
    )
    if (input.implementerSessionId && session.id === input.implementerSessionId) {
      throw new Error('verifier session must differ from the implementer session')
    }

    const goal = this.openGoal(input.projectId)
    const diff = await this.deps.worktrees.captureDiff(worktree, input.projectPath)
    // Baseline AFTER the harness captures the diff (its git add -N changes
    // porcelain output) and BEFORE the verifier acts: any fingerprint change
    // from here is the verifier's doing.
    const baseline = await this.deps.worktrees.statusFingerprint(worktree)
    const evidence = this.deps.evidence.listForTask(input.taskId)

    const prompt = buildVerifierPrompt({
      objective: goal?.objective,
      doneWhen: goal?.doneWhen ?? [],
      diff: diff.patch,
      evidence,
    })

    await this.deps.runtime.sendMessage(session.id, prompt, { directory: input.projectPath })
    const reply = await this.awaitReply(
      this.deps.runtime,
      session.id,
      this.deps.replyTimeoutMs ?? 5 * 60 * 1000,
    )

    // Read-only policy, checked mechanically: the verifier must not have
    // modified the worktree under review relative to the baseline.
    if ((await this.deps.worktrees.statusFingerprint(worktree)) !== baseline) {
      this.deps.inbox.escalate({
        projectId: input.projectId,
        taskId: input.taskId,
        kind: 'security-sensitive',
        title: 'Verifier modified the worktree under review',
        detail: `Verifier session ${session.id} changed files during verification; review invalidated.`,
        evidenceIds: [worktree.id],
      })
      throw new Error('verifier violated the read-only policy; review invalidated')
    }

    const parsed = parseDecision(reply)
    if (!parsed) {
      // Fail-safe: an unparseable review cannot approve.
      const decision: VerificationDecision = {
        decision: 'human_required',
        reasons: ['Verifier reply was not a structured decision; human review needed'],
        failedCriteria: [],
        evidence: [reply.slice(0, 500)],
        verifierSessionId: session.id,
      }
      this.record(input, decision, reply)
      return decision
    }

    const decision: VerificationDecision = { ...parsed, verifierSessionId: session.id }
    this.record(input, decision, reply)
    return decision
  }

  private openGoal(projectId: string) {
    return this.deps.goals.openForProject(projectId)
  }

  private record(
    input: { projectId: string; taskId: string },
    decision: VerificationDecision,
    reply: string,
  ): void {
    this.deps.activity.record('verifier.decision', `Verifier ${decision.decision}`, {
      projectId: input.projectId,
      payload: {
        taskId: input.taskId,
        decision: decision.decision,
        reasons: decision.reasons,
        failedCriteria: decision.failedCriteria,
        verifierSessionId: decision.verifierSessionId,
      },
    })

    // Rejection routes to the retry loop; human_required escalates.
    const message = JSON.stringify({
      decision: decision.decision,
      reasons: decision.reasons,
      failedCriteria: decision.failedCriteria,
    })
    if (decision.decision === 'reject') {
      this.deps.inbox.escalate({
        projectId: input.projectId,
        taskId: input.taskId,
        kind: 'verifier-rejected',
        title: `Verifier rejected task ${input.taskId}`,
        detail: decision.reasons.join('; ') || 'No reasons given',
        evidenceIds: [message.slice(0, 100)],
      })
    } else if (decision.decision === 'human_required') {
      this.deps.inbox.escalate({
        projectId: input.projectId,
        taskId: input.taskId,
        kind: 'ambiguous-goal',
        title: `Verifier escalated task ${input.taskId}`,
        detail: decision.reasons.join('; ') || 'Verifier requested human review',
        evidenceIds: [],
      })
    }
    void reply
  }

  /** Applies the decision to the task through the state machine. */
  async applyDecision(
    taskId: string,
    decision: VerificationDecision,
  ): Promise<'done' | 'rejected' | 'human_required'> {
    if (decision.decision === 'approve') {
      // The completion gate still requires deterministic evidence; the
      // verifier approving only unblocks the transition.
      const done = this.deps.tasks.applyTransition(
        taskId,
        'done',
        `verifier approved (${decision.verifierSessionId})`,
      )
      return 'done'
    }
    if (decision.decision === 'reject') {
      this.deps.tasks.applyTransition(
        taskId,
        'rejected',
        `verifier rejected: ${decision.failedCriteria.join('; ') || decision.reasons.join('; ')}`,
      )
      return 'rejected'
    }
    this.deps.tasks.applyTransition(taskId, 'human_required', 'verifier requested human review')
    return 'human_required'
  }
}

export function buildVerifierPrompt(input: {
  objective?: string
  doneWhen: string[]
  diff: string
  evidence: VerificationEvidence[]
}): string {
  const evidenceBlock = input.evidence.length
    ? input.evidence
        .map(
          (entry) =>
            `- [${entry.kind}] exit ${entry.exitCode}${entry.failed !== undefined ? `, ${entry.failed} failed` : ''}: ${entry.command}`,
        )
        .join('\n')
    : '- (no deterministic evidence recorded)'

  return `You are an INDEPENDENT VERIFIER. You review a change; you must NOT edit any files.

Objective: ${input.objective ?? '(none provided)'}
Definition of Done:
${input.doneWhen.map((criterion) => `- ${criterion}`).join('\n') || '- (none specified)'}

Deterministic checks:
${evidenceBlock}

Diff under review:
\`\`\`diff
${input.diff.slice(0, 60_000) || '(empty diff)'}
\`\`\`

Review the diff against the objective and Definition of Done. Reply with
a short assessment followed by EXACTLY one json code block:

\`\`\`json
{
  "decision": "approve" | "reject" | "human_required",
  "reasons": ["..."],
  "failedCriteria": ["..."],
  "evidence": ["..."]
}
\`\`\`
`
}
