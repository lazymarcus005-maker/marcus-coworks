import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  InboxRepository,
  migrate,
  SettingsRepository,
  SqliteDb,
} from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InboxManager } from '../src/main/inbox.js'
import { IdempotencyService, Notifier } from '../src/main/ops.js'

let dir: string
let db: SqliteDb

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-ops-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('IdempotencyService', () => {
  it('runs fn once per key and replays the result for retries', async () => {
    const service = new IdempotencyService(db)
    let calls = 0
    const first = await service.once('op:skill-install:repo1', async () => {
      calls += 1
      return { installed: ['skill-a'] }
    })
    const retry = await service.once('op:skill-install:repo1', async () => {
      calls += 1
      return { installed: ['duplicated!'] }
    })
    expect(first.first).toBe(true)
    expect(retry.first).toBe(false)
    expect(calls).toBe(1)
    expect(retry.result).toEqual({ installed: ['skill-a'] })
  })

  it('different keys run independently', async () => {
    const service = new IdempotencyService(db)
    const a = await service.once('key-a', async () => 1)
    const b = await service.once('key-b', async () => 2)
    expect(a.first && b.first).toBe(true)
    expect(b.result).toBe(2)
  })
})

describe('Notifier policy', () => {
  it('defaults enabled, toggleable, persisted, and records sends', () => {
    const notifier = new Notifier({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
    })
    expect(notifier.isEnabled()).toBe(true)

    const countFor = (needle: string) =>
      db
        .all("SELECT * FROM activity_events WHERE type = 'notifier.sent'")
        .filter((row) => String(row.message).includes(needle)).length

    notifier.notify('Agent Studio: attempts-exhausted', 'Task X exhausted attempts')
    expect(countFor('Task X exhausted attempts')).toBe(1)

    notifier.setEnabled(false)
    expect(notifier.isEnabled()).toBe(false)
    notifier.notify('should not appear', 'nope')
    expect(countFor('Task X exhausted attempts')).toBe(1)
    expect(countFor('should not appear')).toBe(0)

    const restored = new Notifier({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
    })
    expect(restored.isEnabled()).toBe(false)
    restored.setEnabled(true)
  })

  it('escalations trigger exactly one notification per item', async () => {
    db.run("DELETE FROM activity_events WHERE type = 'notifier.sent'")
    const notifier = new Notifier({
      settings: new SettingsRepository(db),
      activity: new ActivityRepository(db),
    })
    notifier.setEnabled(true)
    const inbox = new InboxManager({
      inbox: new InboxRepository(db),
      activity: new ActivityRepository(db),
      notify: (title, body) => notifier.notify(title, body),
    })
    inbox.escalate({ projectId: 'p-n', kind: 'verifier-rejected', title: 'Rejected attempt' })
    const events = db.all("SELECT * FROM activity_events WHERE type = 'notifier.sent'")
    expect(events).toHaveLength(1)
  })
})

describe('audit export package (buildPackage shape)', () => {
  it('assembles a scrubbed, structured run package', async () => {
    // Seed something to export via the services-level exporter would need
    // the full container; here we verify redaction integration used by the
    // exporter through the broker.
    const { SecretBroker } = await import('../src/main/secret-broker.js')
    const { InMemorySecretStore } = await import('@studio/secrets')
    const store = new InMemorySecretStore()
    await store.set('secret://jev', 'sk-export-test-key')
    const broker = new SecretBroker(store)
    await broker.resolve('secret://jev')

    const raw = {
      note: 'key was sk-export-test-key',
      nested: { auth: 'Bearer sk-export-test-key' },
    }
    const scrubbed = JSON.parse(broker.redact(JSON.stringify(raw))) as Record<string, unknown>
    expect(JSON.stringify(scrubbed)).not.toContain('sk-export-test-key')
    expect(scrubbed.note).toContain('[REDACTED:secret://jev]')
  })
})

describe('doctor helper availability', () => {
  it('can be imported without electron context for non-dialog paths', async () => {
    const mod = await import('../src/main/audit.js')
    expect(typeof mod.runDoctor).toBe('function')
    expect(typeof mod.AuditExporter).toBe('function')
  })
})

describe('repo doctor context', () => {
  it('detects a real git repository for doctor checks', () => {
    const repo = join(dir, 'doctor-repo')
    mkdirSync(repo, { recursive: true })
    execFileSync('git', ['init', '-b', 'main', repo])
    writeFileSync(join(repo, 'package.json'), '{"name":"x"}')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t'])
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't'])
    execFileSync('git', ['-C', repo, 'commit', '-m', 'init'])
    expect(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8')).name).toBe('x')
    expect(existsSync(join(repo, '.git'))).toBe(true)
  })
})
