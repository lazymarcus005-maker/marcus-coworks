import { homedir as homeDir } from 'node:os'
import { join } from 'node:path'
import { LockManager } from '@studio/lock-manager'
import { OpenCodeRuntime } from '@studio/opencode-adapter'
import {
  ActivityRepository,
  AttemptRepository,
  EvidenceRepository,
  GoalRepository,
  InboxRepository,
  LockRepository,
  migrate,
  ProjectRepository,
  ProviderRepository,
  SessionRepository,
  SettingsRepository,
  SqliteDb,
  TabRepository,
  TaskRepository,
  TaskTransitionRepository,
  WorktreeRepository,
} from '@studio/persistence'
import { loadPolicy } from '@studio/policy-engine'
import { ProjectManager } from '@studio/project-manager'
import { KeychainSecretStore, type SecretStore } from '@studio/secrets'
import type { ChatPushEvent } from '@studio/shared'
import { TaskManager } from '@studio/task-manager'
import { gitRunner, WorktreeManager } from '@studio/worktree-manager'
import { AgentManager } from './agents.js'
import { AttemptManager, DEFAULT_MAX_ATTEMPTS } from './attempts.js'
import { ChatService } from './chat.js'
import { ContextManager } from './context.js'
import { DecisionManager } from './decision.js'
import { listDirectory } from './explorer.js'
import { InboxManager } from './inbox.js'
import { McpManager } from './mcp.js'
import { ModeManager } from './modes.js'
import { NetworkEventRepository, NetworkPolicyManager } from './network.js'
import { PauseManager } from './pause.js'
import { ProviderService } from './providers.js'
import { SchedulerService } from './scheduler.js'
import { SecretBroker } from './secret-broker.js'
import { SkillsManager } from './skills.js'
import { type TerminalPushEvent, TerminalService } from './terminal.js'
import { VerificationManager } from './verification.js'
import { VerifierService } from './verifier.js'

export const KEYCHAIN_SERVICE = 'com.marcus-coworks.agent-studio'

export interface StudioServices {
  db: SqliteDb
  projectManager: ProjectManager
  secrets: SecretStore
  providers: ProviderService
  chat: ChatService
  tasks: TaskManager
  worktrees: WorktreeManager
  locks: LockManager
  inbox: InboxManager
  verification: VerificationManager
  verifier: VerifierService
  attempts: AttemptManager
  pause: PauseManager
  mcp: McpManager
  skills: SkillsManager
  agents: AgentManager
  context: ContextManager
  scheduler: SchedulerService
  modes: ModeManager
  decision: DecisionManager
  network: NetworkPolicyManager
  policy: typeof loadPolicy
  runtime: OpenCodeRuntime
  terminals: TerminalService
  explorer: typeof listDirectory
}

