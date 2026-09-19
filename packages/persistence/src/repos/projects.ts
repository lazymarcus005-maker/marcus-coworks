import type { ProjectStatus, ProjectWorkspace } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toProject(row: SqlRow): ProjectWorkspace {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    status: String(row.status) as ProjectStatus,
    sessionId: row.session_id === null ? undefined : String(row.session_id),
    model: row.model === null ? undefined : String(row.model),
    branch: row.branch === null ? undefined : String(row.branch),
    createdAt: String(row.created_at),
    lastActiveAt: String(row.last_active_at),
  }
}

export class ProjectRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(project: ProjectWorkspace): void {
    this.db.run(
      `INSERT INTO projects (id, name, path, status, session_id, model, branch, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      project.id,
      project.name,
      project.path,
      project.status,
      project.sessionId ?? null,
      project.model ?? null,
      project.branch ?? null,
      project.createdAt,
      project.lastActiveAt,
    )
  }

  list(): ProjectWorkspace[] {
    return this.db.all('SELECT * FROM projects ORDER BY created_at ASC').map(toProject)
  }

  get(id: string): ProjectWorkspace | undefined {
    const row = this.db.get('SELECT * FROM projects WHERE id = ?', id)
    return row ? toProject(row) : undefined
  }

  getByPath(path: string): ProjectWorkspace | undefined {
    const row = this.db.get('SELECT * FROM projects WHERE path = ?', path)
    return row ? toProject(row) : undefined
  }

  rename(id: string, name: string, lastActiveAt: string): void {
    this.db.run(
      'UPDATE projects SET name = ?, last_active_at = ? WHERE id = ?',
      name,
      lastActiveAt,
      id,
    )
  }

  updateStatus(id: string, status: ProjectStatus, lastActiveAt: string): void {
    this.db.run(
      'UPDATE projects SET status = ?, last_active_at = ? WHERE id = ?',
      status,
      lastActiveAt,
      id,
    )
  }

  setSession(id: string, sessionId: string, lastActiveAt: string): void {
    this.db.run(
      'UPDATE projects SET session_id = ?, last_active_at = ? WHERE id = ?',
      sessionId,
      lastActiveAt,
      id,
    )
  }

  delete(id: string): void {
    this.db.run('DELETE FROM projects WHERE id = ?', id)
  }

  deleteHistoryFor(id: string): void {
    this.db.run('DELETE FROM goals WHERE project_id = ?', id)
    this.db.run('DELETE FROM tasks WHERE project_id = ?', id)
    this.db.run('DELETE FROM activity_events WHERE project_id = ?', id)
  }
}
