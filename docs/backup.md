# Backup & migration

## What lives where

| Data | Location |
|---|---|
| Durable state (projects, tabs, tasks, goals, attempts, evidence, activity, settings) | `userData/studio.db` (SQLite) |
| Verification logs | `userData/verification-logs/` |
| Worktree patches | `<repo>/.agent-studio/patches/` |
| Worktrees | `<repo>/.agent-studio/worktrees/` |
| API keys | macOS Keychain (never in the db) |

## Backup

Back up `studio.db` while the app is **closed**, or use SQLite's
`VACUUM INTO` (the backup API in `@studio/persistence`) for a
consistent online snapshot. Copy `verification-logs/` alongside it if you
want the full output logs.

Restoring replaces the live database contents from the snapshot; schema
migrations re-run on the next launch, and worktrees are reconciled
(vanished directories marked stale) automatically at startup.

## Settings export

Settings (network profile, budgets, templates, scheduler limits) live in
the `settings` table and can be exported as JSON. Exports filter out any
`secret://` material — keys stay in the Keychain and must be re-entered
on a new machine.

## Upgrades

Migrations are incremental and repeatable; upgrading the app in place
preserves all user and project state. Restart-restore is covered by E2E
tests (projects, tabs, active tab, sessions, task history).
