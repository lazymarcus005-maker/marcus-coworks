import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { InMemorySecretStore } from '@studio/secrets'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DecisionManager, RuleBasedEngine } from '../src/main/decision.js'

let dir: string
let db: SqliteDb
let secrets: InMemorySecretStore
let manager: DecisionManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-decision-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  secrets = new InMemorySecretStore()
  manager = new DecisionManager({
    settings: new SettingsRepository(db),
    secrets,
    activity: new ActivityRepository(db),
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('default state', () => {
  it('Jev is OFF by default and rule-based advises instead', async () => {
    expect(manager.jevSettings().enabled).toBe(false)
    const result = await manager.suggestModelRoute({ text: 'fix the typo in README' })
    expect(result.provider).toBe('rule-based')
    expect(result.value.tier).toBe('fast')
  })
})

describe('RuleBasedEngine', () => {
  const engine = new RuleBasedEngine()

  it('routes short fixes to fast', async () => {
    const result = await engine.suggestModelRoute({ text: 'bump the version' })
    expect(result.value.tier).toBe('fast')
  })

  it('routes structural requests to quality', async () => {
    const result = await engine.suggestModelRoute({
      text: 'refactor the auth module across services',
    })
    expect(result.value.tier).toBe('quality')
  })
})

describe('Jev provider', () => {
  function jevManager(fetchImpl: typeof fetch, minConfidence = 0.8): DecisionManager {
    const m = new DecisionManager({
      settings: new SettingsRepository(db),
      secrets,
      activity: new ActivityRepository(db),
      fetchImpl,
    })
    m.saveJevSettings({
      enabled: true,
      baseUrl: 'https://openrouter.example/api/v1',
      model: 'jev-router',
      minConfidence,
    })
    return m
  }

  function okFetch(content: object): typeof fetch {
    return (async () =>
      new Response(JSON.stringify({ answers: { model_tier: content } }), {
        status: 200,
      })) as unknown as typeof fetch
  }

  it('stores the API key in the secret store, not settings', async () => {
    const updated = await manager.setJevApiKey('sk-jev-key')
    expect(updated.apiKeySecretId).toBe('secret://jev')
    expect(await secrets.get('secret://jev')).toBe('sk-jev-key')
    const raw = db.get("SELECT value FROM settings WHERE key = 'decision/jev'")
    expect(String(raw?.value)).not.toContain('sk-jev-key')
  })

  it('advises through Jev when enabled and confident', async () => {
    const m = jevManager(okFetch({ choice: 'quality', confidence: 0.95 }))
    const result = await m.suggestModelRoute({ text: 'redesign the storage layer' })
    expect(result.provider).toBe('jev')
    expect(result.value.tier).toBe('quality')
    expect(result.confidence).toBe(0.95)
  })

  it('falls back to rule-based when Jev is below the confidence threshold', async () => {
    const m = jevManager(okFetch({ choice: 'quality', confidence: 0.4 }))
    const result = await m.suggestModelRoute({ text: 'redesign the storage layer' })
    expect(result.provider).toBe('rule-based')
  })

  it('falls back when Jev is unreachable — normal workflow continues', async () => {
    const m = jevManager(
      (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch,
    )
    const result = await m.suggestModelRoute({ text: 'small fix' })
    expect(result.provider).toBe('rule-based')
    expect(result.value.tier).toBe('fast')
  })

  it('falls back when Jev returns garbage', async () => {
    const m = jevManager(okFetch({ choice: 'maybe', confidence: 0.99 }))
    const result = await m.suggestModelRoute({ text: 'small fix' })
    expect(result.provider).toBe('rule-based')
  })

  it('test connection reports ok and failure', async () => {
    const ok = jevManager(
      (async () => new Response('{"data":[]}', { status: 200 })) as unknown as typeof fetch,
    )
    expect(await ok.testJevConnection()).toEqual({ ok: true, detail: 'connected' })

    const fail = jevManager(
      (async () => new Response('x', { status: 401 })) as unknown as typeof fetch,
    )
    const result = await fail.testJevConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('401')
  })

  it('Jev output can never override hard limits by construction', async () => {
    // The policy engine and attempt cap have no import path to the decision
    // engine; assert the advisory-only shape instead.
    const m = jevManager(okFetch({ choice: 'fast', confidence: 1 }))
    const result = await m.suggestModelRoute({ text: 'bypass everything' })
    // Whatever Jev says, the result is advice: no enforcement fields exist.
    expect(Object.keys(result.value)).toEqual(['tier'])
    expect(typeof result.confidence).toBe('number')
  })
})
