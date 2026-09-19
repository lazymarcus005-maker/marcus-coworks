import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BudgetManager } from '../src/main/budgets.js'

let dir: string
let db: SqliteDb

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-budgets-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function make(): BudgetManager {
  return new BudgetManager({
    settings: new SettingsRepository(db),
    activity: new ActivityRepository(db),
  })
}

describe('BudgetManager', () => {
  it('ok when no limits are set', () => {
    const budgets = make()
    expect(budgets.recordUsage('p1', 999_999)).toBe('ok')
    expect(budgets.recordModelCall('p1')).toBe('ok')
  })

  it('warns above 80% and pauses above 100% of the token budget', () => {
    const budgets = make()
    budgets.setLimits({ dailyTokensPerProject: 1000 })
    expect(budgets.recordUsage('p-warn', 500)).toBe('ok')
    expect(budgets.recordUsage('p-warn', 350)).toBe('warn') // 85%
    expect(budgets.recordUsage('p-warn', 200)).toBe('pause') // 105%
  })

  it('downgrades to report-only past the model-call budget', () => {
    const budgets = make()
    budgets.setLimits({ dailyModelCallsPerProject: 3 })
    expect(budgets.recordModelCall('p-calls')).toBe('ok')
    expect(budgets.recordModelCall('p-calls')).toBe('ok')
    expect(budgets.recordModelCall('p-calls')).toBe('ok')
    expect(budgets.recordModelCall('p-calls')).toBe('downgrade-to-report')
  })

  it('tracks projects independently', () => {
    const budgets = make()
    budgets.setLimits({ dailyTokensPerProject: 100 })
    budgets.recordUsage('p-a', 150)
    expect(budgets.recordUsage('p-b', 10)).toBe('ok')
  })

  it('usage resets per day', () => {
    let clock = Date.parse('2026-09-19T10:00:00Z')
    const budgets = new BudgetManager({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
      now: () => new Date(clock),
    })
    budgets.setLimits({ dailyTokensPerProject: 100 })
    expect(budgets.recordUsage('p-day', 150)).toBe('pause')
    clock = Date.parse('2026-09-20T10:00:00Z')
    expect(budgets.recordUsage('p-day', 10)).toBe('ok')
  })

  it('limits persist across restart and reject invalid values', () => {
    const first = make()
    first.setLimits({ maxSubagents: 5 })
    expect(make().getLimits().maxSubagents).toBe(5)
    expect(() => first.setLimits({ maxSubagents: -1 })).toThrow(/Invalid budget/)
  })

  it('caps live outside agent reach: only setLimits mutates them', () => {
    // recordUsage/recordModelCall never modify limits.
    const budgets = make()
    budgets.setLimits({ dailyTokensPerProject: 10 })
    budgets.recordUsage('p-x', 1000)
    expect(budgets.getLimits().dailyTokensPerProject).toBe(10)
  })
})
