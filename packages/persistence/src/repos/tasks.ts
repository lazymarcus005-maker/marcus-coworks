import type { GoalSummary, HarnessTask, TaskStatus } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toTask(row: SqlRow): HarnessTask {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    goalId: row.goal_id === null || row.goal_id === undefined ? undefined : String(row.goal_id),
    title: String(row.title),
    description:
      row.description === null || row.description === undefined
        ? undefined
        : String(row.description),
    status: String(row.status) as TaskStatus,
    source: String(row.source ?? 'user') === 'opencode' ? 'opencode' : 'user',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  }
}

export class TaskRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(task: HarnessTask): void {
    this.db.run(
      `INSERT INTO tasks (id, project_id, goal_id, title, description, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      task.id,
      task.projectId,
      task.goalId ?? null,
      task.title,
      task.description ?? null,
      task.status,
      task.source,
      task.createdAt,
      task.updatedAt,
    )
  }

  listForProject(projectId: string): HarnessTask[] {
    return this.db
      .all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC, id ASC', projectId)
      .map(toTask)
  }

  get(id: string): HarnessTask | undefined {
    const row = this.db.get('SELECT * FROM tasks WHERE id = ?', id)
    return row ? toTask(row) : undefined
  }

  update(
    id: string,
    fields: { title?: string; description?: string; status?: TaskStatus },
    updatedAt: string,
  ): void {
    const current = this.get(id)
    if (!current) throw new Error(`Task not found: ${id}`)
    this.db.run(
      'UPDATE tasks SET title = ?, description = ?, status = ?, updated_at = ? WHERE id = ?',
      fields.title ?? current.title,
      fields.description !== undefined ? fields.description : (current.description ?? null),
      fields.status ?? current.status,
      updatedAt,
      id,
    )
  }
}

function toGoal(row: SqlRow): GoalSummary {
  const status = String(row.status)
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    objective: String(row.objective),
    status: status === 'active' || status === 'done' || status === 'cancelled' ? status : 'draft',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export class GoalRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(goal: GoalSummary): void {
    this.db.run(
      'INSERT INTO goals (id, project_id, objective, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      goal.id,
      goal.projectId,
      goal.objective,
      goal.status,
      goal.createdAt,
      goal.updatedAt,
    )
  }

  /** The open (draft/active) goal for a project, newest first. */
  openForProject(projectId: string): GoalSummary | undefined {
    const row = this.db.get(
      "SELECT * FROM goals WHERE project_id = ? AND status IN ('draft', 'active') ORDER BY created_at DESC LIMIT 1",
      projectId,
    )
    return row ? toGoal(row) : undefined
  }

  get(id: string): GoalSummary | undefined {
    const row = this.db.get('SELECT * FROM goals WHERE id = ?', id)
    return row ? toGoal(row) : undefined
  }

  updateObjective(id: string, objective: string, updatedAt: string): void {
    this.db.run(
      'UPDATE goals SET objective = ?, updated_at = ? WHERE id = ?',
      objective,
      updatedAt,
      id,
    )
  }

  setStatus(id: string, status: GoalSummary['status'], updatedAt: string): void {
    this.db.run('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?', status, updatedAt, id)
  }
}
