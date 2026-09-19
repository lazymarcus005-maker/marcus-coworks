import type {
  ActivityRepository,
  GoalRepository,
  TaskRepository,
  TaskTransitionRepository,
} from '@studio/persistence'
import type {
  GoalContract,
  GoalRisk,
  GoalStatus,
  HarnessTask,
  RuntimeTodo,
  TaskStatus,
  TaskTransition,
} from '@studio/shared'

export class TaskManagerError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Full task/run transition table (spec §14). The run backbone is
 * created → planning → ready → running → testing → verifying with
 * verifying branching to done (approved), rejected (retry loop), and
 * human_required (escalation). failed is terminal; interrupted is
 * recoverable. The pending/in_progress/blocked/waiting members cover
 * the v1 quick statuses still produced by TODO sync and manual actions.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  created: ['planning', 'ready', 'cancelled'],
  planning: ['ready', 'created', 'cancelled'],
  ready: ['running', 'planning', 'cancelled'],
  running: ['testing', 'waiting', 'failed', 'interrupted', 'cancelled'],
  testing: ['verifying', 'running', 'failed', 'interrupted', 'cancelled'],
  verifying: ['done', 'rejected', 'human_required', 'failed', 'interrupted', 'cancelled'],
  rejected: ['retry', 'cancelled'],
  retry: ['running', 'planning', 'cancelled'],
  human_required: ['running', 'rejected', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
  interrupted: ['running', 'planning', 'cancelled'],
  pending: ['in_progress', 'planning', 'blocked', 'done', 'cancelled'],
  in_progress: [
    'pending',
    'testing',
    'verifying',
    'blocked',
    'done',
    'failed',
    'interrupted',
    'cancelled',
  ],
  blocked: ['pending', 'in_progress', 'cancelled'],
  waiting: ['running', 'cancelled'],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Goal lifecycle (spec §13): draft → ready → active → done, with
 * cancelled reachable from any non-terminal state. done/cancelled are
 * terminal.
 */
const GOAL_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['draft', 'active', 'cancelled'],
  active: ['done', 'cancelled'],
  done: [],
  cancelled: [],
}

export function canTransitionGoal(from: GoalStatus, to: GoalStatus): boolean {
  return (GOAL_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Heuristic for "substantial request" (spec §12.4): long or multi-line
 * requests get a Goal draft + initial task container.
 */
export function isSubstantialRequest(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length >= 100) return true
  return trimmed.includes('\n') && trimmed.length >= 40
}

export interface TaskManagerDeps {
  tasks: TaskRepository
  goals: GoalRepository
  activity: ActivityRepository
  transitions?: TaskTransitionRepository
  now?: () => Date
  newId?: () => string
}

/** OpenCode todo ids are namespaced to keep them stable across syncs. */
export function openCodeTaskId(todoId: string): string {
  return `oc:${todoId}`
}

const TODO_STATUS_MAP: Record<string, TaskStatus> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'done',
  cancelled: 'cancelled',
}

/**
 * Durable Task/TODO store (spec §12): user-managed tasks plus tasks synced
 * from the runtime's native TODO stream — one system, not two.
 */
export class TaskManager {
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: TaskManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  stateForProject(projectId: string): { goal?: GoalContract; tasks: HarnessTask[] } {
    return {
      goal: this.deps.goals.openForProject(projectId),
      tasks: this.deps.tasks.listForProject(projectId),
    }
  }

  /** Creates the project's open goal draft, or returns the existing one. */
  createGoalDraft(projectId: string, objective: string): GoalContract {
    const trimmed = objective.trim()
    if (trimmed === '') throw new TaskManagerError('Goal objective cannot be empty')

    const existing = this.deps.goals.openForProject(projectId)
    if (existing) return existing

    const at = this.now().toISOString()
    const goal: GoalContract = {
      id: this.newId(),
      projectId,
      objective: trimmed,
      scope: [],
      nonGoals: [],
      constraints: [],
      doneWhen: [],
      risk: 'medium',
      maxAttempts: 3,
      status: 'draft',
      createdAt: at,
      updatedAt: at,
    }
    this.deps.goals.insert(goal)
    this.deps.activity.record('goal.created', 'Goal draft created', {
      projectId,
      payload: { goalId: goal.id, objective: trimmed.slice(0, 200) },
    })
    return goal
  }

