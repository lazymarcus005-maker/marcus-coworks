import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityRepository, migrate, SqliteDb, WorktreeRepository } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitRunner } from '../src/git.js'
import { WorktreeManager, WorktreeManagerError } from '../src/worktree-manager.js'

let dir: string
let db: SqliteDb
let manager: WorktreeManager
let repo: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-wt-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  manager = new WorktreeManager({
    worktrees: new WorktreeRepository(db),
    activity: new ActivityRepository(db),
    git: gitRunner(),
  })

  repo = join(dir, 'repo')
  // A real repository with a commit on a feature base branch.
  execFileSync('git', ['init', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 'test@studio.local')
  git(repo, 'config', 'user.name', 'Studio Test')
  writeFileSync(join(repo, 'README.md'), '# base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('WorktreeManager', () => {
  it('creates a worktree per task/attempt with task naming', async () => {
    const record = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-182', 1)

    expect(record.branch).toBe('studio/task-182/attempt-1')
    expect(record.path).toBe(join(repo, '.agent-studio', 'worktrees', 'task-182-attempt-1'))
    expect(record.status).toBe('active')
    expect(existsSync(record.path)).toBe(true)

    const branches = git(repo, 'branch', '--list', 'studio/task-182/*')
    expect(branches).toContain('studio/task-182/attempt-1')
  })

  it('is idempotent for the same task/attempt', async () => {
    const first = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-182', 1)
    const second = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-182', 1)
    expect(second.id).toBe(first.id)
  })

  it('keeps the main working tree unchanged while the attempt edits files', async () => {
    const record = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-183', 1)
    writeFileSync(join(record.path, 'src-feature.txt'), 'attempt work\n')

    expect(existsSync(join(record.path, 'src-feature.txt'))).toBe(true)
    expect(existsSync(join(repo, 'src-feature.txt'))).toBe(false)
  })

  it('captures committed and uncommitted diffs and persists a patch', async () => {
    const record = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-184', 1)

    writeFileSync(join(record.path, 'feature-a.txt'), 'committed change\n')
    git(record.path, 'add', '.')
    git(record.path, 'config', 'user.email', 'test@studio.local')
    git(record.path, 'config', 'user.name', 'Studio Test')
    git(record.path, 'commit', '-m', 'attempt change')
    writeFileSync(join(record.path, 'feature-b.txt'), 'uncommitted change\n')

    const diff = await manager.captureDiff(record, repo)
    expect(diff.files).toContain('feature-a.txt')
    expect(diff.files).toContain('feature-b.txt')
    expect(diff.patch).toContain('committed change')
    expect(diff.patch).toContain('uncommitted change')

    const updated = manager.get(record.id)
    expect(updated?.diffPath).toBeTruthy()
    expect(readFileSync(updated!.diffPath!, 'utf-8')).toContain('committed change')
  })

  it('refuses to discard a worktree with uncommitted changes', async () => {
    const record = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-185', 1)
    writeFileSync(join(record.path, 'dirty.txt'), 'uncommitted\n')

    await expect(manager.discard(record.id, repo)).rejects.toThrow(/uncommitted changes/)
    expect(existsSync(record.path)).toBe(true)

    // Capture first, then discard succeeds and the diff stays recoverable.
    await manager.captureDiff(record, repo)
    await manager.discard(record.id, repo)
    expect(existsSync(record.path)).toBe(false)
    expect(manager.get(record.id)?.status).toBe('rejected')

    const patchPath = manager.get(record.id)?.diffPath
    expect(patchPath && existsSync(patchPath)).toBe(true)

    // The branch is gone after discard.
    const branches = git(repo, 'branch', '--list', 'studio/task-185/*')
    expect(branches.trim()).toBe('')
  })

  it('marks vanished worktrees stale during reconcile', async () => {
    const record = await manager.createForAttempt({ id: 'proj-1', path: repo }, 'task-186', 1)
    // Simulate an out-of-band removal.
    git(repo, 'worktree', 'remove', '--force', record.path)

    const staled = await manager.reconcile(repo)
    expect(staled.map((entry) => entry.id)).toContain(record.id)
    expect(manager.get(record.id)?.status).toBe('stale')
  })

  it('rejects creation in a directory that is not a git repository', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'studio-nogit-'))
    await expect(
      manager.createForAttempt({ id: 'proj-x', path: notARepo }, 'task-999', 1),
    ).rejects.toThrow(WorktreeManagerError)
    rmSync(notARepo, { recursive: true, force: true })
  })
})
