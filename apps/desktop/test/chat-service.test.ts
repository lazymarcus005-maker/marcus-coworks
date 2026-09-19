import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  migrate,
  ProjectRepository,
  SessionRepository,
  SqliteDb,
} from '@studio/persistence'
import type { ChatPushEvent, CodingAgentRuntime, RuntimeEvent } from '@studio/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ChatService } from '../src/main/chat.js'

class FakeRuntime implements CodingAgentRuntime {
  nextSessionId = 1
  resumed: string[] = []
  sent: { sessionId: string; text: string }[] = []
  aborted: string[] = []
  private listeners = new Set<(event: RuntimeEvent) => void>()

  async detect() {
    return { available: true, binary: 'fake' }
  }
  async ensureServer() {
    return 'http://127.0.0.1:1'
  }
  async createSession() {
    return { id: `ses_fake_${this.nextSessionId++}` }
  }
  async resumeSession(sessionId: string) {
    this.resumed.push(sessionId)
    return true
  }
  async sendMessage(sessionId: string, text: string) {
    this.sent.push({ sessionId, text })
  }
  async stopSession(sessionId: string) {
    this.aborted.push(sessionId)
  }
  async getStatus() {
    return 'idle' as const
  }
  async listMessages() {
    return []
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(event: RuntimeEvent) {
    for (const listener of this.listeners) listener(event)
  }
  async dispose() {}
}

let db: SqliteDb
let runtime: FakeRuntime
let pushed: ChatPushEvent[]
let chat: ChatService
let projects: ProjectRepository

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-chat-'))
  db = SqliteDb.open(join(dir, 'studio.db'))
  migrate(db)
  runtime = new FakeRuntime()
  pushed = []
  projects = new ProjectRepository(db)
  const now = new Date().toISOString()
  projects.insert({
    id: 'proj-1',
    name: 'Alpha',
    path: dir,
    status: 'idle',
    createdAt: now,
    lastActiveAt: now,
  })
  chat = new ChatService({
    runtime,
    projects,
    sessions: new SessionRepository(db),
    activity: new ActivityRepository(db),
    onEvent: (event) => pushed.push(event),
    now: () => new Date('2026-09-19T00:00:00Z'),
  })
})

afterAll(() => {
  db.close()
})

describe('ChatService', () => {
  it('creates a session for a project and persists the reference', async () => {
    const project = projects.get('proj-1')!
    const sessionId = await chat.ensureSession(project)
    expect(sessionId).toBe('ses_fake_1')
    const stored = new SessionRepository(db).forProject('proj-1')
    expect(stored?.id).toBe('ses_fake_1')
    expect(projects.get('proj-1')?.sessionId).toBe('ses_fake_1')
  })

  it('reuses the stored session instead of creating a new one', async () => {
    const project = projects.get('proj-1')!
    const sessionId = await chat.ensureSession(project)
    expect(sessionId).toBe('ses_fake_1')
    expect(runtime.resumed).toContain('ses_fake_1')
  })

  it('routes runtime events to the owning project and updates status', async () => {
    chat.wire()
    runtime.emit({ type: 'session-status', sessionId: 'ses_fake_1', status: 'busy' })
    runtime.emit({
      type: 'message-started',
      sessionId: 'ses_fake_1',
      messageId: 'msg_1',
      role: 'assistant',
      model: 'qwen',
    })
    runtime.emit({
      type: 'message-text',
      sessionId: 'ses_fake_1',
      messageId: 'msg_1',
      text: 'Hello',
    })
    runtime.emit({ type: 'session-status', sessionId: 'ses_fake_1', status: 'idle' })

    expect(pushed).toContainEqual({
      type: 'session-status',
      projectId: 'proj-1',
      status: 'busy',
    })
    expect(pushed).toContainEqual({
      type: 'message-started',
      projectId: 'proj-1',
      messageId: 'msg_1',
      role: 'assistant',
      model: 'qwen',
    })
    expect(pushed).toContainEqual({
      type: 'message-text',
      projectId: 'proj-1',
      messageId: 'msg_1',
      text: 'Hello',
    })

    // busy → project status running; idle → back to idle
    expect(projects.get('proj-1')?.status).toBe('idle')
  })

  it('send and stop target the project session', async () => {
    const project = projects.get('proj-1')!
    await chat.send(project, 'do something')
    expect(runtime.sent).toEqual([{ sessionId: 'ses_fake_1', text: 'do something' }])
    await chat.stop(project)
    expect(runtime.aborted).toEqual(['ses_fake_1'])
  })
})
