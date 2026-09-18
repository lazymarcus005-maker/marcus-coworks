import type { ProjectTab, ProjectWorkspace, RemoveProjectOptions } from '@studio/shared'
import { createSignal } from 'solid-js'

/**
 * Renderer-side project/tab state. All mutations go through the typed IPC
 * bridge; every tab mutation returns fresh tab state from main.
 */
export function createProjectsStore() {
  const [projects, setProjects] = createSignal<ProjectWorkspace[]>([])
  const [tabs, setTabs] = createSignal<ProjectTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  async function refresh(): Promise<void> {
    const [{ projects: listed }, tabState] = await Promise.all([
      window.studio.projects.list(),
      window.studio.projects.tabState(),
    ])
    setProjects(listed)
    setTabs(tabState.tabs)
    setActiveId(tabState.activeProjectId)
    setError(null)
  }

  async function addFromPicker(): Promise<boolean> {
    try {
      const picked = await window.studio.projects.pickFolder()
      if (!picked) return false
      await window.studio.projects.add(picked.path)
      await refresh()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  async function closeTab(projectId: string): Promise<void> {
    const state = await window.studio.projects.closeTab(projectId)
    setTabs(state.tabs)
    setActiveId(state.activeProjectId)
  }

  async function openTab(projectId: string): Promise<void> {
    const state = await window.studio.projects.openTab(projectId)
    setTabs(state.tabs)
    setActiveId(state.activeProjectId)
  }

  async function activateTab(projectId: string): Promise<void> {
    const state = await window.studio.projects.activateTab(projectId)
    setTabs(state.tabs)
    setActiveId(state.activeProjectId)
  }

  async function rename(projectId: string, name: string): Promise<void> {
    try {
      await window.studio.projects.rename(projectId, name)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function remove(projectId: string, options: RemoveProjectOptions): Promise<void> {
    try {
      await window.studio.projects.remove(projectId, options)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const activeProject = (): ProjectWorkspace | undefined =>
    projects().find((p) => p.id === activeId())

  const closedProjects = (): ProjectWorkspace[] =>
    projects().filter((p) => !tabs().some((t) => t.projectId === p.id))

  const projectById = (id: string): ProjectWorkspace | undefined =>
    projects().find((p) => p.id === id)

  return {
    projects,
    tabs,
    activeId,
    error,
    activeProject,
    closedProjects,
    projectById,
    refresh,
    addFromPicker,
    closeTab,
    openTab,
    activateTab,
    rename,
    remove,
  }
}

export type ProjectsStore = ReturnType<typeof createProjectsStore>
