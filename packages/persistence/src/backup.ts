import type { SqliteDb } from './database.js'

/**
 * Backup & restore (P5.7). Uses SQLite's VACUUM INTO for a consistent,
 * online-safe snapshot, plus settings export that excludes secrets.
 */
export function backupDatabase(db: SqliteDb, targetPath: string): void {
  db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`)
}

export function restoreDatabase(db: SqliteDb, backupPath: string): void {
  // Replaces the live database contents from a backup file, creating any
  // tables that do not exist yet in the target.
  const quoted = backupPath.replace(/'/g, "''")
  db.exec(`ATTACH DATABASE '${quoted}' AS backup_restored`)
  try {
    const backupTables = db.all(
      "SELECT name, sql FROM backup_restored.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ) as { name: string; sql: string }[]

    db.transaction(() => {
      for (const table of backupTables) {
        const exists = db.get(
          "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name = ?",
          table.name,
        )
        if (exists === undefined) {
          db.exec(table.sql)
        }
        const columns = (
          db.all(`PRAGMA backup_restored.table_info('${table.name}')`) as { name: string }[]
        )
          .map((column) => column.name)
          .join(', ')
        db.exec(`DELETE FROM main.${table.name}`)
        db.exec(
          `INSERT INTO main.${table.name} (${columns}) SELECT ${columns} FROM backup_restored.${table.name}`,
        )
      }
    })
  } finally {
    db.exec('DETACH DATABASE backup_restored')
  }
}

export function exportSettings(settings: {
  get(key: string): string | undefined
  keys(): string[]
}): Record<string, string> {
  // Never export secret material — settings only ever hold references,
  // but filter defensively anyway.
  const exported: Record<string, string> = {}
  for (const key of settings.keys()) {
    if (key.startsWith('secret://')) continue
    const value = settings.get(key)
    if (value !== undefined) exported[key] = value
  }
  return exported
}
