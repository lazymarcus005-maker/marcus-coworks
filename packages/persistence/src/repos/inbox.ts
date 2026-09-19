import type { InboxDecision, InboxItem, InboxItemKind, InboxItemStatus } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toItem(row: SqlRow): InboxItem {
  const kind = String(row.kind)
  const status = String(row.status)
  return {
    id: String(row.id),
    projectId:
      row.project_id === null || row.project_id === undefined ? undefined : String(row.project_id),
    taskId: row.task_id === null || row.task_id === undefined ? undefined : String(row.task_id),
    goalId: row.goal_id === null || row.goal_id === undefined ? undefined : String(row.goal_id),
    kind: kind as InboxItemKind,
    title: String(row.title),
    detail: row.detail === null || row.detail === undefined ? undefined : String(row.detail),
    evidenceIds: JSON.parse(String(row.evidence_json ?? '[]')) as string[],
    status: status === 'resolved' ? 'resolved' : 'open',
    decision:
      row.decision === null || row.decision === undefined
        ? undefined
        : (String(row.decision) as InboxDecision),
    decidedAt:
      row.decided_at === null || row.decided_at === undefined ? undefined : String(row.decided_at),
    createdAt: String(row.created_at),
  }
}

export class InboxRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(item: InboxItem): void {
    this.db.run(
      `INSERT INTO inbox_items (id, project_id, task_id, goal_id, kind, title, detail, evidence_json, status, decision, decided_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      item.projectId ?? null,
      item.taskId ?? null,
      item.goalId ?? null,
      item.kind,
      item.title,
      item.detail ?? null,
      JSON.stringify(item.evidenceIds),
      item.status,
      item.decision ?? null,
      item.decidedAt ?? null,
      item.createdAt,
    )
  }

  list(status: InboxItemStatus = 'open'): InboxItem[] {
    return this.db
      .all(
        'SELECT * FROM inbox_items WHERE status = ? ORDER BY created_at DESC, rowid DESC',
        status,
      )
      .map(toItem)
  }

  get(id: string): InboxItem | undefined {
    const row = this.db.get('SELECT * FROM inbox_items WHERE id = ?', id)
    return row ? toItem(row) : undefined
  }

  resolve(id: string, decision: InboxDecision, at: string): InboxItem {
    this.db.run(
      "UPDATE inbox_items SET status = 'resolved', decision = ?, decided_at = ? WHERE id = ?",
      decision,
      at,
      id,
    )
    const updated = this.get(id)
    if (!updated) throw new Error(`Inbox item disappeared: ${id}`)
    return updated
  }
}
