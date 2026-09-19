import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { McpConnectionStatus, McpScope, McpServerConfig } from '@studio/shared'

export interface McpManagerDeps {
  /** Absolute path of the global OpenCode config file. */
  globalConfigPath: string
  /** Connection test via the runtime's /mcp/{name}/connect endpoint. */
  connect?: (
    baseUrl: string,
    name: string,
  ) => Promise<{ ok: boolean; status?: number; body?: string }>
  runtimeBaseUrl?: () => Promise<string>
  fetchImpl?: typeof fetch
}

function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeConfig(path: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

function toOpenCodeEntry(config: McpServerConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = { type: config.type, enabled: config.enabled }
  if (config.type === 'local') {
    entry.command = config.command ?? []
    if (config.environment) entry.environment = config.environment
  } else {
    entry.url = config.url ?? ''
    if (config.headers) entry.headers = config.headers
  }
  return entry
}

function fromOpenCodeEntry(
  name: string,
  scope: McpScope,
  raw: Record<string, unknown>,
): McpServerConfig {
  const type = raw.type === 'remote' ? 'remote' : 'local'
  return {
    name,
    type,
    scope,
    enabled: raw.enabled !== false,
    command: Array.isArray(raw.command) ? raw.command.map(String) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    headers:
      raw.headers !== null && typeof raw.headers === 'object'
        ? (raw.headers as Record<string, string>)
        : undefined,
    environment:
      raw.environment !== null && typeof raw.environment === 'object'
        ? (raw.environment as Record<string, string>)
        : undefined,
  }
}

/**
 * MCP manager (spec §30 / P3.1): CRUD over OpenCode's native MCP config —
 * the global opencode config for global scope, the project's
 * opencode.json for project scope. OpenCode keeps loading servers from
 * these files; Agent Studio only curates them and surfaces status.
 */
export class McpManager {
  constructor(private readonly deps: McpManagerDeps) {}

  private configPath(scope: McpScope, projectPath?: string): string {
    if (scope === 'global') return this.deps.globalConfigPath
    if (!projectPath) throw new Error('Project scope requires a project path')
    return join(projectPath, 'opencode.json')
  }

  list(projectPath?: string): McpServerConfig[] {
    const servers: McpServerConfig[] = []
    const global = readConfig(this.deps.globalConfigPath)
    const globalMcp = (global.mcp ?? {}) as Record<string, Record<string, unknown>>
    for (const [name, entry] of Object.entries(globalMcp)) {
      servers.push(fromOpenCodeEntry(name, 'global', entry))
    }
    if (projectPath) {
      const project = readConfig(join(projectPath, 'opencode.json'))
      const projectMcp = (project.mcp ?? {}) as Record<string, Record<string, unknown>>
      for (const [name, entry] of Object.entries(projectMcp)) {
        servers.push(fromOpenCodeEntry(name, 'project', entry))
      }
    }
    return servers
  }

  save(config: McpServerConfig, projectPath?: string): McpServerConfig {
    const path = this.configPath(config.scope, projectPath)
    const doc = readConfig(path)
    const mcp = { ...((doc.mcp ?? {}) as Record<string, unknown>) }
    mcp[config.name] = toOpenCodeEntry(config)
    writeConfig(path, { ...doc, mcp })
    return config
  }

  remove(name: string, scope: McpScope, projectPath?: string): void {
    const path = this.configPath(scope, projectPath)
    const doc = readConfig(path)
    const mcp = { ...((doc.mcp ?? {}) as Record<string, unknown>) }
    delete mcp[name]
    writeConfig(path, { ...doc, mcp })
  }

  setEnabled(name: string, scope: McpScope, enabled: boolean, projectPath?: string): void {
    const path = this.configPath(scope, projectPath)
    const doc = readConfig(path)
    const mcp = { ...((doc.mcp ?? {}) as Record<string, Record<string, unknown>>) }
    const entry = mcp[name]
    if (!entry) throw new Error(`MCP server not found: ${name} (${scope})`)
    mcp[name] = { ...entry, enabled }
    writeConfig(path, { ...doc, mcp })
  }

  /** Connection test through the runtime's native connect endpoint. */
  async test(name: string): Promise<McpConnectionStatus> {
    const runtimeBaseUrl = this.deps.runtimeBaseUrl
    if (!runtimeBaseUrl || !this.deps.connect) {
      return { ok: false, detail: 'runtime not available for connection test' }
    }
    try {
      const base = await runtimeBaseUrl()
      const result = await this.deps.connect(base, name)
      return result.ok
        ? { ok: true, detail: 'connected' }
        : { ok: false, detail: `connect failed${result.status ? ` (HTTP ${result.status})` : ''}` }
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}
