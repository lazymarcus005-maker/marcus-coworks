import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { categorize, NetworkEventRepository, NetworkPolicyManager } from '../src/main/network.js'

let dir: string
let db: SqliteDb
let manager: NetworkPolicyManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-net-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  const stubFetch = (async (_url: string | URL | Request, init?: ResponseInit) =>
    new Response('ok', { status: 200, ...init })) as unknown as typeof fetch
  manager = new NetworkPolicyManager({
    db,
    settings: new SettingsRepository(db),
    activity: new ActivityRepository(db),
    events: new NetworkEventRepository(db),
    fetchImpl: stubFetch,
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('categorize', () => {
  it('classifies destinations', () => {
    expect(categorize('https://llm.company.local/v1/models')).toBe('llm')
    expect(categorize('https://gitlab.com/api')).toBe('git')
    expect(categorize('https://registry.npmjs.org/x')).toBe('registry')
    expect(categorize('http://127.0.0.1:8000/v1')).toBe('localhost')
    expect(categorize('https://random.example/x')).toBe('unknown')
  })
})

describe('NetworkPolicyManager', () => {
  it('developer profile allows and records unknown destinations', async () => {
    const response = await manager.fetch('https://random.example/api')
    expect(response).toBeInstanceOf(Response)
    const events = manager.listEvents()
    expect(events[0]).toMatchObject({ allowed: true, category: 'unknown' })
  })

  it('safe profile blocks unknown destinations BEFORE the request and records the block', async () => {
    manager.setPolicy({ profile: 'safe' })
    await expect(manager.fetch('https://random.example/api')).rejects.toThrow(
      /Blocked by network policy/,
    )

    const events = manager.listEvents()
    expect(events[0]?.allowed).toBe(false)

    // Configured LLM traffic still flows.
    const ok = await manager.fetch('https://llm.company.local/v1/models')
    expect(ok).toBeInstanceOf(Response)
  })

  it('safe profile still permits localhost endpoints', async () => {
    const ok = await manager.fetch('http://127.0.0.1:4000/v1/models')
    expect(ok).toBeInstanceOf(Response)
  })

  it('custom profile enforces the allowlist', async () => {
    manager.setPolicy({ profile: 'custom', customAllowlist: ['git.company.local'] })
    await expect(manager.fetch('https://random.example/api')).rejects.toThrow(/allowlist/)
    const ok = await manager.fetch('https://git.company.local/api/v4/projects')
    expect(ok).toBeInstanceOf(Response)
  })

  it('autonomous profile allows everything but keeps recording', async () => {
    manager.setPolicy({ profile: 'autonomous' })
    await manager.fetch('https://random.example/api')
    const events = manager.listEvents()
    expect(events[0]?.allowed).toBe(true)
    expect(events[0]?.category).toBe('unknown')
  })

  it('policy changes are audited', () => {
    const events = db.all("SELECT * FROM activity_events WHERE type = 'network.policy'")
    expect(events.length).toBeGreaterThanOrEqual(3)
  })

  it('events carry method and byte counts', async () => {
    manager.setPolicy({ profile: 'developer' })
    await manager.fetch('https://random.example/api', { method: 'POST', body: 'hello' })
    const events = manager.listEvents()
    expect(events[0]).toMatchObject({ method: 'POST', bytes: 5 })
  })
})
