import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, SqliteDb } from '../src/index.js'

let dir: string
let db: SqliteDb

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-migrations-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const EXPECTED_TABLES = [
  'projects',
  'project_tabs',
  'active_tab',
  'sessions',
  'goals',
  'tasks',
  'settings',
  'providers',
  'activity_events',
]

function tables(): string[] {
  return db
    .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => String(row.name))
}

describe('migrations', () => {
  it('creates all phase-1 tables', () => {
    migrate(db)
    const created = tables()
    for (const table of EXPECTED_TABLES) {
      expect(created).toContain(table)
    }
  })

  it('is repeatable — running again does not fail or duplicate', () => {
    migrate(db)
    migrate(db)
    const applied = db.all('SELECT id FROM schema_migrations')
    expect(applied).toHaveLength(MIGRATIONS.length)
  })

  it('applies incremental migrations to the tasks table', () => {
    const columns = db.all("PRAGMA table_info('tasks')").map((row) => String(row.name))
    expect(columns).toContain('source')
    expect(columns).toContain('updated_at')
  })

  it('stores plaintext-credential-free schema (providers reference secrets by id)', () => {
    const columns = db.all("PRAGMA table_info('providers')").map((row) => String(row.name))
    expect(columns).toContain('api_key_secret_id')
    expect(columns).not.toContain('api_key')
  })
})

describe('SqliteDb', () => {
  it('opens an in-memory database', () => {
    const mem = SqliteDb.open(':memory:')
    mem.exec('CREATE TABLE t (x TEXT)')
    mem.run('INSERT INTO t (x) VALUES (?)', 'hello')
    expect(mem.get('SELECT x FROM t')).toEqual({ x: 'hello' })
    mem.close()
  })

  it('rolls back transactions on error', () => {
    db.exec('CREATE TABLE IF NOT EXISTS tx_test (x TEXT)')
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO tx_test (x) VALUES ('a')")
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(db.get('SELECT COUNT(*) AS n FROM tx_test')).toEqual({ n: 0 })
  })
})
