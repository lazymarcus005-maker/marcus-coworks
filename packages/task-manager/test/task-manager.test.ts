import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  GoalRepository,
  migrate,
  SqliteDb,
  TaskRepository,
} from '@studio/persistence'
import type { RuntimeTodo } from '@studio/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TaskManager, TaskManagerError } from '../src/task-manager.js'

let dir: string
let db: SqliteDb
let manager: TaskManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-tasks-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  manager = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity: new ActivityRepository(db),
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('TaskManager', () => {
  it('intake creates a goal draft and initial task container for substantial requests', () => {
    const objective = `Fix the login timeout for the gateway service. The timeout fires after 3s and ${'x'.repeat(80)}`
    const result = manager.intakeSubstantialRequest('proj-1', objective)
    expect(result.created).toBe(true)
    expect(result.goal.status).toBe('draft')
    expect(result.goal.objective).toContain('login timeout')
    expect(result.task.title).toBe('Break down this goal into tasks')
  })

  it('reuses the open goal instead of creating duplicates', () => {
    const again = manager.intakeSubstantialRequest(
      'proj-1',
      'Another substantial request '.repeat(5),
    )
    expect(again.created).toBe(false)
    const state = manager.stateForProject('proj-1')
    expect(state.goal?.objective).toContain('login timeout')
  })

  it('does not create goals for quick requests (caller guards with the heuristic)', () => {
    expect(manager.stateForProject('proj-2').goal).toBeUndefined()
  })

  it('add / edit / cancel tasks with validation', () => {
    const task = manager.addTask('proj-1', { title: 'Write regression test' })
    expect(task.status).toBe('pending')

    const started = manager.updateTask(task.id, { status: 'in_progress' })
    expect(started.status).toBe('in_progress')

    expect(() => manager.updateTask(task.id, { title: '' })).toThrow(TaskManagerError)

    const cancelled = manager.cancelTask(task.id)
    expect(cancelled.status).toBe('cancelled')

    // cancelled is terminal
    expect(() => manager.updateTask(task.id, { status: 'in_progress' })).toThrow(
      /Invalid transition/,
    )
  })

  it('task state survives a restart (repo reopen)', () => {
    db.close()
    db = SqliteDb.open(join(dir, 'studio.db'))
    migrate(db)
    manager = new TaskManager({
      tasks: new TaskRepository(db),
      goals: new GoalRepository(db),
      activity: new ActivityRepository(db),
    })
    const state = manager.stateForProject('proj-1')
    expect(state.goal?.status).toBe('draft')
    expect(state.tasks.map((task) => task.status)).toContain('cancelled')
    expect(state.tasks.map((task) => task.title)).toContain('Write regression test')
  })
})

describe('OpenCode TODO sync', () => {
  const todos: RuntimeTodo[] = [
    { id: 't1', content: 'Analyze timeout path', status: 'in_progress', priority: 'high' },
    { id: 't2', content: 'Implement fix', status: 'pending', priority: 'medium' },
  ]

  it('creates durable tasks from runtime todos', () => {
    manager.syncOpenCodeTodos('proj-sync', todos)
    const tasks = manager.stateForProject('proj-sync').tasks
    expect(tasks.map((task) => task.id)).toEqual(['oc:t1', 'oc:t2'])
    expect(tasks[0]).toMatchObject({
      title: 'Analyze timeout path',
      status: 'in_progress',
      source: 'opencode',
    })
    expect(tasks[1]).toMatchObject({ status: 'pending' })
  })

  it('is idempotent for an unchanged list', () => {
    manager.syncOpenCodeTodos('proj-sync', todos)
    manager.syncOpenCodeTodos('proj-sync', todos)
    expect(manager.stateForProject('proj-sync').tasks).toHaveLength(2)
  })

  it('maps completed and cancels vanished todos', () => {
    manager.syncOpenCodeTodos('proj-sync', [
      { id: 't1', content: 'Analyze timeout path', status: 'completed', priority: 'high' },
    ])
    const tasks = manager.stateForProject('proj-sync').tasks
    const t1 = tasks.find((task) => task.id === 'oc:t1')
    const t2 = tasks.find((task) => task.id === 'oc:t2')
    expect(t1?.status).toBe('done')
    expect(t2?.status).toBe('cancelled')
  })

  it('keeps user tasks untouched by sync', () => {
    const userTask = manager.addTask('proj-sync', { title: 'Manual task' })
    manager.syncOpenCodeTodos('proj-sync', [])
    const kept = manager.stateForProject('proj-sync').tasks.find((task) => task.id === userTask.id)
    expect(kept?.status).toBe('pending')
    expect(kept?.source).toBe('user')
  })
})

