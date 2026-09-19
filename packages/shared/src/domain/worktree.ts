/** Worktree domain (spec §18): per-task/per-attempt Git isolation. */
export type WorktreeStatus = 'active' | 'approved' | 'rejected' | 'escalated' | 'merged' | 'stale'

export type WorktreeRecord = {
  id: string
  projectId: string
  taskId: string
  attempt: number
  /** Absolute path of the worktree checkout. */
  path: string
  branch: string
  baseBranch: string
  status: WorktreeStatus
  /** Path to the captured patch file, once a diff was captured. */
  diffPath?: string
  createdAt: string
  updatedAt: string
}

export type WorktreeDiff = {
  worktreeId: string
  /** Changed file paths relative to the repo root. */
  files: string[]
  /** Unified diff patch text (committed + uncommitted changes). */
  patch: string
}
