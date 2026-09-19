import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IsolationManager } from '../src/main/isolation.js'

let dir: string
let db: SqliteDb
let manager: IsolationManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-iso-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  manager = new IsolationManager({
    settings: new SettingsRepository(db),
    activity: new ActivityRepository(db),
    probe: async () => ({ runtime: 'docker', detail: 'stubbed daemon' }),
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('IsolationManager (P5.3)', () => {
  it('off by default; sandbox command is null while off', async () => {
    expect(manager.preference()).toBe('off')
    expect(await manager.workerServeCommand('/tmp/project', 4100)).toBeNull()
  })

  it('detects the container runtime and builds a mounted serve command', async () => {
    manager.setPreference('container')
    const detection = await manager.detect()
    expect(detection).toMatchObject({ available: true, runtime: 'docker' })

    const command = await manager.workerServeCommand('/tmp/project', 4100)
    expect(command).toContain('docker run --rm')
    expect(command).toContain('-v /tmp/project:/workspace')
    expect(command).toContain('serve --hostname 0.0.0.0 --port 4100')
  })

  it('returns null when no runtime exists even if preferred', async () => {
    const none = new IsolationManager({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
      probe: async () => ({ runtime: null, detail: 'no runtime' }),
    })
    none.setPreference('container')
    expect((await none.detect()).available).toBe(false)
    expect(await none.workerServeCommand('/tmp/project', 4100)).toBeNull()
  })

  it('preference persists and changes are audited', () => {
    manager.setPreference('off')
    expect(manager.preference()).toBe('off')
    const events = db.all("SELECT * FROM activity_events WHERE type = 'isolation.mode'")
    expect(events.length).toBeGreaterThanOrEqual(2)
  })
})
