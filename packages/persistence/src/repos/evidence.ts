import type { VerificationEvidence } from '@studio/shared'
import type { SqliteDb, SqlRow } from '../database.js'

function toEvidence(row: SqlRow): VerificationEvidence {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    taskId: row.task_id === null || row.task_id === undefined ? undefined : String(row.task_id),
    worktreeId:
      row.worktree_id === null || row.worktree_id === undefined
        ? undefined
        : String(row.worktree_id),
    attempt: row.attempt === null || row.attempt === undefined ? undefined : Number(row.attempt),
    kind: String(row.kind) as VerificationEvidence['kind'],
    command: String(row.command),
    exitCode: Number(row.exit_code),
    passed: row.passed === null || row.passed === undefined ? undefined : Number(row.passed),
    failed: row.failed === null || row.failed === undefined ? undefined : Number(row.failed),
    durationMs: Number(row.duration_ms),
    summary: String(row.summary ?? ''),
    outputPath:
      row.output_path === null || row.output_path === undefined
        ? undefined
        : String(row.output_path),
    startedAt: String(row.started_at),
    finishedAt: String(row.finished_at),
  }
}

export class EvidenceRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(evidence: VerificationEvidence): void {
    this.db.run(
      `INSERT INTO verification_evidence (id, project_id, task_id, worktree_id, attempt, command, kind, exit_code, passed, failed, duration_ms, summary, output_path, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evidence.id,
      evidence.projectId,
      evidence.taskId ?? null,
      evidence.worktreeId ?? null,
      evidence.attempt ?? null,
      evidence.command,
      evidence.kind,
      evidence.exitCode,
      evidence.passed ?? null,
      evidence.failed ?? null,
      evidence.durationMs,
      evidence.summary,
      evidence.outputPath ?? null,
      evidence.startedAt,
      evidence.finishedAt,
    )
  }

  get(id: string): VerificationEvidence | undefined {
    const row = this.db.get('SELECT * FROM verification_evidence WHERE id = ?', id)
    return row ? toEvidence(row) : undefined
  }

  listForTask(taskId: string): VerificationEvidence[] {
    return this.db
      .all(
        'SELECT * FROM verification_evidence WHERE task_id = ? ORDER BY started_at ASC, rowid ASC',
        taskId,
      )
      .map(toEvidence)
  }

  listForProject(projectId: string, limit = 100): VerificationEvidence[] {
    return this.db
      .all(
        'SELECT * FROM verification_evidence WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?',
        projectId,
        limit,
      )
      .map(toEvidence)
  }
}
