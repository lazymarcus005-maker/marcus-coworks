import type { TaskStatus, TaskTransition } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toTransition(row: SqlRow): TaskTransition {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    from: String(row.from_status) as TaskStatus,
    to: String(row.to_status) as TaskStatus,
    reason: row.reason === null || row.reason === undefined ? undefined : String(row.reason),
    at: String(row.at),
  }
}

/** Append-only audit trail of task state transitions (spec §14). */
export class TaskTransitionRepository {
  constructor(private readonly db: SqliteDb) {}

  record(transition: TaskTransition): void {
    this.db.run(
      'INSERT INTO task_transitions (id, task_id, from_status, to_status, reason, at) VALUES (?, ?, ?, ?, ?, ?)',
      transition.id,
      transition.taskId,
      transition.from,
      transition.to,
      transition.reason ?? null,
      transition.at,
    )
  }

  listForTask(taskId: string): TaskTransition[] {
    return this.db
      .all('SELECT * FROM task_transitions WHERE task_id = ? ORDER BY rowid ASC', taskId)
      .map(toTransition)
  }
}
