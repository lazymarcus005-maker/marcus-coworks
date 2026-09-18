/**
 * Project domain types (spec §8–10).
 */
export type ProjectStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'testing'
  | 'verifying'
  | 'blocked'
  | 'error'
  | 'interrupted'

export type ProjectWorkspace = {
  id: string
  name: string
  path: string
  status: ProjectStatus
  sessionId?: string
  model?: string
  branch?: string
  createdAt: string
  lastActiveAt: string
}

/** View-state for an open project tab. Closing a tab never touches the project. */
export type ProjectTab = {
  projectId: string
  position: number
  openedAt: string
}

export type RemoveProjectOptions = {
  removeHistory: boolean
  removeCache: boolean
  removeCompletedWorktrees: boolean
}

export type ActivityEventType =
  | 'project.added'
  | 'project.renamed'
  | 'project.removed'
  | 'project.invalidPath'
  | 'tab.opened'
  | 'tab.closed'
  | 'tab.activated'

export type ActivityEvent = {
  id: string
  projectId?: string
  type: string
  message: string
  payload?: Record<string, unknown>
  createdAt: string
}
