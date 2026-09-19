import type { SqlRow } from '../database.js'

export class SettingsRepository {
  constructor(private readonly db: import('../database.js').SqliteDb) {}

  get(key: string): string | undefined {
    const row = this.db.get('SELECT value FROM settings WHERE key = ?', key) as SqlRow | undefined
    return row === undefined ? undefined : String(row.value)
  }

  set(key: string, value: string): void {
    this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value)
  }

  keys(): string[] {
    return this.db
      .all('SELECT key FROM settings ORDER BY key')
      .map((row) => String((row as { key: string }).key))
  }

  delete(key: string): void {
    this.db.run('DELETE FROM settings WHERE key = ?', key)
  }

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key)
    if (raw === undefined) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value))
  }
}
