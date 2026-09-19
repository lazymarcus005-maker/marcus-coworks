import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  EvidenceRepository,
  GoalRepository,
  migrate,
  SqliteDb,
  TaskRepository,
  TaskTransitionRepository,
  WorktreeRepository,
} from '@studio/persistence'
import type {
  ChatMessage,
  ChatPushEvent,
  CodingAgentRuntime,
  RuntimeEvent,
  VerificationEvidence,
} from '@studio/shared'
import { TaskManager } from '@studio/task-manager'
import { gitRunner, WorktreeManager } from '@studio/worktree-manager'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InboxManager } from '../src/main/inbox.js'
import { buildVerifierPrompt, parseDecision, VerifierService } from '../src/main/verifier.js'

let dir: string
let db: SqliteDb
let repo: string
let tasks: TaskManager
let worktrees: WorktreeManager
let evidenceRepo: EvidenceRepository
let inbox: InboxManager
let verifier: VerifierService

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
}

class FakeRuntime implements CodingAgentRuntime {
  reply = ''
  sessions: string[] = []
  prompts: { sessionId: string; text: string }[] = []
  private listeners = new Set<(event: RuntimeEvent) => void>()

  async detect() {
    return { available: true, binary: 'fake' }
  }
  async ensureServer() {
    return 'http://127.0.0.1:1'
  }
  async createSession() {
    const id = `ses_verifier_${this.sessions.length + 1}`
    this.sessions.push(id)
    return { id }
  }
  async resumeSession() {
    return true
  }
  async sendMessage(sessionId: string, text: string) {
    this.prompts.push({ sessionId, text })
    setTimeout(() => {
      for (const listener of this.listeners) {
        listener({ type: 'message-text', sessionId, messageId: 'm1', text: this.reply })
        listener({ type: 'message-completed', sessionId, messageId: 'm1' })
      }
    }, 5)
  }
  async stopSession() {}
  async getStatus() {
    return 'idle' as const
  }
  async listChildren() {
    return []
  }
  async listMessages(): Promise<ChatMessage[]> {
    return []
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  async dispose() {}
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-verifier-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  evidenceRepo = new EvidenceRepository(db)
  const activity = new ActivityRepository(db)
  tasks = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity,
    transitions: new TaskTransitionRepository(db),
  })
  inbox = new InboxManager({
    inbox: new (await import('@studio/persistence')).InboxRepository(db),
    activity,
  })
  worktrees = new WorktreeManager({
    worktrees: new WorktreeRepository(db),
    activity,
    git: gitRunner(),
  })

  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 'test@studio.local')
  git(repo, 'config', 'user.name', 'Studio Test')
  writeFileSync(join(repo, 'README.md'), '# base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')

  verifier = new VerifierService({
    runtime: new FakeRuntime(),
    tasks,
    tasksRepo: new TaskRepository(db),
    goals: new GoalRepository(db),
    evidence: evidenceRepo,
    worktrees,
    inbox,
    activity,
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const APPROVE =
  'Review ok.\n```json\n{"decision":"approve","reasons":["meets DoD"],"failedCriteria":[],"evidence":[]}\n```'
const REJECT =
  'Problems found.\n```json\n{"decision":"reject","reasons":["unrelated refactor"],"failedCriteria":["no unrelated files modified"],"evidence":[]}\n```'
const GIBBERISH = 'I could not verify this change, sorry.'

async function makeAttempt(taskId: string): Promise<string> {
  const worktree = await worktrees.createForAttempt({ id: 'proj-1', path: repo }, taskId, 1)
  writeFileSync(join(worktree.path, 'change.txt'), 'attempt output\n')
  return worktree.id
}

function evidenceFor(taskId: string, exitCode: number): VerificationEvidence {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    taskId,
    kind: 'test',
    command: 'echo tests',
    exitCode,
    failed: exitCode === 0 ? 0 : 2,
    durationMs: 12,
    summary: 'simulated',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  }
}

describe('parseDecision', () => {
  it('reads the json block', () => {
    expect(parseDecision(APPROVE)).toMatchObject({ decision: 'approve', reasons: ['meets DoD'] })
    expect(parseDecision(REJECT)).toMatchObject({
      decision: 'reject',
      failedCriteria: ['no unrelated files modified'],
    })
  })

  it('returns null for unparseable replies', () => {
    expect(parseDecision(GIBBERISH)).toBeNull()
    expect(parseDecision('```json\n{"decision":"maybe"}\n```')).toBeNull()
  })
})

describe('VerifierService', () => {
  it('reviews from a FRESH session — never the implementer session', async () => {
    const runtime = (verifier as unknown as { deps: { runtime: FakeRuntime } }).deps.runtime
    runtime.reply = APPROVE

    const task = tasks.addTask('proj-1', { title: 'Change something' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    const worktreeId = await makeAttempt(task.id)

    const decision = await verifier.reviewAttempt({
      projectId: 'proj-1',
      projectPath: repo,
      taskId: task.id,
      worktreeId,
      implementerSessionId: 'ses_implementer_1',
    })

    expect(decision.decision).toBe('approve')
    expect(decision.verifierSessionId).toMatch(/^ses_verifier_/)
    expect(decision.verifierSessionId).not.toBe('ses_implementer_1')
    expect(runtime.sessions).toHaveLength(1)
    // The prompt carried the diff and DoD context.
    expect(runtime.prompts[0]?.text).toContain('INDEPENDENT VERIFIER')
    expect(runtime.prompts[0]?.text).toContain('change.txt')
  })

  it('reject → routes to the retry state and escalates', async () => {
    const runtime = (verifier as unknown as { deps: { runtime: FakeRuntime } }).deps.runtime
    runtime.reply = REJECT

    const task = tasks.addTask('proj-1', { title: 'Second change' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    const worktreeId = await makeAttempt(task.id)
    evidenceRepo.insert(evidenceFor(task.id, 0))

    const decision = await verifier.reviewAttempt({
      projectId: 'proj-1',
      projectPath: repo,
      taskId: task.id,
      worktreeId,
    })
    const outcome = await verifier.applyDecision(task.id, decision)

    expect(outcome).toBe('rejected')
    expect(tasks.transitionHistory(task.id).at(-1)?.to).toBe('rejected')
    expect(inbox.listOpen().some((item) => item.kind === 'verifier-rejected')).toBe(true)
  })

  it('approve is gated: no deterministic evidence → done still blocked', async () => {
    const runtime = (verifier as unknown as { deps: { runtime: FakeRuntime } }).deps.runtime
    runtime.reply = APPROVE

    const gateTasks = new TaskManager({
      tasks: new TaskRepository(db),
      goals: new GoalRepository(db),
      activity: new ActivityRepository(db),
      transitions: new TaskTransitionRepository(db),
      completionGate: (taskId) => {
        const latest = evidenceRepo.listForTask(taskId).at(-1)
        return { allowed: latest !== undefined && latest.exitCode === 0 }
      },
    })
    const gatedVerifier = new VerifierService({
      runtime,
      tasks: gateTasks,
      tasksRepo: new TaskRepository(db),
      goals: new GoalRepository(db),
      evidence: evidenceRepo,
      worktrees,
      inbox,
      activity: new ActivityRepository(db),
    })

    const task = gateTasks.addTask('proj-1', { title: 'No evidence run' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    const worktreeId = await makeAttempt(task.id)

    const decision = await gatedVerifier.reviewAttempt({
      projectId: 'proj-1',
      projectPath: repo,
      taskId: task.id,
      worktreeId,
    })
    // The verifier says approve, but completion requires deterministic evidence.
    await expect(gatedVerifier.applyDecision(task.id, decision)).rejects.toThrow(
      /Completion blocked/,
    )
  })

  it('unparseable verifier reply → human_required, never approve', async () => {
    const runtime = (verifier as unknown as { deps: { runtime: FakeRuntime } }).deps.runtime
    runtime.reply = GIBBERISH

    const task = tasks.addTask('proj-1', { title: 'Third change' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    const worktreeId = await makeAttempt(task.id)

    const decision = await verifier.reviewAttempt({
      projectId: 'proj-1',
      projectPath: repo,
      taskId: task.id,
      worktreeId,
    })
    expect(decision.decision).toBe('human_required')
  })

  it('verifier mutating the worktree invalidates the review', async () => {
    const runtime = (verifier as unknown as { deps: { runtime: FakeRuntime } }).deps.runtime
    runtime.reply = APPROVE

    const task = tasks.addTask('proj-1', { title: 'Fourth change' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
    const worktreeId = await makeAttempt(task.id)

    // Simulate the verifier editing files during its turn (after the
    // baseline is taken, while the review prompt is being processed).
    const worktree = worktrees.get(worktreeId)
    if (!worktree) throw new Error('missing worktree')
    const originalSend = runtime.sendMessage.bind(runtime)
    runtime.sendMessage = async (sessionId: string, text: string) => {
      writeFileSync(join(worktree.path, 'sabotage.txt'), 'verifier edit\n')
      await originalSend(sessionId, text)
    }

    await expect(
      verifier.reviewAttempt({
        projectId: 'proj-1',
        projectPath: repo,
        taskId: task.id,
        worktreeId,
      }),
    ).rejects.toThrow(/read-only policy/)
    expect(inbox.listOpen().some((item) => item.kind === 'security-sensitive')).toBe(true)
  })
})

describe('buildVerifierPrompt', () => {
  it('includes objective, DoD, evidence, and diff', () => {
    const prompt = buildVerifierPrompt({
      objective: 'Fix login timeout',
      doneWhen: ['build passes', 'tests pass'],
      diff: 'diff --git a/x b/x',
      evidence: [evidenceFor('t', 0)],
    })
    expect(prompt).toContain('Fix login timeout')
    expect(prompt).toContain('- build passes')
    expect(prompt).toContain('[test] exit 0')
    expect(prompt).toContain('diff --git a/x b/x')
    expect(prompt).toContain('"decision": "approve" | "reject" | "human_required"')
  })
})
