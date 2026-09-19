import type { ActivityRepository, GoalRepository, TaskRepository } from '@studio/persistence'
import type { GoalSummary, HarnessTask, RuntimeTodo, TaskStatus } from '@studio/shared'

export class TaskManagerError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/**
 * v1 transition table (spec §12.3 / §14). done and cancelled are terminal
 * until the full run state machine lands with its phase-2 ticket.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'blocked', 'done', 'cancelled'],
  in_progress: ['pending', 'blocked', 'done', 'cancelled'],
  blocked: ['pending', 'in_progress', 'cancelled'],
  done: [],
  cancelled: [],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to)
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

  stateForProject(projectId: string): { goal?: GoalSummary; tasks: HarnessTask[] } {
    return {
      goal: this.deps.goals.openForProject(projectId),
      tasks: this.deps.tasks.listForProject(projectId),
    }
  }

  /** Creates the project's open goal draft, or returns the existing one. */
  createGoalDraft(projectId: string, objective: string): GoalSummary {
    const trimmed = objective.trim()
    if (trimmed === '') throw new TaskManagerError('Goal objective cannot be empty')

    const existing = this.deps.goals.openForProject(projectId)
    if (existing) return existing

    const at = this.now().toISOString()
    const goal: GoalSummary = {
      id: this.newId(),
      projectId,
      objective: trimmed,
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

  updateGoalObjective(goalId: string, objective: string): GoalSummary {
    const goal = this.deps.goals.get(goalId)
    if (!goal) throw new TaskManagerError('Goal not found')
    const trimmed = objective.trim()
    if (trimmed === '') throw new TaskManagerError('Goal objective cannot be empty')
    this.deps.goals.updateObjective(goalId, trimmed, this.now().toISOString())
    return { ...goal, objective: trimmed }
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

  /**
   * Substantial-request intake (spec §12.4): goal draft plus an initial
   * task container, before any broad implementation begins.
   */
  intakeSubstantialRequest(
    projectId: string,
    text: string,
  ): {
    goal: GoalSummary
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
