import type { HealthInfo } from '@studio/shared'
import { describe, expect, it } from 'vitest'
import { type IpcMainLike, registerIpcHandlers } from '../src/main/ipc.js'

class FakeIpcMain implements IpcMainLike {
  handlers = new Map<string, (event: unknown, request: unknown) => unknown>()

  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void {
    this.handlers.set(channel, listener)
  }
}

const health: HealthInfo = {
  appName: 'test',
  appVersion: '0.0.0',
  platform: 'darwin',
  arch: 'arm64',
  electronVersion: '0',
  nodeVersion: '0',
  timestamp: new Date().toISOString(),
}

describe('ipc registration', () => {
  it('registers the app/health channel', () => {
    const ipc = new FakeIpcMain()
    registerIpcHandlers(ipc, { health: () => health })
    expect(ipc.handlers.has('app/health')).toBe(true)
  })

  it('health handler returns the payload from dependencies', async () => {
    const ipc = new FakeIpcMain()
    registerIpcHandlers(ipc, { health: () => health })
    const handler = ipc.handlers.get('app/health')
    expect(handler).toBeDefined()
    const result = (await handler?.(undefined, undefined)) as HealthInfo
    expect(result.platform).toBe('darwin')
    expect(result.arch).toBe('arm64')
  })
})
