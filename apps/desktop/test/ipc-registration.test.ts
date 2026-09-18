import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HealthInfo } from '@studio/shared'
import { describe, expect, it } from 'vitest'
import { type IpcMainLike, registerIpcHandlers } from '../src/main/ipc.js'
import { createServices } from '../src/main/services.js'

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

function setup() {
  const userData = mkdtempSync(join(tmpdir(), 'studio-ipc-'))
  const services = createServices(userData)
  const ipc = new FakeIpcMain()
  registerIpcHandlers(ipc, {
    health: () => health,
    pickFolder: async () => null,
    services,
  })
  return { userData, services, ipc }
}

describe('ipc registration', () => {
  it('registers all contract channels', () => {
    const { ipc, services } = setup()
    for (const channel of [
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
    ]) {
      expect(ipc.handlers.has(channel), channel).toBe(true)
    }
    services.db.close()
  })

  it('health handler returns the payload from dependencies', async () => {
    const { ipc, services } = setup()
    const result = (await ipc.handlers.get('app/health')?.(undefined, undefined)) as HealthInfo
    expect(result.platform).toBe('darwin')
    services.db.close()
  })
})

describe('projects ipc surface', () => {
  it('add → list → tab state flows through the manager', async () => {
    const { ipc, services } = setup()
    const source = mkdtempSync(join(tmpdir(), 'studio-src-'))
    mkdirSync(join(source, 'app'), { recursive: true })

    const added = (await ipc.handlers.get('projects/add')?.(undefined, {
      path: source,
    })) as { project: { id: string; name: string } }
    expect(added.project.name).toBe(source.split('/').pop())

    const listed = (await ipc.handlers.get('projects/list')?.(undefined, undefined)) as {
      projects: { id: string }[]
    }
    expect(listed.projects).toHaveLength(1)

    const tabs = (await ipc.handlers.get('projects/tabs/state')?.(undefined, undefined)) as {
      tabs: { projectId: string }[]
      activeProjectId: string | null
    }
    expect(tabs.tabs[0]?.projectId).toBe(added.project.id)
    expect(tabs.activeProjectId).toBe(added.project.id)

    services.db.close()
    rmSync(source, { recursive: true, force: true })
  })
})
