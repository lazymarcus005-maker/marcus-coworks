import type { ActivityRepository, ProjectRepository, TabRepository } from '@studio/persistence'
import type {
  ActivityEvent,
  ProjectTab,
  ProjectWorkspace,
  RemoveProjectOptions,
} from '@studio/shared'
import { validateProjectPath } from './validation.js'

export class ProjectManagerError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_path' | 'duplicate_path' | 'not_found',
  ) {
    super(message)
  }
}

export interface ProjectManagerDeps {
  projects: ProjectRepository
  tabs: TabRepository
  activity: ActivityRepository
  now?: () => Date
  newId?: () => string
}

/**
 * Owns the project registry lifecycle (spec §10): add, open/close/reopen
 * tabs, rename, remove. Removing a project NEVER deletes source files.
 */
export class ProjectManager {
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: ProjectManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  addProject(path: string, name?: string): ProjectWorkspace {
    const validation = validateProjectPath(path)
    if (!validation.ok) {
      this.deps.activity.record('project.invalidPath', `Rejected path: ${path}`, {
        payload: { reason: validation.reason },
      })
      throw new ProjectManagerError(validation.reason, 'invalid_path')
    }

    const canonical = path.replace(/\/+$/, '')
    const existing = this.deps.projects.getByPath(canonical)
    if (existing) {
      throw new ProjectManagerError(
        `Project already registered: ${existing.name}`,
        'duplicate_path',
      )
    }

    const timestamp = this.now().toISOString()
    const project: ProjectWorkspace = {
      id: this.newId(),
      name: name?.trim() !== '' && name !== undefined ? name.trim() : validation.name,
      path: canonical,
      status: 'idle',
      createdAt: timestamp,
      lastActiveAt: timestamp,
    }
    this.deps.projects.insert(project)
    this.openTab(project.id)
    this.deps.activity.record('project.added', `Added project ${project.name}`, {
      projectId: project.id,
      payload: { path: project.path, isGitRepo: validation.isGitRepo },
    })
    return project
  }

  listProjects(): ProjectWorkspace[] {
    return this.deps.projects.list()
  }

  getProject(id: string): ProjectWorkspace {
    const project = this.deps.projects.get(id)
    if (!project) throw new ProjectManagerError('Project not found', 'not_found')
    return project
  }

  renameProject(id: string, name: string): ProjectWorkspace {
    const project = this.getProject(id)
    const trimmed = name.trim()
    if (trimmed === '') {
      throw new ProjectManagerError('Name cannot be empty', 'invalid_path')
    }
    const at = this.now().toISOString()
    this.deps.projects.rename(id, trimmed, at)
    this.deps.activity.record('project.renamed', `Renamed ${project.name} to ${trimmed}`, {
      projectId: id,
      payload: { from: project.name, to: trimmed },
    })
    return { ...project, name: trimmed, lastActiveAt: at }
  }

  removeProject(id: string, options: RemoveProjectOptions): void {
    const project = this.getProject(id)
    this.deps.tabs.close(id)
    if (options.removeHistory) {
      this.deps.projects.deleteHistoryFor(id)
    }
    this.deps.projects.delete(id)
    this.deps.activity.record('project.removed', `Removed project ${project.name}`, {
      payload: {
        path: project.path,
        removedHistory: options.removeHistory,
        // Source files are never touched by removal.
        sourcePreserved: true,
      },
    })
  }

  openTab(projectId: string): void {
    this.getProject(projectId)
    this.deps.tabs.open(projectId, this.now().toISOString())
    this.setActiveTab(projectId)
  }

  closeTab(projectId: string): void {
    this.deps.tabs.close(projectId)
    this.deps.activity.record('tab.closed', 'Closed tab', { projectId })
  }

  setActiveTab(projectId: string | null): void {
    this.deps.tabs.setActive(projectId)
    if (projectId) {
      this.deps.activity.record('tab.activated', 'Tab activated', { projectId })
    }
  }

  listTabs(): ProjectTab[] {
    return this.deps.tabs.list()
  }

  activeTabId(): string | null {
    return this.deps.tabs.activeTabId()
  }

  listActivity(limit = 200): ActivityEvent[] {
    return this.deps.activity.listAll(limit)
  }
}
