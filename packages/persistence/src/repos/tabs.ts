import type { ProjectTab } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toTab(row: SqlRow): ProjectTab {
  return {
    projectId: String(row.project_id),
    position: Number(row.position),
    openedAt: String(row.opened_at),
  }
}

export class TabRepository {
  constructor(private readonly db: SqliteDb) {}

  open(projectId: string, openedAt: string): void {
    const max = this.db.get('SELECT MAX(position) AS max FROM project_tabs')
    const next = (max?.max === null || max?.max === undefined ? 0 : Number(max.max)) + 1
    this.db.run(
      'INSERT OR IGNORE INTO project_tabs (project_id, position, opened_at) VALUES (?, ?, ?)',
      projectId,
      next,
      openedAt,
    )
  }

  list(): ProjectTab[] {
    return this.db.all('SELECT * FROM project_tabs ORDER BY position ASC').map(toTab)
  }

  close(projectId: string): void {
    this.db.run('DELETE FROM project_tabs WHERE project_id = ?', projectId)
    if (this.activeTabId() === projectId) {
      const next = this.list()[0]
      this.setActive(next ? next.projectId : null)
    }
  }

  has(projectId: string): boolean {
    return (
      this.db.get('SELECT project_id FROM project_tabs WHERE project_id = ?', projectId) !==
      undefined
    )
  }

  activeTabId(): string | null {
    const row = this.db.get('SELECT project_id FROM active_tab WHERE id = 1')
    return row?.project_id === null || row?.project_id === undefined ? null : String(row.project_id)
  }

  setActive(projectId: string | null): void {
    this.db.run('INSERT OR REPLACE INTO active_tab (id, project_id) VALUES (1, ?)', projectId)
  }
}
