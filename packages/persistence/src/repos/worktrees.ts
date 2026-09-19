import type { WorktreeRecord, WorktreeStatus } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toWorktree(row: SqlRow): WorktreeRecord {
  const status = String(row.status)
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    taskId: String(row.task_id),
    attempt: Number(row.attempt),
    path: String(row.path),
    branch: String(row.branch),
    baseBranch: String(row.base_branch),
    status: (['approved', 'rejected', 'escalated', 'merged', 'stale'].includes(status)
      ? status
      : 'active') as WorktreeStatus,
    diffPath:
      row.diff_path === null || row.diff_path === undefined ? undefined : String(row.diff_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export class WorktreeRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(record: WorktreeRecord): void {
    this.db.run(
      `INSERT INTO worktrees (id, project_id, task_id, attempt, path, branch, base_branch, status, diff_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.projectId,
      record.taskId,
      record.attempt,
      record.path,
      record.branch,
      record.baseBranch,
      record.status,
      record.diffPath ?? null,
      record.createdAt,
      record.updatedAt,
    )
  }

  forTaskAttempt(taskId: string, attempt: number): WorktreeRecord | undefined {
    const row = this.db.get(
      'SELECT * FROM worktrees WHERE task_id = ? AND attempt = ? ORDER BY created_at DESC LIMIT 1',
      taskId,
      attempt,
    )
    return row ? toWorktree(row) : undefined
  }

  get(id: string): WorktreeRecord | undefined {
    const row = this.db.get('SELECT * FROM worktrees WHERE id = ?', id)
    return row ? toWorktree(row) : undefined
  }

  listForProject(projectId: string): WorktreeRecord[] {
    return this.db
      .all('SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC', projectId)
      .map(toWorktree)
  }

  listAll(): WorktreeRecord[] {
    return this.db.all('SELECT * FROM worktrees ORDER BY created_at DESC').map(toWorktree)
  }

  setStatus(id: string, status: WorktreeStatus, updatedAt: string): void {
    this.db.run(
      'UPDATE worktrees SET status = ?, updated_at = ? WHERE id = ?',
      status,
      updatedAt,
      id,
    )
  }

  setDiffPath(id: string, diffPath: string, updatedAt: string): void {
    this.db.run(
      'UPDATE worktrees SET diff_path = ?, updated_at = ? WHERE id = ?',
      diffPath,
      updatedAt,
      id,
    )
  }

  delete(id: string): void {
    this.db.run('DELETE FROM worktrees WHERE id = ?', id)
  }
}
