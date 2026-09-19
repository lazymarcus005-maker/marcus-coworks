import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  GoalRepository,
  InboxRepository,
  migrate,
  SqliteDb,
  TaskRepository,
  TaskTransitionRepository,
} from '@studio/persistence'
import { TaskManager } from '@studio/task-manager'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InboxManager } from '../src/main/inbox.js'

let dir: string
let db: SqliteDb
let inbox: InboxManager
let tasks: TaskManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-inbox-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  const transitions = new TaskTransitionRepository(db)
  inbox = new InboxManager({
    inbox: new InboxRepository(db),
    activity: new ActivityRepository(db),
  })
  tasks = new TaskManager({
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

describe('InboxManager', () => {
  it('escalates items with kind, linkage, and evidence', () => {
    const item = inbox.escalate({
      projectId: 'p1',
      taskId: 't-182',
      kind: 'attempts-exhausted',
      title: 'Task #182: verifier rejected attempt 3/3',
      detail: 'All attempts rejected; human review required.',
      evidenceIds: ['ev-1', 'ev-2'],
    })
    expect(item.status).toBe('open')

    const open = inbox.listOpen()
    expect(open.map((entry) => entry.id)).toContain(item.id)
    const stored = open.find((entry) => entry.id === item.id)
    expect(stored?.evidenceIds).toEqual(['ev-1', 'ev-2'])
    expect(stored?.taskId).toBe('t-182')
  })

  it('covers every escalation trigger kind from the spec', () => {
    const kinds = [
      'approval-required',
      'attempts-exhausted',
      'protected-path',
      'ambiguous-goal',
      'verifier-rejected',
      'lock-conflict',
      'security-sensitive',
      'budget-extension',
      'destructive-action',
    ] as const
    for (const kind of kinds) {
      inbox.escalate({ projectId: 'p-kinds', kind, title: `kind: ${kind}` })
    }
    const open = inbox.listOpen().filter((entry) => entry.projectId === 'p-kinds')
    expect(new Set(open.map((entry) => entry.kind))).toEqual(new Set(kinds))
  })

  it('resolves with approve/reject/dismiss exactly once', async () => {
    const item = inbox.escalate({ projectId: 'p2', kind: 'approval-required', title: 'Gate A' })
    const resolved = await inbox.resolve({ itemId: item.id, decision: 'approve', note: 'ok' })
    expect(resolved.item.status).toBe('resolved')
    expect(resolved.item.decision).toBe('approve')

    await expect(inbox.resolve({ itemId: item.id, decision: 'reject' })).rejects.toThrow(
      /already resolved/,
    )
    expect(inbox.listOpen().map((entry) => entry.id)).not.toContain(item.id)
    expect(inbox.listResolved().map((entry) => entry.id)).toContain(item.id)
  })

  it('resolves a human_required task back to running on approve', async () => {
    // Rebuild the inbox wired to the real task machine.
    const wiredInbox = new InboxManager({
      inbox: new InboxRepository(db),
      activity: new ActivityRepository(db),
      applyTaskTransition: (taskId, to, reason) => {
        tasks.applyTransition(taskId, to, reason)
      },
    })

    const task = tasks.addTask('p3', { title: 'Needs a human' })
    // Drive to human_required through the machine.
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    tasks.applyTransition(task.id, 'human_required', 'ambiguous DoD')

    const item = wiredInbox.escalate({
      projectId: 'p3',
      taskId: task.id,
      kind: 'ambiguous-goal',
      title: 'DoD ambiguous',
    })
    const { taskResumed } = await wiredInbox.resolve({
      itemId: item.id,
      decision: 'approve',
      note: 'clarified',
    })

    expect(taskResumed).toBe(true)
    expect(tasks.stateForProject('p3').tasks.find((t) => t.id === task.id)?.status).toBe('running')
    const history = tasks.transitionHistory(task.id)
    expect(history.some((t) => t.reason?.includes('approved via inbox'))).toBe(true)
  })

  it('persists decisions across restart', () => {
    db.close()
    db = SqliteDb.open(join(dir, 'studio.db'))
    migrate(db)
    const restored = new InboxManager({
      inbox: new InboxRepository(db),
      activity: new ActivityRepository(db),
    })
    const resolved = restored.listResolved()
    expect(resolved.length).toBeGreaterThanOrEqual(2)
    expect(
      resolved.every((item) => item.decidedAt !== undefined && item.decision !== undefined),
    ).toBe(true)
    expect(restored.listOpen().some((item) => item.kind === 'attempts-exhausted')).toBe(true)
  })
})
