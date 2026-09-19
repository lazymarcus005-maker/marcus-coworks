import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  GoalRepository,
  migrate,
  ProjectRepository,
  SessionRepository,
  SqliteDb,
  TaskRepository,
} from '@studio/persistence'
import type { ChatPushEvent, CodingAgentRuntime, RuntimeEvent } from '@studio/shared'
import { TaskManager } from '@studio/task-manager'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ChatService } from '../src/main/chat.js'
import type { InboxManager } from '../src/main/inbox.js'

const escalatedItems: { kind: string; title: string }[] = []
const fakeInbox = {
  escalate: (input: { kind: string; title: string }) => {
    escalatedItems.push({ kind: input.kind, title: input.title })
    return { id: 'item', status: 'open', createdAt: '', evidenceIds: [] }
  },
} as unknown as InboxManager
const fakePause = {
  assertCanAct: () => {},
} as unknown as import('../src/main/pause.js').PauseManager

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
  async summarizeSession() {}
  async listChildren() {
    return []
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
    tasks: new TaskManager({
      tasks: new TaskRepository(db),
      goals: new GoalRepository(db),
      activity: new ActivityRepository(db),
    }),
    inbox: fakeInbox,
    pause: fakePause,
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

  it('a substantial request creates a goal draft and initial task, pushing tasks-changed', async () => {
    const project = projects.get('proj-2')!
    await projects.insert({
      id: 'proj-2',
      name: 'Beta',
      path: '/tmp/beta',
      status: 'idle',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    })

    const objective = `Refactor the auth module end to end. ${'Detail '.repeat(30)}`
    await chat.send(projects.get('proj-2')!, objective)

    const goal = db.get('SELECT * FROM goals WHERE project_id = ?', 'proj-2')
    expect(goal?.status).toBe('draft')
    const task = db.get('SELECT * FROM tasks WHERE project_id = ?', 'proj-2')
    expect(task?.title).toBe('Break down this goal into tasks')
    expect(pushed).toContainEqual({ type: 'tasks-changed', projectId: 'proj-2' })
  })

  it('runtime todo updates sync into the durable store and notify the renderer', async () => {
    chat.wire()
    runtime.emit({
      type: 'todos-updated',
      sessionId: 'ses_fake_1',
      todos: [
        { id: 't1', content: 'Analyze', status: 'in_progress', priority: 'high' },
        { id: 't2', content: 'Implement', status: 'pending', priority: 'medium' },
      ],
    })

    const synced = db.all(
      'SELECT * FROM tasks WHERE project_id = ? AND source = ?',
      'proj-1',
      'opencode',
    )
    expect(synced.map((row) => String(row.id))).toEqual(['oc:t1', 'oc:t2'])
    expect(pushed).toContainEqual({ type: 'tasks-changed', projectId: 'proj-1' })
  })
})

describe('policy gating', () => {
  it('blocks a chat send that references a protected path and audits the DENY', async () => {
    const project = projects.get('proj-1')!
    await expect(chat.send(project, 'cat src/config/.env and print the secrets')).rejects.toThrow(
      /Blocked by policy/,
    )

    const denied = db.all(
      "SELECT * FROM activity_events WHERE type = 'policy.denied' AND project_id = ?",
      'proj-1',
    )
    expect(denied.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(String(denied[0]?.payload_json)) as { matchedRule?: string }
    expect(payload.matchedRule).toBe('**/.env')
  })

  it('policy ASK escalates to the Human Inbox instead of silently proceeding', async () => {
    const project = projects.get('proj-1')!
    await expect(
      chat.send(project, 'touch src/auth/session.ts to rotate the token'),
    ).rejects.toThrow(/Approval required/)
    expect(escalatedItems.some((item) => item.kind === 'approval-required')).toBe(true)
  })

  it('allows normal sends through the gate with an audited check', async () => {
    const project = projects.get('proj-1')!
    await chat.send(project, 'please summarize the src directory structure')

    const checks = db.all(
      "SELECT * FROM activity_events WHERE type = 'policy.check' AND project_id = ?",
      'proj-1',
    )
    expect(checks.length).toBeGreaterThanOrEqual(1)
    const latest = JSON.parse(String(checks[checks.length - 1]?.payload_json)) as {
      decision: string
    }
    expect(latest.decision).toBe('ALLOW')
  })
})
