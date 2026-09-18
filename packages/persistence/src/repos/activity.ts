import type { ActivityEvent } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toEvent(row: SqlRow): ActivityEvent {
  const payloadRaw = String(row.payload_json ?? '{}')
  let payload: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(payloadRaw) as Record<string, unknown>
    payload = Object.keys(parsed).length > 0 ? parsed : undefined
  } catch {
    payload = undefined
  }
  return {
    id: String(row.id),
    projectId:
      row.project_id === null || row.project_id === undefined ? undefined : String(row.project_id),
    type: String(row.type),
    message: String(row.message),
    payload,
    createdAt: String(row.created_at),
  }
}

/** Append-only activity/audit trail. The basic phase-1 event bus. */
export class ActivityRepository {
  constructor(private readonly db: SqliteDb) {}

  record(
    type: string,
    message: string,
    options: {
      id?: string
      projectId?: string
      payload?: Record<string, unknown>
      at?: string
    } = {},
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: options.id ?? crypto.randomUUID(),
      projectId: options.projectId,
      type,
      message,
      payload: options.payload,
      createdAt: options.at ?? new Date().toISOString(),
    }
    this.db.run(
      'INSERT INTO activity_events (id, project_id, type, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      event.id,
      event.projectId ?? null,
      event.type,
      event.message,
      JSON.stringify(event.payload ?? {}),
      event.createdAt,
    )
    return event
  }

  listForProject(projectId: string, limit = 200): ActivityEvent[] {
    return this.db
      .all(
        'SELECT * FROM activity_events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        projectId,
        limit,
      )
      .map(toEvent)
  }

  listAll(limit = 200): ActivityEvent[] {
    return this.db
      .all('SELECT * FROM activity_events ORDER BY created_at DESC, id DESC LIMIT ?', limit)
      .map(toEvent)
  }
}
