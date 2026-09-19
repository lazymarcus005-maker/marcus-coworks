import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentStatus,
  ChatMessage,
  CodingAgentRuntime,
  RuntimeDetection,
  RuntimeEvent,
} from '@studio/shared'
import { sseDataLines } from './sse.js'

export type SpawnFn = (command: string, args: string[]) => ChildProcess

export interface OpenCodeRuntimeOptions {
  /** Explicit binary path override. */
  binaryPath?: string
  /** Use an already-running server (tests) instead of spawning. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  spawnImpl?: SpawnFn
  log?: (message: string) => void
}

type OpenCodeMessage = {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time: { created: number; completed?: number }
  modelID?: string
  providerID?: string
  error?: { name: string; data?: { message?: string } }
  tokens?: { input?: number; output?: number }
}

type OpenCodeTextPart = {
  type: 'text'
  text: string
  id: string
  sessionID: string
  messageID: string
}

type OpenCodeEvent = {
  type: string
  properties?: {
    info?: OpenCodeMessage
    part?: OpenCodeTextPart
    sessionID?: string
    messageID?: string
    todos?: { id: string; content: string; status: string; priority: string }[]
  }
}

const DEFAULT_BINARY_CANDIDATES = () => [
  join(homedir(), '.opencode/bin/opencode'),
  '/opt/homebrew/bin/opencode',
  '/usr/local/bin/opencode',
]

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout) => {
      resolve({ code: error === null ? 0 : 1, stdout: stdout ?? '' })
    })
  })
}

async function isOnPath(binary: string): Promise<boolean> {
  const result = await runCommand('which', [binary])
  return result.code === 0 && result.stdout.trim() !== ''
}

export async function findOpenCodeBinary(): Promise<string | null> {
  if (await isOnPath('opencode')) return 'opencode'
  for (const candidate of DEFAULT_BINARY_CANDIDATES()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * Adapter around a local `opencode serve` process (spec §28).
 *
 * All OpenCode specifics — the HTTP API, SSE event shapes, session
 * semantics — live here. The rest of Agent Studio codes against the
 * CodingAgentRuntime interface.
 */
export class OpenCodeRuntime implements CodingAgentRuntime {
  private readonly fetchImpl: typeof fetch
  private readonly log: (message: string) => void
  private readonly spawnImpl: SpawnFn | undefined
  private readonly forcedBinary?: string
  private readonly fixedBase?: string

  private base?: string
  private proc?: ChildProcess
  private disposed = false
  private listeners = new Set<(event: RuntimeEvent) => void>()
  private readonly startedMessages = new Set<string>()
  private streamAbort?: AbortController
  private starting?: Promise<string>

  constructor(options: OpenCodeRuntimeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.log = options.log ?? (() => {})
    this.spawnImpl = options.spawnImpl
    this.forcedBinary = options.binaryPath
    this.fixedBase = options.baseUrl
  }

  async detect(): Promise<RuntimeDetection> {
    const binary = this.forcedBinary ?? (await findOpenCodeBinary())
    if (!binary) return { available: false, binary: null }
    const version = await runCommand(binary, ['--version'])
    return {
      available: true,
      binary,
      version: version.code === 0 ? version.stdout.trim() : undefined,
    }
  }

  async ensureServer(): Promise<string> {
    if (this.fixedBase) {
      this.startEventStream()
      return this.fixedBase
    }
    if (this.base && this.proc && !this.proc.killed) {
      this.startEventStream()
      return this.base
    }
    this.starting ??= this.startServer()
    return this.starting
  }

  private async startServer(): Promise<string> {
    const detection = await this.detect()
    if (!detection.available || !detection.binary) {
      throw new Error('OpenCode binary not found')
    }
    const port = await freePort()
    const proc = (this.spawnImpl ?? spawn)(detection.binary, [
      'serve',
      '--port',
      String(port),
      '--hostname',
      '127.0.0.1',
    ])
    this.proc = proc
    this.base = `http://127.0.0.1:${port}`
    this.log(`opencode serve starting on ${this.base}`)

    proc.stdout?.on('data', (chunk) => this.log(String(chunk)))
    proc.stderr?.on('data', (chunk) => this.log(String(chunk)))
    proc.on('exit', (code) => {
      this.log(`opencode serve exited with code ${code}`)
      this.base = undefined
      this.proc = undefined
      this.starting = undefined
    })

    await this.waitUntilReady(this.base, 20_000)
    this.startEventStream()
    return this.base
  }

  private async waitUntilReady(base: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastError = 'unknown'
    while (Date.now() < deadline) {
      if (this.proc?.exitCode !== null && this.proc?.exitCode !== undefined) {
        throw new Error(`opencode serve exited during startup (code ${this.proc.exitCode})`)
      }
      try {
        const response = await this.fetchImpl(`${base}/config`)
        if (response.ok) return
        lastError = `HTTP ${response.status}`
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause)
      }
      await sleep(250)
    }
    throw new Error(`opencode serve not ready after ${timeoutMs}ms: ${lastError}`)
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (cause) {
        this.log(`event listener failed: ${String(cause)}`)
      }
    }
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private streamStarted = false

