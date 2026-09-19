import type { AttemptOutcome, AttemptRecord } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toAttempt(row: SqlRow): AttemptRecord {
  const outcome = String(row.outcome ?? '')
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    attempt: Number(row.attempt),
    agentId: row.agent_id === null || row.agent_id === undefined ? undefined : String(row.agent_id),
    model: row.model === null || row.model === undefined ? undefined : String(row.model),
    worktreeId:
      row.worktree_id === null || row.worktree_id === undefined
        ? undefined
        : String(row.worktree_id),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? undefined : String(row.ended_at),
    outcome: (['rejected', 'failed', 'escalated', 'cancelled'].includes(outcome)
      ? outcome
      : 'approved') as AttemptOutcome,
    failureClass:
      row.failure_class === null || row.failure_class === undefined
        ? undefined
        : String(row.failure_class),
    summary: row.summary === null || row.summary === undefined ? undefined : String(row.summary),
    evidenceIds: JSON.parse(String(row.evidence_ids_json ?? '[]')) as string[],
  }
}

export class AttemptRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(record: AttemptRecord): void {
    this.db.run(
      `INSERT INTO attempts (id, task_id, project_id, attempt, agent_id, model, worktree_id, started_at, ended_at, outcome, failure_class, summary, evidence_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.taskId,
      record.projectId,
      record.attempt,
      record.agentId ?? null,
      record.model ?? null,
      record.worktreeId ?? null,
      record.startedAt,
      record.endedAt ?? null,
      record.outcome ?? null,
      record.failureClass ?? null,
      record.summary ?? null,
      JSON.stringify(record.evidenceIds),
    )
  }

  get(id: string): AttemptRecord | undefined {
    const row = this.db.get('SELECT * FROM attempts WHERE id = ?', id)
    return row ? toAttempt(row) : undefined
  }

  listForTask(taskId: string): AttemptRecord[] {
    return this.db
      .all('SELECT * FROM attempts WHERE task_id = ? ORDER BY attempt ASC, rowid ASC', taskId)
      .map(toAttempt)
  }

  /** Highest attempt number recorded for the task (0 when none). */
  maxAttemptFor(taskId: string): number {
    const row = this.db.get('SELECT MAX(attempt) AS max FROM attempts WHERE task_id = ?', taskId)
    const max = row?.max
    return max === null || max === undefined ? 0 : Number(max)
  }

  end(
    id: string,
    fields: {
      outcome: AttemptOutcome
      failureClass?: string
      summary?: string
      evidenceIds?: string[]
    },
    endedAt: string,
  ): void {
    const current = this.get(id)
    const evidenceIds =
      fields.evidenceIds !== undefined ? fields.evidenceIds : (current?.evidenceIds ?? [])
    this.db.run(
      `UPDATE attempts SET ended_at = ?, outcome = ?, failure_class = ?, summary = ?, evidence_ids_json = ? WHERE id = ?`,
      endedAt,
      fields.outcome,
      fields.failureClass ?? null,
      fields.summary ?? null,
      JSON.stringify(evidenceIds),
      id,
    )
  }
}
