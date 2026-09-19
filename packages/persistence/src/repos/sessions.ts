import type { SqliteDb, SqlRow } from '../database.js'

export type SessionRecord = {
  id: string
  projectId: string
  runtime: string
  createdAt: string
  updatedAt: string
}

function toSession(row: SqlRow): SessionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    runtime: String(row.runtime),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** Tracks the active runtime session per project (sessions table). */
export class SessionRepository {
  constructor(private readonly db: SqliteDb) {}

  upsertForProject(record: SessionRecord): void {
    this.db.run('DELETE FROM sessions WHERE project_id = ?', record.projectId)
    this.db.run(
      'INSERT INTO sessions (id, project_id, runtime, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, NULL)',
      record.id,
      record.projectId,
      record.runtime,
      record.createdAt,
      record.updatedAt,
    )
  }

  forProject(projectId: string): SessionRecord | undefined {
    const row = this.db.get(
      'SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
      projectId,
    )
    return row ? toSession(row) : undefined
  }

  forSession(sessionId: string): SessionRecord | undefined {
    const row = this.db.get('SELECT * FROM sessions WHERE id = ?', sessionId)
    return row ? toSession(row) : undefined
  }

  deleteForProject(projectId: string): void {
    this.db.run('DELETE FROM sessions WHERE project_id = ?', projectId)
  }
}
