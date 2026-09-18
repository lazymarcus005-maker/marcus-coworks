import { join } from 'node:path'
import {
  ActivityRepository,
  migrate,
  ProjectRepository,
  ProviderRepository,
  SqliteDb,
  TabRepository,
} from '@studio/persistence'
import { ProjectManager } from '@studio/project-manager'
import { KeychainSecretStore, type SecretStore } from '@studio/secrets'
import { ProviderService } from './providers.js'

export const KEYCHAIN_SERVICE = 'com.marcus-coworks.agent-studio'

export interface StudioServices {
  db: SqliteDb
  projectManager: ProjectManager
  secrets: SecretStore
  providers: ProviderService
}

/**
 * Builds the main-process service container from durable state in the
 * user's data directory. Re-running this against the same directory is the
 * "restart" path: everything is restored from SQLite.
 */
export function createServices(userDataDir: string): StudioServices {
  const db = SqliteDb.open(join(userDataDir, 'studio.db'))
  migrate(db)
  const projectManager = new ProjectManager({
    projects: new ProjectRepository(db),
    tabs: new TabRepository(db),
    activity: new ActivityRepository(db),
  })
  const secrets = new KeychainSecretStore(KEYCHAIN_SERVICE)
  const providers = new ProviderService({
    providers: new ProviderRepository(db),
    secrets,
  })
  return { db, projectManager, secrets, providers }
}

/** Test/preview variant with an in-memory secret store. */
export function createServicesWithSecrets(
  userDataDir: string,
  secrets: SecretStore,
): StudioServices {
  const db = SqliteDb.open(join(userDataDir, 'studio.db'))
  migrate(db)
  const projectManager = new ProjectManager({
    projects: new ProjectRepository(db),
    tabs: new TabRepository(db),
    activity: new ActivityRepository(db),
  })
  const providers = new ProviderService({
    providers: new ProviderRepository(db),
    secrets,
  })
  return { db, projectManager, secrets, providers }
}
