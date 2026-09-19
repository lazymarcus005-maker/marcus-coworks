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

const MIGRATION_0002 = `
ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE tasks ADD COLUMN updated_at TEXT;
`

const MIGRATION_0003 = `
CREATE TABLE task_transitions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL
);
CREATE INDEX idx_task_transitions_task ON task_transitions(task_id, at);
`

const MIGRATION_0004 = `
CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  path TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  diff_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_worktrees_task ON worktrees(task_id, attempt);
CREATE INDEX idx_worktrees_project ON worktrees(project_id);
`

const MIGRATION_0005 = `
CREATE TABLE locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_task_id TEXT NOT NULL,
  owner_agent_id TEXT,
  patterns_json TEXT NOT NULL,
  status TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT,
  wait_deadline TEXT,
  escalated_at TEXT
);
CREATE INDEX idx_locks_project_status ON locks(project_id, status);
`

const MIGRATION_0006 = `
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  goal_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  decision TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_inbox_status ON inbox_items(status, created_at);
`

const MIGRATION_0007 = `
CREATE TABLE verification_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  worktree_id TEXT,
  attempt INTEGER,
  command TEXT NOT NULL,
  kind TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  passed INTEGER,
  failed INTEGER,
  duration_ms INTEGER NOT NULL,
  summary TEXT,
  output_path TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_task ON verification_evidence(task_id, started_at);
`

const MIGRATION_0008 = `
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  agent_id TEXT,
  model TEXT,
  worktree_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT,
  failure_class TEXT,
  summary TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_attempts_task ON attempts(task_id, attempt);
`

export const MIGRATIONS: Migration[] = [
  { id: 1, name: 'initial_schema', sql: MIGRATION_0001 },
  { id: 2, name: 'task_source_and_updated_at', sql: MIGRATION_0002 },
  { id: 3, name: 'task_transitions', sql: MIGRATION_0003 },
  { id: 4, name: 'worktrees', sql: MIGRATION_0004 },
  { id: 5, name: 'locks', sql: MIGRATION_0005 },
  { id: 6, name: 'inbox_items', sql: MIGRATION_0006 },
  { id: 7, name: 'evidence', sql: MIGRATION_0007 },
  { id: 8, name: 'attempts', sql: MIGRATION_0008 },
]

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
