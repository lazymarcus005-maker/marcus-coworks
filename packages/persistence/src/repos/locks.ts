import type { LockStatus, ScopeLock } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toLock(row: SqlRow): ScopeLock {
  const status = String(row.status)
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerTaskId: String(row.owner_task_id),
    ownerAgentId:
      row.owner_agent_id === null || row.owner_agent_id === undefined
        ? undefined
        : String(row.owner_agent_id),
    patterns: JSON.parse(String(row.patterns_json ?? '[]')) as string[],
    status: (['waiting', 'released', 'stale'].includes(status) ? status : 'active') as LockStatus,
    acquiredAt: String(row.acquired_at),
    expiresAt:
      row.expires_at === null || row.expires_at === undefined ? undefined : String(row.expires_at),
    waitDeadline:
      row.wait_deadline === null || row.wait_deadline === undefined
        ? undefined
        : String(row.wait_deadline),
    escalatedAt:
      row.escalated_at === null || row.escalated_at === undefined
        ? undefined
        : String(row.escalated_at),
  }
}

export class LockRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(lock: ScopeLock): void {
    this.db.run(
      `INSERT INTO locks (id, project_id, owner_task_id, owner_agent_id, patterns_json, status, acquired_at, expires_at, wait_deadline, escalated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      lock.id,
      lock.projectId,
      lock.ownerTaskId,
      lock.ownerAgentId ?? null,
      JSON.stringify(lock.patterns),
      lock.status,
      lock.acquiredAt,
      lock.expiresAt ?? null,
      lock.waitDeadline ?? null,
      lock.escalatedAt ?? null,
    )
  }

  get(id: string): ScopeLock | undefined {
    const row = this.db.get('SELECT * FROM locks WHERE id = ?', id)
    return row ? toLock(row) : undefined
  }

  listByProject(projectId: string, status?: LockStatus): ScopeLock[] {
    const rows = status
      ? this.db.all(
          'SELECT * FROM locks WHERE project_id = ? AND status = ? ORDER BY rowid',
          projectId,
          status,
        )
      : this.db.all('SELECT * FROM locks WHERE project_id = ? ORDER BY rowid', projectId)
    return rows.map(toLock)
  }

  listByTask(taskId: string): ScopeLock[] {
    return this.db
      .all('SELECT * FROM locks WHERE owner_task_id = ? ORDER BY rowid', taskId)
      .map(toLock)
  }

  listAll(): ScopeLock[] {
    return this.db
      .all('SELECT * FROM locks WHERE status IN (?, ?) ORDER BY rowid', 'active', 'waiting')
      .map(toLock)
  }

  setStatus(id: string, status: LockStatus, _at: string): void {
    this.db.run('UPDATE locks SET status = ? WHERE id = ?', status, id)
  }

  promote(id: string, acquiredAt: string, expiresAt: string): void {
    this.db.run(
      `UPDATE locks SET status = 'active', acquired_at = ?, expires_at = ?, wait_deadline = NULL WHERE id = ?`,
      acquiredAt,
      expiresAt,
      id,
    )
  }

  setEscalated(id: string, at: string): void {
    this.db.run('UPDATE locks SET escalated_at = ? WHERE id = ?', at, id)
  }
}
