/**
 * Task/TODO domain (spec §12) — durable execution state, v1 status set.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'cancelled'

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
 * Goal summary for v1: objective + draft state. The full Goal Contract
 * (scope, done_when, risk, autonomy, …) arrives with its phase-2 ticket.
 */
export type GoalSummary = {
  id: string
  projectId: string
  objective: string
  status: 'draft' | 'active' | 'done' | 'cancelled'
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
