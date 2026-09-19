/**
 * MCP server configuration domain (spec §30). The shapes mirror
 * OpenCode's own opencode.json `mcp` entries so OpenCode loads them
 * natively — Agent Studio never runs a parallel MCP implementation.
 */
export type McpScope = 'global' | 'project'

export type McpServerConfig = {
  name: string
  type: 'local' | 'remote'
  scope: McpScope
  enabled: boolean
  /** local: command + args. */
  command?: string[]
  /** remote: URL. */
  url?: string
  /** remote auth headers (values are secret references, not raw keys). */
  headers?: Record<string, string>
  /** local env vars. */
  environment?: Record<string, string>
}

export type McpConnectionStatus = {
  ok: boolean
  detail: string
}
