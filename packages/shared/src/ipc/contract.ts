import type { HealthInfo } from '../domain/app.js'
import type { ChatMessage, ChatPushEvent } from '../domain/chat.js'
import type {
  ActivityEvent,
  ProjectTab,
  ProjectWorkspace,
  RemoveProjectOptions,
} from '../domain/project.js'
import type { ConnectionTestResult, LlmProvider } from '../domain/provider.js'

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
  'providers/list': { request: undefined; response: { providers: LlmProvider[] } }
  'providers/save': {
    /** The API key transits IPC once on save; it is never returned back. */
    request: {
      draft: { id?: string; name: string; type: string; baseUrl: string; defaultModel?: string }
      apiKey?: string
    }
    response: { provider: LlmProvider }
  }
  'providers/delete': { request: { id: string }; response: undefined }
  'providers/test': {
    request: { baseUrl: string; apiKey?: string }
    response: ConnectionTestResult
  }
  /** Tests a saved provider using its Keychain secret without exposing it. */
  'providers/test-saved': { request: { id: string }; response: ConnectionTestResult }
  'chat/start': { request: { projectId: string }; response: { sessionId: string } }
  'chat/send': { request: { projectId: string; text: string }; response: undefined }
  'chat/stop': { request: { projectId: string }; response: undefined }
  'chat/history': {
    request: { projectId: string }
    response: { messages: ChatMessage[] }
  }
}

/** Main → renderer push channel for live chat events. */
export const CHAT_EVENT_CHANNEL = 'studio:chat/event'

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
  providers: {
    list(): Promise<{ providers: LlmProvider[] }>
    save(
      draft: { id?: string; name: string; type: string; baseUrl: string; defaultModel?: string },
      apiKey?: string,
    ): Promise<{ provider: LlmProvider }>
    remove(id: string): Promise<void>
    test(baseUrl: string, apiKey?: string): Promise<ConnectionTestResult>
    testSaved(id: string): Promise<ConnectionTestResult>
  }
  chat: {
    start(projectId: string): Promise<{ sessionId: string }>
    send(projectId: string, text: string): Promise<void>
    stop(projectId: string): Promise<void>
    history(projectId: string): Promise<{ messages: ChatMessage[] }>
    /** Subscribes to pushed chat events; returns an unsubscribe function. */
    onEvent(listener: (event: ChatPushEvent) => void): () => void
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
    'providers/list',
    'providers/save',
    'providers/delete',
    'providers/test',
    'providers/test-saved',
    'chat/start',
    'chat/send',
    'chat/stop',
    'chat/history',
  ]
}
