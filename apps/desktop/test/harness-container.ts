import { join } from 'node:path'
import { LockManager } from '@studio/lock-manager'
import {
  ActivityRepository,
  AttemptRepository,
  EvidenceRepository,
  GoalRepository,
  InboxRepository,
  LockRepository,
  ProjectRepository,
  SettingsRepository,
  TabRepository,
  TaskRepository,
  TaskTransitionRepository,
  WorktreeRepository,
} from '@studio/persistence'
import { ProjectManager } from '@studio/project-manager'
import type { CodingAgentRuntime, RuntimeEvent } from '@studio/shared'
import { TaskManager } from '@studio/task-manager'
import { gitRunner, WorktreeManager } from '@studio/worktree-manager'
import { AttemptManager } from '../src/main/attempts.js'
import { InboxManager } from '../src/main/inbox.js'
import { PauseManager } from '../src/main/pause.js'
import type { StudioServices } from '../src/main/services.js'
import { TerminalService } from '../src/main/terminal.js'
import { VerificationManager } from '../src/main/verification.js'
import { VerifierService } from '../src/main/verifier.js'

export class ScriptedRuntime implements CodingAgentRuntime {
  replies: string[] = []
  sent = 0
  private listeners = new Set<(event: RuntimeEvent) => void>()

  async detect() {
    return { available: true, binary: 'scripted' }
  }
  async ensureServer() {
    return 'http://127.0.0.1:1'
  }
  async createSession() {
    return { id: `ses_${Math.random().toString(36).slice(2, 10)}` }
  }
  async resumeSession() {
    return true
  }
  async sendMessage(sessionId: string) {
    this.sent += 1
    const text = this.replies[0] ?? ''
    setTimeout(() => {
      for (const listener of this.listeners) {
        listener({ type: 'message-text', sessionId, messageId: 'm1', text })
        listener({ type: 'message-completed', sessionId, messageId: 'm1' })
      }
    }, 5)
  }
  async stopSession() {}
  async getStatus() {
    return 'idle' as const
  }
  async summarizeSession(_sessionId?: string) {}
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
  async dispose() {}
}

export type HarnessContainer = {
  activity: ActivityRepository
  settings: SettingsRepository
  projectManager: import('@studio/project-manager').ProjectManager
  tasks: TaskManager
  worktrees: WorktreeManager
  inbox: InboxManager
  locks: LockManager
  verification: VerificationManager
  attempts: AttemptManager
  verifier: VerifierService
  runtime: ScriptedRuntime
  terminals: TerminalService
  pause: PauseManager
  asServices: () => StudioServices
}

/** Full harness container over an existing database for test scenarios. */
export function buildHarnessContainer(
  db: import('@studio/persistence').SqliteDb,
  dataDir: string,
  options: {
    hasRequiredVerification?: (projectId: string) => boolean
  } = {},
): HarnessContainer {
  const activity = new ActivityRepository(db)
  const settings = new SettingsRepository(db)
  const runtime = new ScriptedRuntime()

  const projectManager = new ProjectManager({
    projects: new ProjectRepository(db),
    tabs: new TabRepository(db),
    activity,
  })
  const evidenceRepo = new EvidenceRepository(db)
  const tasks = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity,
    transitions: new TaskTransitionRepository(db),
    completionGate: (taskId) => {
      const latest = evidenceRepo.listForTask(taskId).at(-1)
      if (latest !== undefined && latest.exitCode === 0) return { allowed: true }
      // Templates may declare no required deterministic checks.
      const task = new TaskRepository(db).get(taskId)
      if (
        latest === undefined &&
        task !== undefined &&
        options.hasRequiredVerification?.(task.projectId) === false
      ) {
        return { allowed: true }
      }
      return {
        allowed: false,
        reason:
          latest === undefined
            ? 'no verification evidence recorded'
            : `last check (${latest.kind}) exited ${latest.exitCode}`,
      }
    },
  })
  const worktrees = new WorktreeManager({
    worktrees: new WorktreeRepository(db),
    activity,
    git: gitRunner(),
  })
  const inbox = new InboxManager({
    inbox: new InboxRepository(db),
    activity,
  })
  const locks = new LockManager({ locks: new LockRepository(db), activity })
  const verification = new VerificationManager({
    evidence: evidenceRepo,
    activity,
    outputDir: join(dataDir, 'outputs'),
  })
  const attempts = new AttemptManager({
    attempts: new AttemptRepository(db),
    goals: new GoalRepository(db),
    tasks,
    worktrees,
    inbox,
    activity,
  })
  const verifier = new VerifierService({
    runtime,
    tasks,
    tasksRepo: new TaskRepository(db),
    goals: new GoalRepository(db),
    evidence: evidenceRepo,
    worktrees,
    inbox,
    activity,
  })
  const terminals = new TerminalService({ onEvent: () => undefined })
  const pause = new PauseManager({ settings, activity })

  const container: HarnessContainer = {
    activity,
    settings,
    projectManager,
    tasks,
    worktrees,
    inbox,
    locks,
    verification,
    attempts,
    verifier,
    runtime,
    terminals,
    pause,
    asServices: () =>
      ({
        db,
        projectManager,
        secrets: {},
        providers: {},
        chat: {},
        tasks,
        worktrees,
        locks,
        inbox,
        verification,
        verifier,
        attempts,
        pause,
        mcp: {},
        skills: {},
        agents: {},
        context: {},
        scheduler: {},
        modes: {},
        decision: {},
        network: {},
        budgets: {},
        idempotency: {},
        notifier: {},
        exporter: {},
        explorer: () => [],
        policy: () => ({}) as never,
        runtime,
        terminals,
      }) as unknown as StudioServices,
  }
  return container
}