  updateGoalObjective(goalId: string, objective: string): GoalContract {
    const goal = this.deps.goals.get(goalId)
    if (!goal) throw new TaskManagerError('Goal not found')
    const trimmed = objective.trim()
    if (trimmed === '') throw new TaskManagerError('Goal objective cannot be empty')
    this.deps.goals.updateObjective(goalId, trimmed, this.now().toISOString())
    return { ...goal, objective: trimmed }
  }

  /**
   * Updates the full Goal Contract. Contract fields are freely editable
   * while the goal is a draft; once ready/active only the objective and
   * autonomy may change (scope/DoD changes mid-run need a new goal).
   */
  updateGoalContract(
    goalId: string,
    patch: {
      objective?: string
      scope?: string[]
      nonGoals?: string[]
      constraints?: string[]
      doneWhen?: string[]
      risk?: GoalRisk
      maxAttempts?: number
      autonomy?: string
      status?: GoalStatus
    },
  ): GoalContract {
    const goal = this.deps.goals.get(goalId)
    if (!goal) throw new TaskManagerError('Goal not found')

    if (patch.objective !== undefined && patch.objective.trim() === '') {
      throw new TaskManagerError('Goal objective cannot be empty')
    }
    if (patch.maxAttempts !== undefined) {
      if (!Number.isInteger(patch.maxAttempts) || patch.maxAttempts < 1 || patch.maxAttempts > 10) {
        throw new TaskManagerError('maxAttempts must be an integer between 1 and 10')
      }
    }
    if (patch.status !== undefined && patch.status !== goal.status) {
      if (!canTransitionGoal(goal.status, patch.status)) {
        throw new TaskManagerError(`Invalid goal transition: ${goal.status} → ${patch.status}`)
      }
    }

    const locked = goal.status === 'ready' || goal.status === 'active'
    const structural: (keyof typeof patch)[] = [
      'scope',
      'nonGoals',
      'constraints',
      'doneWhen',
      'risk',
      'maxAttempts',
    ]
    if (locked) {
      for (const field of structural) {
        if (patch[field] !== undefined) {
          throw new TaskManagerError(
            `Goal field ${String(field)} is locked while ${goal.status}; move the goal back to draft or start a new goal`,
          )
        }
      }
    }

    const at = this.now().toISOString()
    const editable = locked ? { objective: patch.objective, autonomy: patch.autonomy } : patch
    this.deps.goals.update(goalId, editable, at)
    if (patch.status !== undefined && patch.status !== goal.status) {
      this.deps.goals.setStatus(goalId, patch.status, at)
    }
    if (patch.status !== undefined && patch.status !== goal.status) {
      this.deps.activity.record('goal.status', `Goal ${patch.status}`, {
        projectId: goal.projectId,
        payload: { goalId, from: goal.status, to: patch.status },
      })
    }
    const updated = this.deps.goals.get(goalId)
    if (!updated) throw new TaskManagerError('Goal disappeared during update')
    return updated
  }

  addTask(
    projectId: string,
    input: { title: string; description?: string; goalId?: string },
  ): HarnessTask {
    const trimmed = input.title.trim()
    if (trimmed === '') throw new TaskManagerError('Task title cannot be empty')

    const at = this.now().toISOString()
    const task: HarnessTask = {
      id: this.newId(),
      projectId,
      goalId: input.goalId,
      title: trimmed,
      description: input.description?.trim() || undefined,
      status: 'pending',
      source: 'user',
      createdAt: at,
      updatedAt: at,
    }
    this.deps.tasks.insert(task)
    this.deps.activity.record('task.added', `Task added: ${trimmed.slice(0, 80)}`, {
      projectId,
    })
    return task
  }

  updateTask(
    taskId: string,
    fields: { title?: string; description?: string; status?: TaskStatus },
    reason?: string,
  ): HarnessTask {
    const current = this.deps.tasks.get(taskId)
    if (!current) throw new TaskManagerError('Task not found')

    if (fields.status && fields.status !== current.status) {
      if (!canTransition(current.status, fields.status)) {
        throw new TaskManagerError(`Invalid transition: ${current.status} → ${fields.status}`)
      }
    }
    if (fields.title !== undefined && fields.title.trim() === '') {
      throw new TaskManagerError('Task title cannot be empty')
    }

    this.deps.tasks.update(taskId, fields, this.now().toISOString())
    if (fields.status && fields.status !== current.status) {
      this.recordTransition(current, fields.status, reason)
    }
    const updated = this.deps.tasks.get(taskId)
    if (!updated) throw new TaskManagerError('Task disappeared during update')

    if (fields.status && fields.status !== current.status) {
      this.deps.activity.record(
        'task.status',
        `Task ${fields.status}: ${updated.title.slice(0, 80)}`,
        {
          projectId: current.projectId,
          payload: { taskId, from: current.status, to: fields.status },
        },
      )

      // Completing a goal-linked task references the goal's Definition of
      // Done (spec §13): record which criteria remain unverified.
      if (fields.status === 'done' && updated.goalId) {
        const goal = this.deps.goals.get(updated.goalId)
        if (goal && goal.doneWhen.length > 0) {
          this.deps.activity.record(
            'goal.dod-reference',
            'Task completed; DoD criteria unverified',
            {
              projectId: current.projectId,
              payload: { goalId: goal.id, taskId, unverifiedCriteria: goal.doneWhen },
            },
          )
        }
      }
    }
    return updated
  }

