import type { HealthInfo, IpcChannel, IpcContract } from '@studio/shared'

/**
 * Structural stand-ins for electron's ipcMain so registration logic is
 * unit-testable without booting Electron.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
}

export interface MainDependencies {
  health: () => HealthInfo
}

type Handler = (event: unknown, request: unknown) => unknown

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: MainDependencies): void {
  const handlers: Record<IpcChannel, Handler> = {
    'app/health': () => deps.health(),
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
}

export type { IpcContract }
