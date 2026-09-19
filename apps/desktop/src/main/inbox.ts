import type { ActivityRepository, InboxRepository } from '@studio/persistence'
import type { InboxDecision, InboxItem, InboxItemKind } from '@studio/shared'

export interface InboxManagerDeps {
  inbox: InboxRepository
  activity: ActivityRepository
  /** Applies a machine transition when an approval resumes a task. */
  applyTaskTransition?: (taskId: string, to: 'running', reason: string) => void
  /** Notifies the user of escalations (P4.8 notification policy). */
  notify?: (title: string, body: string) => void
  now?: () => Date
  newId?: () => string
}

/**
 * Human Inbox (spec §22): one shared escalation queue. Any harness
 * component raises items through `escalate`; policy ASK items, attempt
 * exhaustion, verifier rejections, and lock conflicts all land here.
 */
export class InboxManager {
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: InboxManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /** The generic escalation API for all harness components. */
  escalate(input: {
    projectId?: string
    taskId?: string
    goalId?: string
    kind: InboxItemKind
    title: string
    detail?: string
    evidenceIds?: string[]
  }): InboxItem {
    const item: InboxItem = {
      id: this.newId(),
      projectId: input.projectId,
      taskId: input.taskId,
      goalId: input.goalId,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      evidenceIds: input.evidenceIds ?? [],
      status: 'open',
      createdAt: this.now().toISOString(),
    }
    this.deps.inbox.insert(item)
    this.deps.activity.record('inbox.escalated', `Escalated: ${input.title}`, {
      projectId: input.projectId,
      payload: { itemId: item.id, kind: item.kind, taskId: input.taskId },
    })
    this.deps.notify?.(`Agent Studio: ${input.kind}`, input.title)
    return item
  }

  listOpen(): InboxItem[] {
    return this.deps.inbox.list('open')
  }

  listResolved(): InboxItem[] {
    return this.deps.inbox.list('resolved')
  }

  /**
   * Resolves an item. Approving a task-linked item resumes the blocked
   * run through the task machine via applyTaskTransition.
   */
  async resolve(input: {
    itemId: string
    decision: InboxDecision
    note?: string
    /** Resume the linked task on approve (default true). */
    resumeTask?: boolean
  }): Promise<{ item: InboxItem; taskResumed: boolean }> {
    const item = this.deps.inbox.get(input.itemId)
    if (!item) throw new Error(`Inbox item not found: ${input.itemId}`)
    if (item.status !== 'open') {
      throw new Error(`Inbox item already resolved (${item.decision ?? 'unknown'})`)
    }

    const at = this.now().toISOString()
    const resolved = this.deps.inbox.resolve(input.itemId, input.decision, at)
    this.deps.activity.record('inbox.resolved', `${input.decision}: ${item.title}`, {
      projectId: item.projectId,
      payload: { itemId: item.id, decision: input.decision, note: input.note },
    })

    let taskResumed = false
    const shouldResume = input.decision === 'approve' && item.taskId && input.resumeTask !== false
    if (shouldResume && item.taskId && this.deps.applyTaskTransition) {
      this.deps.applyTaskTransition(
        item.taskId,
        'running',
        `approved via inbox (${input.note ?? item.title})`,
      )
      taskResumed = true
    }

    return { item: resolved, taskResumed }
  }
}
