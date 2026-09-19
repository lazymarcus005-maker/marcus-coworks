/** Human Inbox / escalation queue domain (spec §22). */
export type InboxItemKind =
  | 'approval-required'
  | 'attempts-exhausted'
  | 'protected-path'
  | 'ambiguous-goal'
  | 'verifier-rejected'
  | 'lock-conflict'
  | 'security-sensitive'
  | 'budget-extension'
  | 'destructive-action'
  | 'other'

export type InboxItemStatus = 'open' | 'resolved'

export type InboxDecision = 'approve' | 'reject' | 'dismiss'

export type InboxItem = {
  id: string
  projectId?: string
  taskId?: string
  goalId?: string
  kind: InboxItemKind
  title: string
  detail?: string
  /** Identifiers (evidence ids, activity ids) backing the item. */
  evidenceIds: string[]
  status: InboxItemStatus
  decision?: InboxDecision
  decidedAt?: string
  createdAt: string
}
