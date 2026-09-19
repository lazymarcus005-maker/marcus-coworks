import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  GoalRepository,
  migrate,
  SqliteDb,
  TaskRepository,
  TaskTransitionRepository,
} from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TaskManager, TaskManagerError } from '../src/task-manager.js'

let dir: string
let db: SqliteDb
let manager: TaskManager
let transitions: TaskTransitionRepository

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-sm-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  transitions = new TaskTransitionRepository(db)
  manager = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity: new ActivityRepository(db),
    transitions,
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function machineTask(statuses: string[]): string {
  const task = manager.addTask('proj-sm', {
    title: `Task ${Math.random().toString(36).slice(2, 8)}`,
  })
  // Drive to the initial state through the v1 entry points.
  if (statuses[0] === 'created') {
    db.run("UPDATE tasks SET status = 'created' WHERE id = ?", task.id)
  }
  return task.id
}

describe('run state machine (spec §14)', () => {
  it('walks the happy path: created → planning → ready → running → testing → verifying → done', () => {
    const id = machineTask(['created'])
    manager.applyTransition(id, 'planning')
    manager.applyTransition(id, 'ready')
    manager.applyTransition(id, 'running')
    manager.applyTransition(id, 'testing')
    manager.applyTransition(id, 'verifying')
    const done = manager.applyTransition(id, 'done', 'approved by verifier')

    expect(done.status).toBe('done')

    const history = manager.transitionHistory(id)
    expect(history.map((t) => t.to)).toEqual([
      'planning',
      'ready',
      'running',
      'testing',
      'verifying',
      'done',
    ])
    expect(history[history.length - 1]?.reason).toBe('approved by verifier')
    expect(history.every((t) => t.at >= history[0]!.at)).toBe(true)
  })

  it('walks the rejection loop: verifying → rejected → retry → running', () => {
    const id = machineTask([])
    manager.applyTransition(id, 'in_progress')
    manager.applyTransition(id, 'testing')
    manager.applyTransition(id, 'verifying')
    const rejected = manager.applyTransition(id, 'rejected', 'unrelated change detected')
    expect(rejected.status).toBe('rejected')
    const retried = manager.applyTransition(id, 'retry')
    expect(retried.status).toBe('retry')
    const running = manager.applyTransition(id, 'running')
    expect(running.status).toBe('running')
  })

  it('escalates: verifying → human_required → running after approval', () => {
    const id = machineTask([])
    manager.applyTransition(id, 'in_progress')
    manager.applyTransition(id, 'testing')
    manager.applyTransition(id, 'verifying')
    const escalated = manager.applyTransition(id, 'human_required', 'ambiguous DoD')
    expect(escalated.status).toBe('human_required')
    const resumed = manager.applyTransition(id, 'running')
    expect(resumed.status).toBe('running')
  })

  it('reaches FAILED and INTERRUPTED terminal/recoverable states', () => {
    const failed = machineTask([])
    manager.applyTransition(failed, 'in_progress')
    expect(manager.applyTransition(failed, 'failed', 'environment broken').status).toBe('failed')
    expect(() => manager.applyTransition(failed, 'running')).toThrow(TaskManagerError)

    const interrupted = machineTask([])
    manager.applyTransition(interrupted, 'in_progress')
    expect(manager.applyTransition(interrupted, 'interrupted', 'app quit').status).toBe(
      'interrupted',
    )
    expect(manager.applyTransition(interrupted, 'running', 'resumed').status).toBe('running')
  })

  it('rejects invalid transitions mechanically', () => {
    const skipper = machineTask(['created'])
    expect(() => manager.applyTransition(skipper, 'running')).toThrow(/Invalid transition/)
    expect(() => manager.applyTransition(skipper, 'verifying')).toThrow(/Invalid transition/)

    const done = machineTask([])
    manager.applyTransition(done, 'done')
    expect(() => manager.applyTransition(done, 'running')).toThrow(/Invalid transition/)
  })

  it('terminal states persist across restart', () => {
    const id = machineTask([])
    manager.applyTransition(id, 'in_progress')
    manager.applyTransition(id, 'testing')
    manager.applyTransition(id, 'interrupted', 'crash')

    db.close()
    db = SqliteDb.open(join(dir, 'studio.db'))
    migrate(db)
    transitions = new TaskTransitionRepository(db)
    manager = new TaskManager({
      tasks: new TaskRepository(db),
      goals: new GoalRepository(db),
      activity: new ActivityRepository(db),
      transitions,
    })

    const restored = db.get('SELECT status FROM tasks WHERE id = ?', id)
    expect(restored?.status).toBe('interrupted')
    const history = manager.transitionHistory(id)
    expect(history.map((t) => `${t.from}→${t.to}`)).toContain('testing→interrupted')
  })
})
