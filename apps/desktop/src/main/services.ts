import { join } from 'node:path'
import { OpenCodeRuntime } from '@studio/opencode-adapter'
import {
  ActivityRepository,
  GoalRepository,
  migrate,
  ProjectRepository,
  ProviderRepository,
  SessionRepository,
  SqliteDb,
  TabRepository,
  TaskRepository,
  TaskTransitionRepository,
  WorktreeRepository,
} from '@studio/persistence'
import { ProjectManager } from '@studio/project-manager'
import { KeychainSecretStore, type SecretStore } from '@studio/secrets'
import type { ChatPushEvent } from '@studio/shared'
import { TaskManager } from '@studio/task-manager'
import { gitRunner, WorktreeManager } from '@studio/worktree-manager'
import { ChatService } from './chat.js'
import { listDirectory } from './explorer.js'
import { ProviderService } from './providers.js'
import { type TerminalPushEvent, TerminalService } from './terminal.js'

export const KEYCHAIN_SERVICE = 'com.marcus-coworks.agent-studio'

export interface StudioServices {
  db: SqliteDb
  projectManager: ProjectManager
  secrets: SecretStore
  providers: ProviderService
  chat: ChatService
  tasks: TaskManager
  worktrees: WorktreeManager
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
  const providers = new ProviderService({
    providers: new ProviderRepository(db),
    secrets,
  })
  const tasks = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity,
    transitions: new TaskTransitionRepository(db),
  })

  const worktrees = new WorktreeManager({
    worktrees: new WorktreeRepository(db),
    activity,
    git: gitRunner(),
  })

  const runtime = new OpenCodeRuntime()
  const chat = new ChatService({
    runtime,
    projects,
    sessions,
    activity,
    tasks,
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
