import { join } from 'node:path'
import {
  ActivityRepository,
  migrate,
  ProjectRepository,
  SqliteDb,
  TabRepository,
} from '@studio/persistence'
import { ProjectManager } from '@studio/project-manager'

export interface StudioServices {
  db: SqliteDb
  projectManager: ProjectManager
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
  return { db, projectManager }
}
