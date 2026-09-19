import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PAUSE_STATE_KEY, PauseManager } from '../src/main/pause.js'

let dir: string
let db: SqliteDb
let pause: PauseManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-pause-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  const activity = new ActivityRepository(db)
  pause = new PauseManager({
    settings: new SettingsRepository(db),
    activity,
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('PauseManager', () => {
  it('global pause gates any project; resume is explicit', () => {
    expect(pause.isGloballyPaused()).toBe(false)
    pause.assertCanAct('p1', 'test')

    pause.setGlobal(true)
    expect(() => pause.assertCanAct('p1', 'send a message')).toThrow(/All agents are paused/)
    expect(() => pause.assertCanAct('p2', 'start an attempt')).toThrow(/All agents are paused/)

    pause.setGlobal(false)
    expect(() => pause.assertCanAct('p1', 'test')).not.toThrow()
  })

  it('project pause gates only that project', () => {
    pause.setProject('p1', true)
    expect(() => pause.assertCanAct('p1', 'test')).toThrow(/Project is paused/)
    expect(() => pause.assertCanAct('p2', 'test')).not.toThrow()

    pause.setProject('p1', false)
    expect(() => pause.assertCanAct('p1', 'test')).not.toThrow()
  })

  it('set idempotently and record activity transitions', () => {
    const before = db.all("SELECT * FROM activity_events WHERE type = 'pause.global'").length
    pause.setGlobal(true)
    pause.setGlobal(true)
    const after = db.all("SELECT * FROM activity_events WHERE type = 'pause.global'").length
    expect(after).toBe(before + 1)
    pause.setGlobal(false)
  })

  it('state persists across restart and resumes only explicitly', () => {
    pause.setGlobal(true)
    pause.setProject('p9', true)

    // Restart: new manager over the same db.
    const restored = new PauseManager({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
    })
    expect(restored.isGloballyPaused()).toBe(true)
    expect(restored.isProjectPaused('p9')).toBe(true)

    // Nothing auto-resumes.
    expect(() => restored.assertCanAct('p9', 'test')).toThrow(/paused/)

    restored.setGlobal(false)
    restored.setProject('p9', false)
    expect(restored.snapshot()).toEqual({ globalPaused: false, pausedProjects: [] })
    const persisted = new SettingsRepository(db).getJson(PAUSE_STATE_KEY, null)
    expect(persisted).toEqual({ globalPaused: false, pausedProjects: [] })
  })
})