describe('Goal Contract', () => {
  it('persists all contract fields and survives restart', () => {
    const goal = manager.createGoalDraft('proj-goal', 'Ship auth refactor')
    const updated = manager.updateGoalContract(goal.id, {
      objective: 'Ship auth refactor safely',
      scope: ['src/Auth/**', 'tests/Auth/**'],
      nonGoals: ['no authentication redesign'],
      constraints: ['.NET 10', 'no TLS validation bypass'],
      doneWhen: ['build passes', 'unit tests pass', 'no unrelated files modified'],
      risk: 'high',
      maxAttempts: 2,
      autonomy: 'L2 Assisted',
    })

    expect(updated).toMatchObject({
      objective: 'Ship auth refactor safely',
      scope: ['src/Auth/**', 'tests/Auth/**'],
      nonGoals: ['no authentication redesign'],
      constraints: ['.NET 10', 'no TLS validation bypass'],
      doneWhen: ['build passes', 'unit tests pass', 'no unrelated files modified'],
      risk: 'high',
      maxAttempts: 2,
      autonomy: 'L2 Assisted',
      status: 'draft',
    })

    // Restart: new manager over the same database.
    const state = manager.stateForProject('proj-goal')
    expect(state.goal?.doneWhen).toHaveLength(3)
    expect(state.goal?.risk).toBe('high')
  })

  it('validates maxAttempts bounds', () => {
    const goal = manager.createGoalDraft('proj-bounds', 'x')
    expect(() => manager.updateGoalContract(goal.id, { maxAttempts: 0 })).toThrow(/1 and 10/)
    expect(() => manager.updateGoalContract(goal.id, { maxAttempts: 1.5 })).toThrow(/integer/)
  })

  it('follows the goal state machine with terminal states', () => {
    const goal = manager.createGoalDraft('proj-lifecycle', 'y')
    const ready = manager.updateGoalContract(goal.id, { status: 'ready' })
    expect(ready.status).toBe('ready')
    const active = manager.updateGoalContract(goal.id, { status: 'active' })
    expect(active.status).toBe('active')
    const done = manager.updateGoalContract(goal.id, { status: 'done' })
    expect(done.status).toBe('done')

    // Terminal.
    expect(() => manager.updateGoalContract(goal.id, { status: 'active' })).toThrow(
      /Invalid goal transition/,
    )

    // No skipping draft → active.
    const g2 = manager.createGoalDraft('proj-lifecycle-2', 'z')
    expect(() => manager.updateGoalContract(g2.id, { status: 'active' })).toThrow(
      /Invalid goal transition/,
    )
  })

  it('locks structural fields once ready or active', () => {
    const goal = manager.createGoalDraft('proj-locked', 'w')
    manager.updateGoalContract(goal.id, { status: 'ready' })
    expect(() => manager.updateGoalContract(goal.id, { scope: ['x'] })).toThrow(/locked/)
    // Objective and autonomy stay editable.
    const updated = manager.updateGoalContract(goal.id, {
      objective: 'w (revised)',
      autonomy: 'L1 Report',
    })
    expect(updated.objective).toBe('w (revised)')
    expect(updated.autonomy).toBe('L1 Report')
  })

  it('completing a goal-linked task references the Definition of Done', () => {
    const goal = manager.createGoalDraft('proj-dod', 'Do the thing')
    manager.updateGoalContract(goal.id, {
      doneWhen: ['tests pass', 'docs updated'],
    })
    const task = manager.addTask('proj-dod', { title: 'Implement', goalId: goal.id })
    manager.updateTask(task.id, { status: 'in_progress' })
    manager.updateTask(task.id, { status: 'done' })

    const events = db.all(
      "SELECT * FROM activity_events WHERE type = 'goal.dod-reference' AND project_id = ?",
      'proj-dod',
    )
    expect(events).toHaveLength(1)
    const payload = JSON.parse(String(events[0]?.payload_json)) as { unverifiedCriteria: string[] }
    expect(payload.unverifiedCriteria).toEqual(['tests pass', 'docs updated'])
  })
})
