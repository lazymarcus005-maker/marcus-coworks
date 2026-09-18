import type { HealthInfo } from '../domain/app.js'

/**
 * The single source of truth for the renderer <-> main IPC surface.
 *
 * Every channel declares its request and response types here. The preload
 * builds its exposed API from this contract, and the main process registers
 * handlers against it, so both ends are type-checked against the same map.
 */
export interface IpcContract {
  'app/health': { request: undefined; response: HealthInfo }
}

export type IpcChannel = keyof IpcContract

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/**
 * The narrow application API exposed to the renderer via contextBridge.
 * Renderer code never touches fs/shell/Keychain — only this object.
 */
export interface StudioApi {
  app: {
    health(): Promise<HealthInfo>
  }
}

export function ipcChannels(): IpcChannel[] {
  return ['app/health']
}