  private startEventStream(): void {
    if (!this.base && !this.fixedBase) return
    if (this.disposed || this.streamStarted) return
    this.streamStarted = true
    this.streamAbort = new AbortController()
    const base = this.fixedBase ?? this.base
    if (!base) return

    void (async () => {
      try {
        const signal = this.streamAbort?.signal
        if (!signal) return
        const response = await this.fetchImpl(`${base}/event`, {
          signal,
          headers: { Accept: 'text/event-stream' },
        })
        if (!response.ok || !response.body) {
          throw new Error(`event stream HTTP ${response.status}`)
        }
        for await (const data of sseDataLines(response.body)) {
          if (this.disposed) break
          this.handleEventData(data)
        }
      } catch (cause) {
        if (this.disposed || this.streamAbort?.signal.aborted) return
        this.emit({ type: 'runtime-error', error: `event stream failed: ${String(cause)}` })
      }
      // Reconnect while the runtime is alive.
      this.streamStarted = false
      if (!this.disposed && !this.streamAbort?.signal.aborted) {
        await sleep(1_000)
        if (!this.disposed) this.startEventStream()
      }
    })()
  }

  private handleEventData(data: string): void {
    let event: OpenCodeEvent
    try {
      event = JSON.parse(data) as OpenCodeEvent
    } catch {
      return
    }
    const props = event.properties ?? {}

    switch (event.type) {
      case 'busy':
      case 'idle': {
        if (props.sessionID) {
          this.emit({
            type: 'session-status',
            sessionId: props.sessionID,
            status: event.type === 'busy' ? 'busy' : 'idle',
          })
        }
        return
      }
      case 'message.updated': {
        const info = props.info
        if (!info) return
        const key = `${info.sessionID}:${info.id}`
        if (!this.startedMessages.has(key)) {
          this.startedMessages.add(key)
          this.emit({
            type: 'message-started',
            sessionId: info.sessionID,
            messageId: info.id,
            role: info.role,
            model: info.modelID,
            provider: info.providerID,
          })
        }
        if (info.time.completed !== undefined) {
          this.emit({
            type: 'message-completed',
            sessionId: info.sessionID,
            messageId: info.id,
            error: info.error
              ? `${info.error.name}: ${info.error.data?.message ?? 'provider error'}`
              : undefined,
            tokens:
              info.tokens !== undefined
                ? { input: info.tokens.input ?? 0, output: info.tokens.output ?? 0 }
                : undefined,
          })
        }
        return
      }
      case 'message.part.updated': {
        const part = props.part
        if (part?.type === 'text' && part.text !== '') {
          this.emit({
            type: 'message-text',
            sessionId: part.sessionID,
            messageId: part.messageID,
            text: part.text,
          })
        }
        return
      }
      case 'todo.updated': {
        if (!props.sessionID || !props.todos) return
        this.emit({
          type: 'todos-updated',
          sessionId: props.sessionID,
          todos: props.todos.map((todo) => ({
            id: todo.id,
            content: todo.content,
            status: normalizeTodoStatus(todo.status),
            priority: normalizeTodoPriority(todo.priority),
          })),
        })
        return
      }
      default:
        return
    }
  }

  async createSession(workDir: string, title?: string): Promise<{ id: string }> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: workDir, ...(title ? { title } : {}) }),
    })
    if (!response.ok) throw new Error(`createSession failed: HTTP ${response.status}`)
    const session = (await response.json()) as { id: string }
    return { id: session.id }
  }

  async resumeSession(sessionId: string): Promise<boolean> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/${sessionId}`)
    return response.ok
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`sendMessage failed: HTTP ${response.status} ${body.slice(0, 200)}`)
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/${sessionId}/abort`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error(`stopSession failed: HTTP ${response.status}`)
  }

  async getStatus(sessionId: string): Promise<AgentStatus> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/status`)
    if (!response.ok) return 'error'
    const statuses = (await response.json()) as Record<string, unknown>
    return sessionId in statuses ? 'busy' : 'idle'
  }

  async listChildren(sessionId: string): Promise<string[]> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/${sessionId}/children`)
    if (!response.ok) return []
    const children = (await response.json()) as unknown
    if (!Array.isArray(children)) return []
    return children.map((child) => String(child))
  }

  async summarizeSession(sessionId: string): Promise<void> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/${sessionId}/summarize`, {
      method: 'POST',
    })
    if (!response.ok) throw new Error(`summarize failed: HTTP ${response.status}`)
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const base = await this.ensureServer()
    const response = await this.fetchImpl(`${base}/session/${sessionId}/message`)
    if (!response.ok) throw new Error(`listMessages failed: HTTP ${response.status}`)
    const entries = (await response.json()) as {
      info: OpenCodeMessage
      parts?: { type: string; text?: string }[]
    }[]
    return entries.map((entry) => ({
      id: entry.info.id,
      sessionId: entry.info.sessionID,
      role: entry.info.role,
      text: (entry.parts ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join(''),
      createdAt: entry.info.time.created,
      model: entry.info.modelID,
      provider: entry.info.providerID,
      error: entry.info.error ? entry.info.error.name : undefined,
      tokens:
        entry.info.tokens !== undefined
          ? { input: entry.info.tokens.input ?? 0, output: entry.info.tokens.output ?? 0 }
          : undefined,
    }))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.streamAbort?.abort()
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM')
      this.proc = undefined
    }
    this.base = undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeTodoStatus(
  status: string,
): 'pending' | 'in_progress' | 'completed' | 'cancelled' {
  if (status === 'in_progress' || status === 'completed' || status === 'cancelled') return status
  return 'pending'
}

function normalizeTodoPriority(priority: string): 'high' | 'medium' | 'low' {
  if (priority === 'high' || priority === 'medium' || priority === 'low') return priority
  return 'medium'
}
