import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActivityRepository, WorktreeRepository } from '@studio/persistence'
import type { WorktreeDiff, WorktreeRecord, WorktreeStatus } from '@studio/shared'
import type { GitRunner } from './git.js'

export class WorktreeManagerError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export interface WorktreeManagerDeps {
  worktrees: WorktreeRepository
  activity: ActivityRepository
  git: GitRunner
  now?: () => Date
  newId?: () => string
}

/** Directory (relative to the repository) holding managed worktrees. */
export const WORKTREES_DIR = join('.agent-studio', 'worktrees')
export const PATCHES_DIR = join('.agent-studio', 'patches')

function shortId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  return sanitized.slice(0, 24) || 'task'
}

function branchNameFor(taskId: string, attempt: number): string {
  return `studio/${shortId(taskId)}/attempt-${attempt}`
}

/**
 * Per-task/per-attempt Git worktree isolation (spec §18).
 *
 * Worktrees are code isolation, not a security sandbox. Cleanup is
 * conservative: a worktree with uncommitted changes is never destructively
 * removed without an explicit force flag.
 */
export class WorktreeManager {
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: WorktreeManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /** Creates (idempotently) the worktree for a task/attempt. */
  async createForAttempt(
    project: { id: string; path: string },
    taskId: string,
    attempt: number,
  ): Promise<WorktreeRecord> {
    const existing = this.deps.worktrees.forTaskAttempt(taskId, attempt)
    if (existing && existsSync(existing.path)) return existing
    if (existing) {
      // Manifest row exists but the directory is gone — replace it.
      this.deps.worktrees.delete(existing.id)
    }

    const baseBranch = await this.currentBranch(project.path)
    if (!baseBranch) {
      throw new WorktreeManagerError(`No git repository at ${project.path}`)
    }

    const dirName = `${shortId(taskId)}-attempt-${attempt}`
    const worktreePath = join(project.path, WORKTREES_DIR, dirName)
    const branch = branchNameFor(taskId, attempt)

    if (existsSync(worktreePath)) {
      // Directory exists without a manifest row (e.g. app data lost):
      // refuse rather than clobber.
      throw new WorktreeManagerError(`Worktree directory already exists: ${worktreePath}`)
    }

    const added = await this.deps.git(project.path, [
      'worktree',
      'add',
      '-b',
      branch,
      worktreePath,
      baseBranch,
    ])
    if (added.code !== 0) {
      throw new WorktreeManagerError(`git worktree add failed: ${added.stderr.trim()}`)
    }

    const at = this.now().toISOString()
    const record: WorktreeRecord = {
      id: this.newId(),
      projectId: project.id,
      taskId,
      attempt,
      path: worktreePath,
      branch,
      baseBranch,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    }
    this.deps.worktrees.insert(record)
    this.deps.activity.record('worktree.created', `Worktree ${dirName} on ${branch}`, {
      projectId: project.id,
      payload: { taskId, attempt, branch, baseBranch },
    })
    return record
  }

  private async currentBranch(repoPath: string): Promise<string | null> {
    const result = await this.deps.git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (result.code !== 0) return null
    const branch = result.stdout.trim()
    return branch === '' || branch === 'HEAD' ? null : branch
  }

  /** True when the worktree has uncommitted changes. */
  async hasUncommittedChanges(record: WorktreeRecord): Promise<boolean> {
    const status = await this.deps.git(record.path, ['status', '--porcelain'])
    if (status.code !== 0) {
      throw new WorktreeManagerError(`git status failed: ${status.stderr.trim()}`)
    }
    return status.stdout.trim() !== ''
  }

