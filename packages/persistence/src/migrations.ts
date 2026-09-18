import type { SqliteDb } from './database.js'

export type Migration = {
  id: number
  name: string
  sql: string
}

/**
 * Initial durable state per phase 1 plan P1.2:
 * projects, project_tabs, active_tab, sessions, goals, tasks, settings,
 * providers, activity_events.
 *
 * goals/tasks/activity_events intentionally have no foreign key to projects
 * so per-project history can survive a "Remove Project" where the user
 * unchecked "Remove Agent Studio history".
 */
const MIGRATION_0001 = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'idle',
  session_id TEXT,
  model TEXT,
  branch TEXT,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE project_tabs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  opened_at TEXT NOT NULL
);

CREATE TABLE active_tab (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_id TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  runtime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '[]',
  non_goals_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  done_when_json TEXT NOT NULL DEFAULT '[]',
  risk TEXT NOT NULL DEFAULT 'medium',
  max_attempts INTEGER NOT NULL DEFAULT 3,
  autonomy TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  goal_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  parent_task_id TEXT,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  owner_agent_id TEXT,
  verifier_agent_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worktree_id TEXT,
  lock_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_secret_id TEXT,
  default_model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_activity_project_time ON activity_events(project_id, created_at);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_goals_project ON goals(project_id);
CREATE INDEX idx_sessions_project ON sessions(project_id);
`

export const MIGRATIONS: Migration[] = [{ id: 1, name: 'initial_schema', sql: MIGRATION_0001 }]

/** Applies pending migrations. Repeatable: already-applied ids are skipped. */
export function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(db.all('SELECT id FROM schema_migrations').map((row) => Number(row.id)))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.run(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
        migration.id,
        migration.name,
        new Date().toISOString(),
      )
    })
  }
}
