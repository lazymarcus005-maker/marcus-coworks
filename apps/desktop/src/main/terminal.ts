import { existsSync } from 'node:fs'
import { type IPty, spawn as ptySpawn } from 'node-pty'

export type TerminalPushEvent =
  | { type: 'data'; projectId: string; terminalId: string; data: string }
  | { type: 'exit'; projectId: string; terminalId: string }

export type TerminalInfo = {
  id: string
  projectId: string
  title: string
  cwd: string
  createdAt: string
}

type Session = {
  info: TerminalInfo
  pty: IPty
}

export interface TerminalServiceDeps {
  onEvent: (event: TerminalPushEvent) => void
  now?: () => Date
  newId?: () => string
}

export function defaultShell(): string {
  const fromEnv = process.env.SHELL
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return '/bin/zsh'
}

/**
 * Project-scoped PTY sessions (spec §42). Each terminal is spawned with
 * its cwd pinned to the project root; terminals never leak between
 * projects because every session is keyed by project id.
 */
export class TerminalService {
  private readonly sessions = new Map<string, Session>()
  private readonly perProjectCounter = new Map<string, number>()
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: TerminalServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  create(
    projectId: string,
    cwd: string,
    options: { cols?: number; rows?: number } = {},
  ): TerminalInfo {
    const cols = options.cols ?? 80
    const rows = options.rows ?? 24
    const index = (this.perProjectCounter.get(projectId) ?? 0) + 1
    this.perProjectCounter.set(projectId, index)

    const info: TerminalInfo = {
      id: this.newId(),
      projectId,
      title: `zsh ${index}`,
      cwd,
      createdAt: this.now().toISOString(),
    }

    const pty = ptySpawn(defaultShell(), ['-l'], {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })

    pty.onData((data) => {
      this.deps.onEvent({ type: 'data', projectId, terminalId: info.id, data })
    })
    pty.onExit(() => {
      this.sessions.delete(info.id)
      this.deps.onEvent({ type: 'exit', projectId, terminalId: info.id })
    })

    this.sessions.set(info.id, { info, pty })
    return info
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.pty.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.sessions.get(terminalId)?.pty.resize(cols, rows)
  }

  dispose(terminalId: string): void {
    const session = this.sessions.get(terminalId)
    if (!session) return
    this.sessions.delete(terminalId)
    session.pty.kill()
  }

  disposeProject(projectId: string): void {
    for (const session of this.sessions.values()) {
      if (session.info.projectId === projectId) {
        this.dispose(session.info.id)
      }
    }
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.dispose(id)
    }
  }

  list(projectId: string): TerminalInfo[] {
    return [...this.sessions.values()]
      .filter((session) => session.info.projectId === projectId)
      .map((session) => session.info)
  }
}