  /**
   * Captures the full diff of an attempt (committed since the base branch
   * plus uncommitted changes) and persists it as a patch file, so a
   * rejected/discarded attempt stays recoverable.
   */
  async captureDiff(record: WorktreeRecord, projectPath: string): Promise<WorktreeDiff> {
    // Intent-to-add markers make untracked files visible to git diff so the
    // patch covers the whole attempt, not just tracked edits.
    await this.deps.git(record.path, ['add', '-N', '.'])

    const committed = await this.deps.git(record.path, [
      'diff',
      `${record.baseBranch}...HEAD`,
      '--',
      '.',
    ])
    const unstaged = await this.deps.git(record.path, ['diff'])
    const staged = await this.deps.git(record.path, ['diff', '--cached'])
    if (committed.code !== 0 || unstaged.code !== 0 || staged.code !== 0) {
      throw new WorktreeManagerError('git diff failed while capturing attempt diff')
    }

    const patch = [committed.stdout, staged.stdout, unstaged.stdout]
      .filter((part) => part.trim() !== '')
      .join('\n')

    const nameStatus = await this.deps.git(record.path, [
      'diff',
      '--name-only',
      `${record.baseBranch}...HEAD`,
    ])
    const dirtyFiles = await this.deps.git(record.path, ['status', '--porcelain'])
    const files = [
      ...new Set(
        [
          ...nameStatus.stdout.split('\n'),
          ...dirtyFiles.stdout.split('\n').map((line) => line.slice(3).trim()),
        ]
          .map((file) => file.trim())
          .filter((file) => file !== ''),
      ),
    ]

    if (patch !== '') {
      const patchDir = join(projectPath, PATCHES_DIR)
      mkdirSync(patchDir, { recursive: true })
      const patchPath = join(patchDir, `${shortId(record.taskId)}-attempt-${record.attempt}.patch`)
      writeFileSync(patchPath, patch, 'utf-8')
      this.deps.worktrees.setDiffPath(record.id, patchPath, this.now().toISOString())
    }

    return { worktreeId: record.id, files, patch }
  }

  setStatus(recordId: string, status: WorktreeStatus): WorktreeRecord {
    const record = this.deps.worktrees.get(recordId)
    if (!record) throw new WorktreeManagerError('Worktree not found')
    this.deps.worktrees.setStatus(recordId, status, this.now().toISOString())
    this.deps.activity.record('worktree.status', `Worktree ${status}`, {
      projectId: record.projectId,
      payload: { worktreeId: recordId, from: record.status, to: status },
    })
    return { ...record, status }
  }

  /**
   * Discards a worktree. Conservative by default: uncommitted changes
   * abort the discard; `force` is the explicit policy override. The
   * captured patch keeps the attempt recoverable.
   */
  async discard(
    recordId: string,
    projectPath: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const record = this.deps.worktrees.get(recordId)
    if (!record) throw new WorktreeManagerError('Worktree not found')

    if (existsSync(record.path)) {
      const recoverable = record.diffPath !== undefined || options.force
      if (!recoverable && (await this.hasUncommittedChanges(record))) {
        throw new WorktreeManagerError(
          'Worktree has uncommitted changes; capture the diff or pass force to discard anyway',
        )
      }
      const removed = await this.deps.git(projectPath, [
        'worktree',
        'remove',
        '--force',
        record.path,
      ])
      if (removed.code !== 0) {
        throw new WorktreeManagerError(`git worktree remove failed: ${removed.stderr.trim()}`)
      }
    }

    // Best-effort branch cleanup from the main repository; a failure keeps
    // the branch (and the attempt) recoverable rather than throwing.
    await this.deps.git(projectPath, ['branch', '-D', record.branch])

    this.setStatus(recordId, 'rejected')
    this.deps.activity.record('worktree.discarded', 'Worktree discarded', {
      projectId: record.projectId,
      payload: { worktreeId: recordId, forced: Boolean(options.force) },
    })
  }

  /**
   * Startup reconciliation (spec §18): prune stale git worktree metadata
   * and mark manifest rows whose directory has vanished as stale.
   */
  async reconcile(projectPath: string): Promise<WorktreeRecord[]> {
    await this.deps.git(projectPath, ['worktree', 'prune'])
    const staled: WorktreeRecord[] = []
    for (const record of this.deps.worktrees.listAll()) {
      if (record.status === 'active' && !existsSync(record.path)) {
        staled.push(this.setStatus(record.id, 'stale'))
      }
    }
    return staled
  }

  listForProject(projectId: string): WorktreeRecord[] {
    return this.deps.worktrees.listForProject(projectId)
  }

  get(recordId: string): WorktreeRecord | undefined {
    return this.deps.worktrees.get(recordId)
  }
}
