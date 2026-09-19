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
