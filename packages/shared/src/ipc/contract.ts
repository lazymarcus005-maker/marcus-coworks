import type { HealthInfo } from '../domain/app.js'
import type {
  ActivityEvent,
  ProjectTab,
  ProjectWorkspace,
  RemoveProjectOptions,
} from '../domain/project.js'

/**
 * The single source of truth for the renderer <-> main IPC surface.
 *
 * Every channel declares its request and response types here. The preload
 * builds its exposed API from this contract, and the main process registers
 * handlers against it, so both ends are type-checked against the same map.
 */
export interface IpcContract {
  'app/health': { request: undefined; response: HealthInfo }
  'projects/list': { request: undefined; response: { projects: ProjectWorkspace[] } }
  'projects/add': { request: { path: string }; response: { project: ProjectWorkspace } }
  'projects/pick-folder': { request: undefined; response: { path: string } | null }
  'projects/rename': {
    request: { projectId: string; name: string }
    response: { project: ProjectWorkspace }
  }
  'projects/remove': {
    request: { projectId: string; options: RemoveProjectOptions }
    response: undefined
  }
  'projects/tabs/state': {
    request: undefined
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'projects/tabs/close': {
    request: { projectId: string }
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'projects/tabs/open': {
    request: { projectId: string }
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'projects/tabs/activate': {
    request: { projectId: string }
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'activity/list': {
    request: { limit?: number }
    response: { events: ActivityEvent[] }
  }
}

export type IpcChannel = keyof IpcContract

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/** Tab state returned by every tab mutation so the renderer stays stateless. */
export type TabStateResponse = IpcContract['projects/tabs/state']['response']

/**
 * The narrow application API exposed to the renderer via contextBridge.
 * Renderer code never touches fs/shell/Keychain — only this object.
 */
export interface StudioApi {
  app: {
    health(): Promise<HealthInfo>
  }
  projects: {
    list(): Promise<{ projects: ProjectWorkspace[] }>
    add(path: string): Promise<{ project: ProjectWorkspace }>
    pickFolder(): Promise<{ path: string } | null>
    rename(projectId: string, name: string): Promise<{ project: ProjectWorkspace }>
    remove(projectId: string, options: RemoveProjectOptions): Promise<void>
    tabState(): Promise<TabStateResponse>
    closeTab(projectId: string): Promise<TabStateResponse>
    openTab(projectId: string): Promise<TabStateResponse>
    activateTab(projectId: string): Promise<TabStateResponse>
  }
  activity: {
    list(limit?: number): Promise<{ events: ActivityEvent[] }>
  }
}

export function ipcChannels(): IpcChannel[] {
  return [
    'app/health',
    'projects/list',
    'projects/add',
    'projects/pick-folder',
    'projects/rename',
    'projects/remove',
    'projects/tabs/state',
    'projects/tabs/close',
    'projects/tabs/open',
    'projects/tabs/activate',
    'activity/list',
  ]
}
