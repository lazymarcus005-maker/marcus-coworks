import type { HealthInfo, IpcChannel, IpcContract } from '@studio/shared'
import type { StudioServices } from './services.js'

/**
 * Structural stand-in for electron's ipcMain so registration logic is
 * unit-testable without booting Electron.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
}

export interface MainDependencies {
  health: () => HealthInfo
  /** Native macOS folder picker; resolves null when cancelled. */
  pickFolder: () => Promise<string | null>
  services: StudioServices
}

type Handler = (event: unknown, request: unknown) => unknown

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: MainDependencies): void {
  const manager = () => deps.services.projectManager

  const tabState = () => ({
    tabs: manager().listTabs(),
    activeProjectId: manager().activeTabId(),
  })

  const handlers: Record<IpcChannel, Handler> = {
    'app/health': () => deps.health(),
    'projects/list': () => ({ projects: manager().listProjects() }),
    'projects/add': (_event, request) => {
      const { path } = request as IpcContract['projects/add']['request']
      return { project: manager().addProject(path) }
    },
    'projects/pick-folder': async () => {
      const path = await deps.pickFolder()
      return path === null ? null : { path }
    },
    'projects/rename': (_event, request) => {
      const { projectId, name } = request as IpcContract['projects/rename']['request']
      return { project: manager().renameProject(projectId, name) }
    },
    'projects/remove': (_event, request) => {
      const { projectId, options } = request as IpcContract['projects/remove']['request']
      manager().removeProject(projectId, options)
      return undefined
    },
    'projects/tabs/state': () => tabState(),
    'projects/tabs/close': (_event, request) => {
      const { projectId } = request as IpcContract['projects/tabs/close']['request']
      manager().closeTab(projectId)
      return tabState()
    },
    'projects/tabs/open': (_event, request) => {
      const { projectId } = request as IpcContract['projects/tabs/open']['request']
      manager().openTab(projectId)
      return tabState()
    },
    'projects/tabs/activate': (_event, request) => {
      const { projectId } = request as IpcContract['projects/tabs/activate']['request']
      manager().setActiveTab(projectId)
      return tabState()
    },
    'activity/list': (_event, request) => {
      const { limit } = request as IpcContract['activity/list']['request']
      return { events: manager().listActivity(limit) }
    },
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
}
