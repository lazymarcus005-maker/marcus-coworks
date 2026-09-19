/** Attempt ledger domain (spec §17). */
export type AttemptOutcome = 'approved' | 'rejected' | 'failed' | 'escalated' | 'cancelled'

export type AttemptRecord = {
  id: string
  taskId: string
  projectId: string
  /** 1-based attempt number for the task. */
  attempt: number
  agentId?: string
  model?: string
  worktreeId?: string
  startedAt: string
  endedAt?: string
  outcome?: AttemptOutcome
  failureClass?: string
  summary?: string
  evidenceIds: string[]
}
