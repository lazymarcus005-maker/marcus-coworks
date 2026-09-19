import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, LockRepository, migrate, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LockManager } from '../src/lock-manager.js'

let dir: string
let db: SqliteDb
let manager: LockManager
let clock: number

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-locks-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  clock = Date.parse('2026-09-19T10:00:00Z')
  manager = new LockManager({
    locks: new LockRepository(db),
    activity: new ActivityRepository(db),
    now: () => new Date(clock),
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function advance(ms: number): void {
  clock += ms
}

describe('LockManager', () => {
  it('grants non-overlapping scopes concurrently', () => {
    const a = manager.acquire({ projectId: 'p1', ownerTaskId: 't1', patterns: ['src/Auth/**'] })
    const b = manager.acquire({ projectId: 'p1', ownerTaskId: 't2', patterns: ['src/Billing/**'] })
    expect(a.granted).toBe(true)
    expect(b.granted).toBe(true)
  })

  it('blocks overlapping scopes and records a waiting lock with the holder', () => {
    const result = manager.acquire({
      projectId: 'p1',
      ownerTaskId: 't3',
      patterns: ['src/Auth/login.ts'],
    })
    expect(result.granted).toBe(false)
    if (result.granted) throw new Error('unreachable')
    expect(result.lock.status).toBe('waiting')
    expect(result.conflict.ownerTaskId).toBe('t1')
    expect(result.conflict.patterns).toEqual(['src/Auth/**'])
  })

  it('blocks logical resources (branch/pr) by exact identity', () => {
    const a = manager.acquire({
      projectId: 'p2',
      ownerTaskId: 't1',
      patterns: ['branch:feature/x'],
    })
    const b = manager.acquire({
      projectId: 'p2',
      ownerTaskId: 't2',
      patterns: ['branch:feature/x'],
    })
    expect(a.granted).toBe(true)
    expect(b.granted).toBe(false)
    const c = manager.acquire({
      projectId: 'p2',
      ownerTaskId: 't3',
      patterns: ['branch:feature/y'],
    })
    expect(c.granted).toBe(true)
  })

  it('release promotes the first waiting lock FIFO', () => {
    const holder = manager.acquire({
      projectId: 'p3',
      ownerTaskId: 't-holder',
      patterns: ['package.json'],
    })
    if (!holder.granted) throw new Error('holder not granted')
    const waiter1 = manager.acquire({
      projectId: 'p3',
      ownerTaskId: 't-wait-1',
      patterns: ['package.json'],
    })
    const waiter2 = manager.acquire({
      projectId: 'p3',
      ownerTaskId: 't-wait-2',
      patterns: ['package.json'],
    })
    expect(waiter1.granted).toBe(false)
    expect(waiter2.granted).toBe(false)

    manager.release(holder.lock.id)

    const locks = manager.listForProject('p3')
    const promoted = locks.find((lock) => lock.ownerTaskId === 't-wait-1')
    const stillWaiting = locks.find((lock) => lock.ownerTaskId === 't-wait-2')
    expect(promoted?.status).toBe('active')
    expect(stillWaiting?.status).toBe('waiting')

    // Releasing the promoted lock hands the scope to the second waiter.
    manager.release(promoted!.id)
    const after = manager.listForProject('p3')
    expect(after.find((lock) => lock.ownerTaskId === 't-wait-2')?.status).toBe('active')
  })

  it('expired TTL frees the scope and marks the lock stale', () => {
    const held = manager.acquire({
      projectId: 'p4',
      ownerTaskId: 't-expired',
      patterns: ['src/Temp/**'],
      ttlMs: 1000,
    })
    if (!held.granted) throw new Error('not granted')

    advance(2000)
    const next = manager.acquire({
      projectId: 'p4',
      ownerTaskId: 't-fresh',
      patterns: ['src/Temp/file.ts'],
    })
    expect(next.granted).toBe(true)
    expect(manager.listForProject('p4').find((l) => l.ownerTaskId === 't-expired')?.status).toBe(
      'stale',
    )
  })

  it('waiting locks past their wait deadline are flagged escalated', () => {
    manager.acquire({ projectId: 'p5', ownerTaskId: 't-hold', patterns: ['docs/**'] })
    const waiting = manager.acquire({
      projectId: 'p5',
      ownerTaskId: 't-wait',
      patterns: ['docs/**'],
      waitTimeoutMs: 5000,
    })
    expect(waiting.granted).toBe(false)

    advance(6000)
    manager.reconcile('p5')

    const escalated = manager.listForProject('p5').find((l) => l.ownerTaskId === 't-wait')
    expect(escalated?.escalatedAt).toBeTruthy()

    const events = db.all(
      "SELECT * FROM activity_events WHERE type = 'lock.escalated' AND project_id = ?",
      'p5',
    )
    expect(events).toHaveLength(1)
  })

  it('releaseAllForTask cleans up active and waiting locks of a task', () => {
    manager.acquire({ projectId: 'p6', ownerTaskId: 't-a', patterns: ['area1/**'] })
    manager.acquire({ projectId: 'p6', ownerTaskId: 't-b', patterns: ['area1/**'] })
    manager.releaseAllForTask('t-a')
    const locks = manager.listForProject('p6')
    expect(locks.find((l) => l.ownerTaskId === 't-a')?.status).toBe('released')
    expect(locks.find((l) => l.ownerTaskId === 't-b')?.status).toBe('active')
  })

  it('lock state survives restart and reconciles', () => {
    db.close()
    db = SqliteDb.open(join(dir, 'studio.db'))
    migrate(db)
    const restored = new LockManager({
      locks: new LockRepository(db),
      activity: new ActivityRepository(db),
      now: () => new Date(clock),
    })
    const p6 = restored.listForProject('p6')
    expect(p6.find((l) => l.ownerTaskId === 't-b')?.status).toBe('active')
  })
})
