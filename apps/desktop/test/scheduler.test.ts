import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, SchedulerService } from '../src/main/scheduler.js'

let dir: string
let db: SqliteDb

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-sched-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeScheduler(): SchedulerService {
  return new SchedulerService({
    settings: new SettingsRepository(db),
    activity: new ActivityRepository(db),
    now: () => new Date(),
  })
}

describe('SchedulerService', () => {
  it('default limits: remote 4, local 1, shell 4', () => {
    const scheduler = makeScheduler()
    expect(scheduler.getLimits()).toEqual(DEFAULT_LIMITS)
  })

  it('enforces concurrency: local LLM at 1 serializes', async () => {
    const scheduler = makeScheduler()
    scheduler.setLimit('local-llm', 1)

    const first = await scheduler.acquire('local-llm')
    expect(scheduler.snapshot().running['local-llm']).toBe(1)

    let secondGranted = false
    const second = scheduler.acquire('local-llm').then((ticket) => {
      secondGranted = true
      return ticket
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(secondGranted).toBe(false)
    expect(scheduler.snapshot().queue).toHaveLength(1)

    scheduler.release(first)
    const secondTicket = await second
    expect(secondGranted).toBe(true)
    scheduler.release(secondTicket)
    expect(scheduler.snapshot().running['local-llm']).toBe(0)
  })

  it('a local LLM at concurrency 1 coexists with other resources and projects', async () => {
    const scheduler = makeScheduler()
    scheduler.setLimit('local-llm', 1)

    const localA = await scheduler.acquire('local-llm', { label: 'project A' })
    const remoteB = await scheduler.acquire('remote-llm', { label: 'project B (remote provider)' })
    const shellC = await scheduler.acquire('shell', { label: 'project C verification' })

    expect(localA).toBeTruthy()
    expect(remoteB).toBeTruthy()
    expect(shellC).toBeTruthy()
    const snapshot = scheduler.snapshot()
    expect(snapshot.running).toEqual({ 'remote-llm': 1, 'local-llm': 1, shell: 1 })
    expect(snapshot.queue).toHaveLength(0)

    scheduler.release(localA)
    scheduler.release(remoteB)
    scheduler.release(shellC)
  })

  it('the priority queue admits the highest priority first', async () => {
    const scheduler = makeScheduler()
    scheduler.setLimit('remote-llm', 1)
    const holder = await scheduler.acquire('remote-llm')

    const order: string[] = []
    const low = scheduler.acquire('remote-llm', { priority: 0 }).then((t) => {
      order.push('low')
      scheduler.release(t)
      return t
    })
    const high = scheduler.acquire('remote-llm', { priority: 10 }).then((t) => {
      order.push('high')
      scheduler.release(t)
      return t
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    scheduler.release(holder)
    await Promise.all([low, high])
    expect(order).toEqual(['high', 'low'])
  })

  it('cancel rejects a waiting acquisition', async () => {
    const scheduler = makeScheduler()
    scheduler.setLimit('shell', 1)
    const holder = await scheduler.acquire('shell')

    const waiting = scheduler.acquire('shell')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const queued = scheduler.snapshot().queue[0]
    expect(queued).toBeTruthy()
    scheduler.cancel(queued!.ticketId)

    await expect(waiting).rejects.toThrow(/cancelled/)
    scheduler.release(holder)
  })

  it('raising a limit admits waiting entries via drain', async () => {
    const scheduler = makeScheduler()
    scheduler.setLimit('shell', 1)
    const holder = await scheduler.acquire('shell')
    const waiting = scheduler.acquire('shell')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(scheduler.snapshot().queue).toHaveLength(1)

    scheduler.setLimit('shell', 2)
    const ticket = await waiting
    expect(ticket).toBeTruthy()
    scheduler.release(holder)
    scheduler.release(ticket)
  })

  it('limits persist across restart', () => {
    const first = makeScheduler()
    first.setLimit('remote-llm', 7)
    const second = makeScheduler()
    expect(second.getLimits()['remote-llm']).toBe(7)
  })

  it('rejects invalid limits', () => {
    const scheduler = makeScheduler()
    expect(() => scheduler.setLimit('shell', 0)).toThrow(/positive integer/)
    expect(() => scheduler.setLimit('shell', 1.5)).toThrow(/integer/)
  })
})
