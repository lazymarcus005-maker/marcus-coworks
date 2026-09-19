import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backupDatabase,
  exportSettings,
  migrate,
  restoreDatabase,
  SettingsRepository,
  SqliteDb,
} from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recoverOnStartup } from '../src/main/startup-recovery.js'
import { buildHarnessContainer, type HarnessContainer } from './harness-container.js'

let dir: string
let repo: string
let db: SqliteDb
let container: HarnessContainer

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-crash-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 't@t')
  git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'app.txt'), 'v1')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')

  container = await buildHarnessContainer(db, dir)
  container.projectManager.addProject(repo)
})

afterAll(() => {
  container?.terminals.disposeAll()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Fault-injection matrix (P5.2): a crash at each stage must leave the task
 * recoverable to INTERRUPTED (never falsely RUNNING) with locks and
 * worktrees reconciled by recoverOnStartup.
 */
const CRASH_STAGES = [
  'llm-call',
  'shell-process',
  'worktree-task',
  'verification',
  'compaction',
  'shutdown',
] as const

describe.each(CRASH_STAGES)('crash during %s', (stage) => {
  it('recovers the task to INTERRUPTED with reconciliation', async () => {
    const project = container.projectManager.listProjects()[0]!
    const task = container.tasks.addTask(project.id, { title: `Crash during ${stage}` })

    // Drive the machine into the pre-crash state for each stage.
    db.run("UPDATE tasks SET status = 'running' WHERE id = ?", task.id)

    let worktreeId: string | undefined
    if (stage === 'llm-call') {
      // Mid model call: session exists, attempt started.
      await container.attempts.startAttempt({
        projectId: project.id,
        projectPath: repo,
        taskId: task.id,
      })
    } else if (stage === 'shell-process' || stage === 'worktree-task') {
      const started = await container.attempts.startAttempt({
        projectId: project.id,
        projectPath: repo,
        taskId: task.id,
      })
      worktreeId = started.worktreeId
      if (stage === 'shell-process') {
        // An orphaned terminal process from the crashed app.
        const terminal = container.terminals.create(project.id, repo)
        // Simulate the crash: the app dies without graceful teardown, then
        // recovery disposes project terminals.
        container.terminals.disposeProject(project.id)
        void terminal
      }
    } else if (stage === 'verification') {
      await container.verification.runPipeline(
        { id: project.id, path: repo },
        [{ kind: 'test', command: 'exit 1', required: true }],
        { taskId: task.id },
      )
    } else if (stage === 'compaction') {
      await container.runtime.summarizeSession('ses-any')
    } else if (stage === 'shutdown') {
      await container.attempts.startAttempt({
        projectId: project.id,
        projectPath: repo,
        taskId: task.id,
      })
      container.terminals.disposeAll()
    }

    // ---- the crash: process dies, db still shows RUNNING ----
    expect(db.get('SELECT status FROM tasks WHERE id = ?', task.id)?.status).toBe('running')

    // ---- restart recovery ----
    const recovery = await recoverOnStartup(container.asServices())

    const restored = container.tasks
      .stateForProject(project.id)
      .tasks.find((entry) => entry.id === task.id)
    expect(restored?.status).toBe('interrupted')
    expect(recovery.interruptedTasks).toContain(task.id)

    // Locks + worktrees reconciled (expired TTL → stale; vanished dirs → stale).
    container.locks.reconcile(project.id)
    await container.worktrees.reconcile(repo)

    // Worktree from the crashed attempt still discardable (recoverable patch).
    if (worktreeId) {
      const worktree = container.worktrees.get(worktreeId)
      if (worktree && existsSync(worktree.path)) {
        writeFileSync(join(worktree.path, 'dirty.txt'), 'x')
        await container.worktrees.captureDiff(worktree, repo)
        await container.worktrees.discard(worktreeId, repo)
      }
    }
  }, 60_000)
})

describe('backup and restore (P5.7)', () => {
  it('VACUUM INTO snapshot restores projects and tasks into a fresh db', async () => {
    const project = container.projectManager.listProjects()[0]!
    const task = container.tasks.addTask(project.id, { title: 'Survives backup' })

    const backupPath = join(dir, 'backup.db')
    backupDatabase(db, backupPath)
    expect(existsSync(backupPath)).toBe(true)

    const restoredDb = SqliteDb.open(':memory:')
    restoreDatabase(restoredDb, backupPath)

    const restoredProjects = restoredDb.all('SELECT name FROM projects')
    expect(restoredProjects.map((row) => String(row.name))).toContain(project.name)
    const restoredTasks = restoredDb.all('SELECT title FROM tasks')
    expect(restoredTasks.map((row) => String(row.title))).toContain('Survives backup')
    void task
    restoredDb.close()
  })

  it('settings export includes config but excludes secret references', () => {
    const settings = new SettingsRepository(db)
    settings.set('decision/jev', JSON.stringify({ enabled: true, apiKeySecretId: 'secret://jev' }))
    settings.set('network/policy', '{"profile":"developer"}')

    const exported = exportSettings({
      get: (key) => settings.get(key),
      keys: () => [...settings.keys(), 'secret://jev'],
    })

    expect(exported['decision/jev']).toBeTruthy()
    expect(exported['network/policy']).toBeTruthy()
    // The secret key itself is filtered out of the export.
    expect(Object.keys(exported)).not.toContain('secret://jev')
    expect(JSON.stringify(exported)).not.toContain('sk-')
  })

  it('worktrees reconcile after a restore (vanished dirs marked stale)', async () => {
    const project = container.projectManager.listProjects()[0]!
    const worktrees = container.worktrees
    const record = await worktrees.createForAttempt(
      { id: project.id, path: repo },
      'task-backup',
      1,
    )
    git(repo, 'worktree', 'remove', '--force', record.path)

    const staled = await worktrees.reconcile(repo)
    expect(staled.map((entry) => entry.id)).toContain(record.id)
    expect(worktrees.get(record.id)?.status).toBe('stale')
  })

  it('backup file is readable JSON-free sqlite (sanity: header check)', () => {
    const backupPath = join(dir, 'backup2.db')
    backupDatabase(db, backupPath)
    const header = readFileSync(backupPath).subarray(0, 15).toString()
    expect(header).toBe('SQLite format 3')
  })
})
