import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type SqlParam = string | number | null

export type SqlRow = Record<string, unknown>

/**
 * Thin wrapper over node:sqlite with the pragmas and helpers the
 * repositories rely on. No native compilation required.
 */
export class SqliteDb {
  private constructor(private readonly db: DatabaseSync) {}

  static open(file: string): SqliteDb {
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true })
    }
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    return new SqliteDb(db)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(
    sql: string,
    ...params: SqlParam[]
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const statement = this.db.prepare(sql)
    const result = statement.run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  get(sql: string, ...params: SqlParam[]): SqlRow | undefined {
    const statement = this.db.prepare(sql)
    return statement.get(...params) as SqlRow | undefined
  }

  all(sql: string, ...params: SqlParam[]): SqlRow[] {
    const statement = this.db.prepare(sql)
    return statement.all(...params) as SqlRow[]
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN')
    try {
      const result = fn()
      this.exec('COMMIT')
      return result
    } catch (error) {
      this.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}
