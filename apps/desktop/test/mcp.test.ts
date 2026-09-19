import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpManager } from '../src/main/mcp.js'

let dir: string
let globalConfig: string
let project: string
let manager: McpManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-mcp-'))
  globalConfig = join(dir, 'global', 'opencode.json')
  project = join(dir, 'project-a')
  manager = new McpManager({ globalConfigPath: globalConfig })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('McpManager', () => {
  it('saves global and project servers in OpenCode config format', () => {
    manager.save({
      name: 'GitLab',
      type: 'remote',
      scope: 'global',
      enabled: true,
      url: 'https://gitlab.example/mcp',
      headers: { Authorization: 'secret://gitlab-mcp' },
    })
    manager.save(
      {
        name: 'Docling',
        type: 'local',
        scope: 'project',
        enabled: true,
        command: ['uvx', 'docling-mcp'],
      },
      project,
    )

    const globalDoc = JSON.parse(readFileSync(globalConfig, 'utf-8')) as {
      mcp: Record<string, { type: string; enabled: boolean; url?: string }>
    }
    expect(globalDoc.mcp.GitLab).toMatchObject({
      type: 'remote',
      enabled: true,
      url: 'https://gitlab.example/mcp',
    })

    const projectDoc = JSON.parse(readFileSync(join(project, 'opencode.json'), 'utf-8')) as {
      mcp: Record<string, { type: string; command?: string[] }>
    }
    expect(projectDoc.mcp.Docling).toMatchObject({
      type: 'local',
      command: ['uvx', 'docling-mcp'],
    })
  })

  it('lists both scopes with attribution', () => {
    manager.list()
    const servers = manager.list(project)
    expect(servers.map((server) => `${server.scope}:${server.name}`).sort()).toEqual([
      'global:GitLab',
      'project:Docling',
    ])
  })

  it('toggles enabled state in place', () => {
    manager.setEnabled('GitLab', 'global', false)
    const disabled = manager.list(project).find((server) => server.name === 'GitLab')
    expect(disabled?.enabled).toBe(false)

    manager.setEnabled('GitLab', 'global', true)
    const enabled = manager.list(project).find((server) => server.name === 'GitLab')
    expect(enabled?.enabled).toBe(true)
  })

  it('project config never affects other projects (isolation)', () => {
    const projectB = join(dir, 'project-b')
    const serversB = manager.list(projectB)
    expect(serversB.map((server) => server.name)).toEqual(['GitLab'])
    expect(serversB.some((server) => server.name === 'Docling')).toBe(false)
  })

  it('removal deletes only the target entry', () => {
    manager.remove('Docling', 'project', project)
    expect(manager.list(project).map((server) => server.name)).toEqual(['GitLab'])
  })

  it('preserves unrelated config keys during writes', () => {
    // Seed a foreign key into the project config.
    manager.save(
      { name: 'Keep', type: 'local', scope: 'project', enabled: true, command: ['x'] },
      project,
    )
    const path = join(project, 'opencode.json')
    const doc = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    doc.theme = 'dark'
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(path, JSON.stringify(doc, null, 2))

    manager.save(
      { name: 'Other', type: 'local', scope: 'project', enabled: true, command: ['y'] },
      project,
    )
    const after = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    expect(after.theme).toBe('dark')
    expect(after.mcp).toBeTruthy()
    manager.remove('Keep', 'project', project)
    manager.remove('Other', 'project', project)
    expect(existsSync(path)).toBe(true)
  })

  it('connection test reports ok and failure via the runtime endpoint', async () => {
    const okManager = new McpManager({
      globalConfigPath: globalConfig,
      runtimeBaseUrl: async () => 'http://127.0.0.1:1',
      connect: async () => ({ ok: true, status: 200 }),
    })
    expect(await okManager.test('GitLab')).toEqual({ ok: true, detail: 'connected' })

    const failManager = new McpManager({
      globalConfigPath: globalConfig,
      runtimeBaseUrl: async () => 'http://127.0.0.1:1',
      connect: async () => ({ ok: false, status: 503 }),
    })
    const failure = await failManager.test('GitLab')
    expect(failure.ok).toBe(false)
    expect(failure.detail).toContain('503')
  })
})
