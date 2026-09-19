import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ModeManager } from '../src/main/modes.js'

let dir: string
let db: SqliteDb
let modes: ModeManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-modes-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  modes = new ModeManager({
    settings: new SettingsRepository(db),
    activity: new ActivityRepository(db),
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ModeManager', () => {
  it('new projects default to L2 Assisted with auto model mode', () => {
    expect(modes.forProject('new-project')).toEqual({ autonomy: 'L2', modelMode: 'auto' })
    expect(modes.isAutonomousAllowed('new-project')).toBe(true)
  })

  it('autonomy gates are mechanical per level', () => {
    modes.setAutonomy('p-l0', 'L0')
    expect(() => modes.assertCanRunAutonomous('p-l0', 'start an attempt')).toThrow(/L0/)

    modes.setAutonomy('p-l1', 'L1')
    expect(() => modes.assertCanRunAutonomous('p-l1', 'run the verifier')).toThrow(/L1/)
    // Inspection still allowed at L1 (no gate on reads).
    expect(modes.isAutonomousAllowed('p-l1')).toBe(false)

    modes.setAutonomy('p-l1', 'L2')
    expect(() => modes.assertCanRunAutonomous('p-l1', 'start an attempt')).not.toThrow()

    modes.setAutonomy('p-l1', 'L3')
    expect(modes.isAutonomousAllowed('p-l1')).toBe(true)
  })

  it('model modes are separate from autonomy', () => {
    modes.setAutonomy('p-mm', 'L1')
    modes.setModelMode('p-mm', 'quality')
    const settings = modes.forProject('p-mm')
    expect(settings).toEqual({ autonomy: 'L1', modelMode: 'quality' })
  })

  it('changes are audited and persist across restart', () => {
    modes.setAutonomy('p-persist', 'L1')
    modes.setModelMode('p-persist', 'fast')

    const restored = new ModeManager({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
    })
    expect(restored.forProject('p-persist')).toEqual({ autonomy: 'L1', modelMode: 'fast' })

    const events = db.all("SELECT * FROM activity_events WHERE type = 'modes.autonomy'")
    expect(events.some((row) => String(row.project_id) === 'p-persist')).toBe(true)
  })
})
