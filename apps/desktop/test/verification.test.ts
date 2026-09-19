import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  EvidenceRepository,
  GoalRepository,
  migrate,
  SqliteDb,
  TaskRepository,
  TaskTransitionRepository,
} from '@studio/persistence'
import { TaskManager } from '@studio/task-manager'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  parseCounts,
  type ShellRunner,
  summarize,
  VerificationManager,
} from '../src/main/verification.js'

let dir: string
let db: SqliteDb
let manager: VerificationManager
let outputDir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-verif-'))
  outputDir = join(dir, 'outputs')
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  manager = new VerificationManager({
    evidence: new EvidenceRepository(db),
    activity: new ActivityRepository(db),
    outputDir,
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('parseCounts + summarize', () => {
  it('reads common test output shapes', () => {
    expect(parseCounts('52 tests passed\n0 failed')).toEqual({ passed: 52, failed: 0 })
    expect(parseCounts('Tests: 3 failed, 49 passed, 52 total')).toEqual({
      passed: 49,
      failed: 3,
    })
    expect(parseCounts('passed: 10\nfailed: 2')).toEqual({ passed: 10, failed: 2 })
    expect(parseCounts('no counts here')).toEqual({})
  })

  it('summarizes to a bounded set of lines', () => {
    const summary = summarize(Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\n'))
    expect(summary.split('\n')).toHaveLength(6)
  })
})

describe('VerificationManager (real shell)', () => {
  it('runs a passing pipeline and stores evidence with counts', async () => {
    const project = { id: 'p1', path: dir }
    const run = await manager.runPipeline(
      project,
      [
        { kind: 'test', command: 'echo "3 tests passed, 0 failed"', required: true },
        { kind: 'build', command: 'true', required: true },
      ],
      { taskId: 't-1', attempt: 1 },
    )

    expect(run.allRequiredPassed).toBe(true)
    expect(run.evidence).toHaveLength(2)
    const testEvidence = run.evidence[0]
    expect(testEvidence).toMatchObject({ kind: 'test', exitCode: 0, passed: 3, failed: 0 })
    expect(testEvidence?.taskId).toBe('t-1')
    // Full output persisted outside chat.
    expect(testEvidence?.outputPath).toBeTruthy()
    if (testEvidence?.outputPath) {
      expect(existsSync(testEvidence.outputPath)).toBe(true)
      expect(readFileSync(testEvidence.outputPath, 'utf-8')).toContain('3 tests passed')
    }
  })

  it('a failing required check blocks completion and stops the pipeline', async () => {
    const project = { id: 'p1', path: dir }
    const run = await manager.runPipeline(
      project,
      [
        { kind: 'lint', command: 'true', required: true },
        { kind: 'test', command: 'echo "2 failed" >&2; exit 1', required: true },
        { kind: 'custom', command: 'echo should-not-run', required: false },
      ],
      { taskId: 't-2' },
    )

    expect(run.allRequiredPassed).toBe(false)
    expect(run.evidence).toHaveLength(2)
    const failed = run.evidence[1]
    expect(failed?.exitCode).toBe(1)
    expect(failed?.failed).toBe(2)

    const stored = new EvidenceRepository(db).listForTask('t-2')
    expect(stored).toHaveLength(2)
  })

  it('non-required failures do not block completion', async () => {
    const project = { id: 'p1', path: dir }
    const run = await manager.runPipeline(project, [
      { kind: 'test', command: 'true', required: true },
      { kind: 'format', command: 'exit 3', required: false },
    ])
    expect(run.allRequiredPassed).toBe(true)
    expect(run.evidence[1]?.exitCode).toBe(3)
  })
})

describe('verification ↔ task completion gate', () => {
  it('task completion respects verification policy through the state machine', async () => {
    const transitions = new TaskTransitionRepository(db)
    const evidenceRepo = new EvidenceRepository(db)
    const tasks = new TaskManager({
      tasks: new TaskRepository(db),
      goals: new GoalRepository(db),
      activity: new ActivityRepository(db),
      transitions,
      completionGate: (taskId) => {
        const latest = evidenceRepo.listForTask(taskId).at(-1)
        return {
          allowed: latest !== undefined && latest.exitCode === 0,
          reason:
            latest === undefined
              ? 'no verification evidence recorded'
              : `last check (${latest.kind}) exited ${latest.exitCode}`,
        }
      },
    })

    const task = tasks.addTask('p-gate', { title: 'Fix bug' })
    // Drive the machine to verifying.
    db.run("UPDATE tasks SET status = 'running' WHERE id = ?", task.id)
    tasks.applyTransition(task.id, 'testing')
    tasks.applyTransition(task.id, 'verifying')

    // Failed required check: the harness must NOT transition to done.
    const failedRun = await manager.runPipeline(
      { id: 'p-gate', path: dir },
      [{ kind: 'test', command: 'exit 1', required: true }],
      { taskId: task.id },
    )
    expect(failedRun.allRequiredPassed).toBe(false)
    expect(() => tasks.applyTransition(task.id, 'done', 'model claims tests pass')).toThrow(
      /Completion blocked/,
    )

    // Passing run → done allowed.
    const passedRun = await manager.runPipeline(
      { id: 'p-gate', path: dir },
      [{ kind: 'test', command: 'echo "5 passed"', required: true }],
      { taskId: task.id },
    )
    expect(passedRun.allRequiredPassed).toBe(true)
    const done = tasks.applyTransition(
      task.id,
      'done',
      `evidence: ${passedRun.evidence.map((entry) => entry.id).join(',')}`,
    )
    expect(done.status).toBe('done')

    const evidence = evidenceRepo.listForTask(task.id)
    expect(evidence).toHaveLength(2)
  })
})
