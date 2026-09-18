import type { IpcChannel, IpcContract, StudioApi } from '@studio/shared'
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
}

contextBridge.exposeInMainWorld('studio', api)
