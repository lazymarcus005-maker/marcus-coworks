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
}

contextBridge.exposeInMainWorld('studio', api)