  cancelTask(taskId: string): HarnessTask {
    const current = this.deps.tasks.get(taskId)
    if (!current) throw new TaskManagerError('Task not found')
    if (!canTransition(current.status, 'cancelled')) {
      throw new TaskManagerError(`Task cannot be cancelled from ${current.status}`)
    }
    return this.updateTask(taskId, { status: 'cancelled' })
  }

  /** Explicit machine transition with a reason, e.g. verifying → rejected. */
  applyTransition(taskId: string, to: TaskStatus, reason?: string): HarnessTask {
    const current = this.deps.tasks.get(taskId)
    if (!current) throw new TaskManagerError('Task not found')
    if (!canTransition(current.status, to)) {
      throw new TaskManagerError(
        `Invalid transition: ${current.status} → ${to}${reason ? ` (${reason})` : ''}`,
      )
    }
    return this.updateTask(taskId, { status: to }, reason)
  }

  /** Auditable transition history for a task (spec §14). */
  transitionHistory(taskId: string): TaskTransition[] {
    return this.deps.transitions?.listForTask(taskId) ?? []
  }

  private recordTransition(from: HarnessTask, to: TaskStatus, reason?: string): void {
    const transition: TaskTransition = {
      id: this.newId(),
      taskId: from.id,
      from: from.status,
      to,
      reason,
      at: this.now().toISOString(),
    }
    this.deps.transitions?.record(transition)
  }

  /**
   * Substantial-request intake (spec §12.4): goal draft plus an initial
   * task container, before any broad implementation begins.
   */
  intakeSubstantialRequest(
    projectId: string,
    text: string,
  ): {
    goal: GoalContract
    task: HarnessTask
    created: boolean
  } {
    const existing = this.deps.goals.openForProject(projectId)
    if (existing) {
      return {
        goal: existing,
        task: this.deps.tasks.listForProject(projectId)[0] as HarnessTask,
        created: false,
      }
    }
    const goal = this.createGoalDraft(projectId, text)
    const task = this.addTask(projectId, {
      title: 'Break down this goal into tasks',
      goalId: goal.id,
      description: 'Initial task container created by the harness for the goal draft.',
    })
    return { goal, task, created: true }
  }

  /**
   * Syncs the runtime's native TODO list into the durable store.
   * Idempotent: repeated syncs with the same list change nothing.
   */
  syncOpenCodeTodos(projectId: string, todos: RuntimeTodo[]): HarnessTask[] {
    const existing = new Map(
      this.deps.tasks
        .listForProject(projectId)
        .filter((task) => task.source === 'opencode')
        .map((task) => [task.id, task]),
    )
    const at = this.now().toISOString()
    const goal = this.deps.goals.openForProject(projectId)

    for (const todo of todos) {
      const status = TODO_STATUS_MAP[todo.status] ?? 'pending'
      const id = openCodeTaskId(todo.id)
      const current = existing.get(id)
      if (current) {
        existing.delete(id)
        if (current.title !== todo.content || current.status !== status) {
          this.deps.tasks.update(
            id,
            {
              title: todo.content,
              status: canTransition(current.status, status) ? status : current.status,
            },
            at,
          )
        }
      } else {
        this.deps.tasks.insert({
          id,
          projectId,
          goalId: goal?.id,
          title: todo.content,
          status,
          source: 'opencode',
          createdAt: at,
          updatedAt: at,
        })
      }
    }

    // Runtime todos that vanished from the list are cancelled (not deleted
    // — the ledger keeps history).
    for (const stale of existing.values()) {
      if (canTransition(stale.status, 'cancelled')) {
        this.deps.tasks.update(stale.id, { status: 'cancelled' }, at)
      }
    }

    return this.deps.tasks.listForProject(projectId)
  }
}
