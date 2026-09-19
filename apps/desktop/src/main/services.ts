import { join } from 'node:path'
import { OpenCodeRuntime } from '@studio/opencode-adapter'
import {
  ActivityRepository,
  migrate,
  ProjectRepository,
  ProviderRepository,
  SessionRepository,
  SqliteDb,
  TabRepository,
} from '@studio/persistence'
import { ProjectManager } from '@studio/project-manager'
import { KeychainSecretStore, type SecretStore } from '@studio/secrets'
import type { ChatPushEvent } from '@studio/shared'
import { ChatService } from './chat.js'
import { ProviderService } from './providers.js'

export const KEYCHAIN_SERVICE = 'com.marcus-coworks.agent-studio'

export interface StudioServices {
  db: SqliteDb
  projectManager: ProjectManager
  secrets: SecretStore
  providers: ProviderService
  chat: ChatService
  runtime: OpenCodeRuntime
}

function buildServices(
  userDataDir: string,
  secrets: SecretStore,
  onChatEvent: (event: ChatPushEvent) => void,
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

  const runtime = new OpenCodeRuntime()
  const chat = new ChatService({
    runtime,
    projects,
    sessions,
    activity,
    onEvent: onChatEvent,
  })

  return { db, projectManager, secrets, providers, chat, runtime }
}

/**
 * Builds the main-process service container from durable state in the
 * user's data directory. Re-running this against the same directory is the
 * "restart" path: everything is restored from SQLite.
 */
export function createServices(
  userDataDir: string,
  onChatEvent: (event: ChatPushEvent) => void = () => {},
): StudioServices {
  return buildServices(userDataDir, new KeychainSecretStore(KEYCHAIN_SERVICE), onChatEvent)
}

/** Test/preview variant with an in-memory secret store. */
export function createServicesWithSecrets(
  userDataDir: string,
  secrets: SecretStore,
  onChatEvent: (event: ChatPushEvent) => void = () => {},
): StudioServices {
  return buildServices(userDataDir, secrets, onChatEvent)
}