function buildServices(
  userDataDir: string,
  secrets: SecretStore,
  onChatEvent: (event: ChatPushEvent) => void,
  onTerminalEvent: (event: TerminalPushEvent) => void = () => {},
): StudioServices {
  const db = SqliteDb.open(join(userDataDir, 'studio.db'))
  migrate(db)

  const projects = new ProjectRepository(db)
  const sessions = new SessionRepository(db)
  const activity = new ActivityRepository(db)

  const projectManager = new ProjectManager({
    projects,
    tabs: new TabRepository(db),
    activity,
  })

  const tasks = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity,
    transitions: new TaskTransitionRepository(db),
    completionGate: (taskId) => {
      const latest = evidenceRepo.listForTask(taskId).at(-1)
      return {
        allowed: latest !== undefined && latest.exitCode === 0,
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

  const locks = new LockManager({
    locks: new LockRepository(db),
    activity,
  })

  const tasksManagerForInbox = tasks
  const evidenceRepo = new EvidenceRepository(db)
  const verification = new VerificationManager({
    evidence: evidenceRepo,
    activity,
    outputDir: join(userDataDir, 'verification-logs'),
    acquireShellSlot: () => scheduler.acquire('shell', { label: 'verification' }),
    releaseShellSlot: (ticketId) => scheduler.release(ticketId),
  })

  const inbox = new InboxManager({
    inbox: new InboxRepository(db),
    activity,
    applyTaskTransition: (taskId, to, reason) => {
      tasksManagerForInbox.applyTransition(taskId, to, reason)
    },
  })

  const runtime = new OpenCodeRuntime()
  const broker = new SecretBroker(secrets)
  const providers = new ProviderService({
    providers: new ProviderRepository(db),
    secrets,
    broker,
  })
  const redactedActivity = broker.redactingActivity(activity)
  const network = new NetworkPolicyManager({
    db,
    settings: new SettingsRepository(db),
    activity: redactedActivity,
    events: new NetworkEventRepository(db),
  })
  const decision = new DecisionManager({
    settings: new SettingsRepository(db),
    secrets,
    activity: redactedActivity,
    fetchImpl: (url, init) => network.fetch(String(url), { method: String(init?.method ?? 'GET') }),
  })

  const modes = new ModeManager({ settings: new SettingsRepository(db), activity })

  const scheduler = new SchedulerService({ settings: new SettingsRepository(db), activity })

  const context = new ContextManager({ runtime, activity })

  const agents = new AgentManager({ runtime, activity })

  const skills = new SkillsManager({
    globalSkillsDir: join(homeDir(), '.config', 'opencode', 'skills'),
  })

  const mcp = new McpManager({
    globalConfigPath: join(homeDir(), '.config', 'opencode', 'opencode.json'),
    runtimeBaseUrl: () => runtime.ensureServer(),
    connect: async (base, name) => {
      try {
        const response = await fetch(`${base}/mcp/${encodeURIComponent(name)}/connect`, {
          method: 'POST',
        })
        return { ok: response.ok, status: response.status }
      } catch (cause) {
        return { ok: false, body: String(cause) }
      }
    },
  })

  const pause = new PauseManager({
    settings: new SettingsRepository(db),
    activity,
    reconcileLocks: (projectId) => {
      locks.reconcile(projectId)
    },
    disposeProjectTerminals: (projectId) => {
      if (projectId === '*') terminals.disposeAll()
      else terminals.disposeProject(projectId)
    },
  })

  const attemptManager = new AttemptManager({
    attempts: new AttemptRepository(db),
    goals: new GoalRepository(db),
    tasks,
    worktrees,
    inbox,
    activity,
    policyMaxAttempts: (projectId) => {
      const project = projectManager.listProjects().find((entry) => entry.id === projectId)
      return project
        ? loadPolicy(project.path).policy.changeLimits.maxAttempts
        : DEFAULT_MAX_ATTEMPTS
    },
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

  const chat = new ChatService({
    runtime,
    projects,
    sessions,
    activity,
    tasks,
    inbox,
    pause,
    onEvent: onChatEvent,
  })

  const terminals = new TerminalService({ onEvent: onTerminalEvent })

  return {
    db,
    projectManager,
    secrets,
    providers,
    chat,
    tasks,
    worktrees,
    locks,
    inbox,
    verification,
    verifier,
    attempts: attemptManager,
    pause,
    mcp,
    skills,
    agents,
    context,
    scheduler,
    modes,
    decision,
    network,
    policy: loadPolicy,
    runtime,
    terminals,
    explorer: listDirectory,
  }
}

/**
 * Builds the main-process service container from durable state in the
 * user's data directory. Re-running this against the same directory is the
 * "restart" path: everything is restored from SQLite.
 */
export function createServices(
  userDataDir: string,
  onChatEvent: (event: ChatPushEvent) => void = () => {},
  onTerminalEvent: (event: TerminalPushEvent) => void = () => {},
): StudioServices {
  return buildServices(
    userDataDir,
    new KeychainSecretStore(KEYCHAIN_SERVICE),
    onChatEvent,
    onTerminalEvent,
  )
}

/** Test/preview variant with an in-memory secret store. */
export function createServicesWithSecrets(
  userDataDir: string,
  secrets: SecretStore,
  onChatEvent: (event: ChatPushEvent) => void = () => {},
  onTerminalEvent: (event: TerminalPushEvent) => void = () => {},
): StudioServices {
  return buildServices(userDataDir, secrets, onChatEvent, onTerminalEvent)
}
