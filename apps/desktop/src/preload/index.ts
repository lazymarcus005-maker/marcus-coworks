import type { IpcChannel, IpcContract, StudioApi } from '@studio/shared'
import { CHAT_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL } from '@studio/shared'
import { contextBridge, ipcRenderer } from 'electron'

async function invoke<C extends IpcChannel>(
  channel: C,
  request: IpcContract[C]['request'],
): Promise<IpcContract[C]['response']> {
  return ipcRenderer.invoke(channel, request)
}

const api: StudioApi = {
  app: {
    health: () => invoke('app/health', undefined),
  },
  projects: {
    list: () => invoke('projects/list', undefined),
    add: (path) => invoke('projects/add', { path }),
    pickFolder: () => invoke('projects/pick-folder', undefined),
    rename: (projectId, name) => invoke('projects/rename', { projectId, name }),
    remove: (projectId, options) => invoke('projects/remove', { projectId, options }),
    tabState: () => invoke('projects/tabs/state', undefined),
    closeTab: (projectId) => invoke('projects/tabs/close', { projectId }),
    openTab: (projectId) => invoke('projects/tabs/open', { projectId }),
    activateTab: (projectId) => invoke('projects/tabs/activate', { projectId }),
  },
  activity: {
    list: (limit) => invoke('activity/list', { limit }),
  },
  providers: {
    list: () => invoke('providers/list', undefined),
    save: (draft, apiKey) => invoke('providers/save', { draft, apiKey }),
    remove: (id) => invoke('providers/delete', { id }),
    test: (baseUrl, apiKey) => invoke('providers/test', { baseUrl, apiKey }),
    testSaved: (id) => invoke('providers/test-saved', { id }),
  },
  chat: {
    start: (projectId) => invoke('chat/start', { projectId }),
    send: (projectId, text) => invoke('chat/send', { projectId, text }),
    stop: (projectId) => invoke('chat/stop', { projectId }),
    history: (projectId) => invoke('chat/history', { projectId }),
    onEvent: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) =>
        listener(payload)
      ipcRenderer.on(CHAT_EVENT_CHANNEL, handler)
      return () => ipcRenderer.removeListener(CHAT_EVENT_CHANNEL, handler)
    },
  },
  tasks: {
    state: (projectId) => invoke('tasks/state', { projectId }),
    createGoal: (projectId, objective) => invoke('tasks/create-goal', { projectId, objective }),
    updateGoal: (goalId, patch) => invoke('goals/update', { goalId, patch }),
    add: (projectId, title, description) => invoke('tasks/add', { projectId, title, description }),
    update: (taskId, fields) => invoke('tasks/update', { taskId, ...fields }),
    cancel: (taskId) => invoke('tasks/cancel', { taskId }),
  },
  fs: {
    list: (projectId, path) => invoke('fs/list', { projectId, path }),
  },
  terminal: {
    create: (projectId, size) =>
      invoke('terminal/create', {
        projectId,
        cols: size?.cols,
        rows: size?.rows,
      }),
    write: (terminalId, data) => invoke('terminal/write', { terminalId, data }),
    resize: (terminalId, cols, rows) => invoke('terminal/resize', { terminalId, cols, rows }),
    dispose: (terminalId) => invoke('terminal/dispose', { terminalId }),
    list: (projectId) => invoke('terminal/list', { projectId }),
    onEvent: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) =>
        listener(payload)
      ipcRenderer.on(TERMINAL_EVENT_CHANNEL, handler)
      return () => ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, handler)
    },
  },
}

contextBridge.exposeInMainWorld('studio', api)
