import type { GoalContract, GoalRisk, GoalStatus, HarnessTask, TaskStatus } from '@studio/shared'
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

function parseList(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]')) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function toGoal(row: SqlRow): GoalContract {
  const status = String(row.status)
  const risk = String(row.risk)
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    objective: String(row.objective),
    scope: parseList(row.scope_json),
    nonGoals: parseList(row.non_goals_json),
    constraints: parseList(row.constraints_json),
    doneWhen: parseList(row.done_when_json),
    risk: risk === 'low' || risk === 'high' ? risk : 'medium',
    maxAttempts: Number(row.max_attempts ?? 3),
    autonomy:
      row.autonomy === null || row.autonomy === undefined ? undefined : String(row.autonomy),
    status:
      status === 'ready' || status === 'active' || status === 'done' || status === 'cancelled'
        ? (status as GoalStatus)
        : 'draft',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export class GoalRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(goal: GoalContract): void {
    this.db.run(
      `INSERT INTO goals (id, project_id, objective, scope_json, non_goals_json, constraints_json, done_when_json, risk, max_attempts, autonomy, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      goal.id,
      goal.projectId,
      goal.objective,
      JSON.stringify(goal.scope),
      JSON.stringify(goal.nonGoals),
      JSON.stringify(goal.constraints),
      JSON.stringify(goal.doneWhen),
      goal.risk,
      goal.maxAttempts,
      goal.autonomy ?? null,
      goal.status,
      goal.createdAt,
      goal.updatedAt,
    )
  }

  /** The open (draft/ready/active) goal for a project, newest first. */
  openForProject(projectId: string): GoalContract | undefined {
    const row = this.db.get(
      "SELECT * FROM goals WHERE project_id = ? AND status IN ('draft', 'ready', 'active') ORDER BY created_at DESC LIMIT 1",
      projectId,
    )
    return row ? toGoal(row) : undefined
  }

  get(id: string): GoalContract | undefined {
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

  /** Full contract update. Columns not present in the patch keep values. */
  update(
    id: string,
    patch: {
      objective?: string
      scope?: string[]
      nonGoals?: string[]
      constraints?: string[]
      doneWhen?: string[]
      risk?: GoalRisk
      maxAttempts?: number
      autonomy?: string
    },
    updatedAt: string,
  ): void {
    this.db.run(
      `UPDATE goals SET
         objective = COALESCE(?, objective),
         scope_json = COALESCE(?, scope_json),
         non_goals_json = COALESCE(?, non_goals_json),
         constraints_json = COALESCE(?, constraints_json),
         done_when_json = COALESCE(?, done_when_json),
         risk = COALESCE(?, risk),
         max_attempts = COALESCE(?, max_attempts),
         autonomy = COALESCE(?, autonomy),
         updated_at = ?
       WHERE id = ?`,
      patch.objective ?? null,
      patch.scope === undefined ? null : JSON.stringify(patch.scope),
      patch.nonGoals === undefined ? null : JSON.stringify(patch.nonGoals),
      patch.constraints === undefined ? null : JSON.stringify(patch.constraints),
      patch.doneWhen === undefined ? null : JSON.stringify(patch.doneWhen),
      patch.risk ?? null,
      patch.maxAttempts ?? null,
      patch.autonomy ?? null,
      updatedAt,
      id,
    )
  }

  setStatus(id: string, status: GoalStatus, updatedAt: string): void {
    this.db.run('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?', status, updatedAt, id)
  }
}
