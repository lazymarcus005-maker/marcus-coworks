/**
 * Task/run status (spec §12.3 + §14). The run machine is
 * CREATED → PLANNING → READY → RUNNING → TESTING → VERIFYING →
 * (APPROVED) DONE | (REJECTED) RETRY | (ESCALATE) HUMAN_REQUIRED with
 * CANCELLED, FAILED, INTERRUPTED as terminal/recoverable states. The
 * pending/in_progress/blocked/waiting members are the v1 statuses still
 * produced by the OpenCode TODO sync and quick manual actions.
 */
export type TaskStatus =
  | 'created'
  | 'planning'
  | 'ready'
  | 'running'
  | 'testing'
  | 'verifying'
  | 'rejected'
  | 'retry'
  | 'human_required'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'waiting'

/** One persisted, auditable task state transition (spec §14). */
export type TaskTransition = {
  id: string
  taskId: string
  from: TaskStatus
  to: TaskStatus
  reason?: string
  at: string
}

export type HarnessTask = {
  id: string
  projectId: string
  goalId?: string
  title: string
  description?: string
  status: TaskStatus
  /** Where the task came from: manual user input or the OpenCode TODO stream. */
  source: 'user' | 'opencode'
  createdAt: string
  updatedAt: string
}

/**
 * Goal Contract (spec §13): objective, scope, non-goals, constraints,
 * Definition of Done, risk, attempt cap, and allowed autonomy.
 */
export type GoalRisk = 'low' | 'medium' | 'high'

export type GoalStatus = 'draft' | 'ready' | 'active' | 'done' | 'cancelled'

export type GoalContract = {
  id: string
  projectId: string
  objective: string
  /** Path globs / areas the goal may touch, e.g. src/Auth/**. */
  scope: string[]
  nonGoals: string[]
  constraints: string[]
  /** Definition of Done: criteria that must all hold. */
  doneWhen: string[]
  risk: GoalRisk
  maxAttempts: number
  /** Autonomy level label; levels become mechanical in a later ticket. */
  autonomy?: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
}

/** A todo item as reported by the runtime's TODO stream. */
export type RuntimeTodo = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}
