import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  migrate,
  ProjectRepository,
  SqliteDb,
  TabRepository,
} from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProjectManager, ProjectManagerError } from '../src/project-manager.js'

let dir: string
let db: SqliteDb
let manager: ProjectManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-pm-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  manager = new ProjectManager({
    projects: new ProjectRepository(db),
    tabs: new TabRepository(db),
    activity: new ActivityRepository(db),
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeSourceDir(name: string): string {
  const path = join(dir, name)
  mkdirSync(path, { recursive: true })
  return path
}

describe('ProjectManager lifecycle', () => {
  it('adds a project, opens its tab, and activates it', () => {
    const path = makeSourceDir('alpha')
    const project = manager.addProject(path)
    expect(project.name).toBe('alpha')
    expect(project.status).toBe('idle')

    expect(manager.listTabs().map((t) => t.projectId)).toContain(project.id)
    expect(manager.activeTabId()).toBe(project.id)
  })

  it('rejects a duplicate path', () => {
    const path = makeSourceDir('dupe')
    manager.addProject(path)
    expect(() => manager.addProject(path)).toThrowError(ProjectManagerError)
  })

  it('rejects a missing path without registering anything', () => {
    const before = manager.listProjects().length
    expect(() => manager.addProject(join(dir, 'missing'))).toThrowError(/not exist/)
    expect(manager.listProjects()).toHaveLength(before)
  })

  it('renames a project', () => {
    const path = makeSourceDir('gamma')
    const project = manager.addProject(path, 'Original')
    const renamed = manager.renameProject(project.id, 'Renamed')
    expect(renamed.name).toBe('Renamed')
    expect(manager.getProject(project.id).name).toBe('Renamed')
  })

  it('closing a tab keeps the project registered; reopening restores the tab', () => {
    const path = makeSourceDir('delta')
    const project = manager.addProject(path)
    manager.closeTab(project.id)
    expect(manager.listTabs().map((t) => t.projectId)).not.toContain(project.id)
    expect(manager.listProjects().map((p) => p.id)).toContain(project.id)

    manager.openTab(project.id)
    expect(manager.listTabs().map((t) => t.projectId)).toContain(project.id)
  })

  it('removing a project deletes registry state but never source files', () => {
    const path = makeSourceDir('epsilon')
    const project = manager.addProject(path)

    manager.removeProject(project.id, {
      removeHistory: true,
      removeCache: false,
      removeCompletedWorktrees: false,
    })

    expect(manager.listProjects().map((p) => p.id)).not.toContain(project.id)
    expect(manager.listTabs().map((t) => t.projectId)).not.toContain(project.id)
    // The user's source directory is untouched.
    expect(existsSync(path)).toBe(true)
  })

  it('records activity events for lifecycle changes', () => {
    const events = manager.listActivity()
    const types = events.map((e) => e.type)
    expect(types).toContain('project.added')
    expect(types).toContain('project.renamed')
    expect(types).toContain('project.removed')
    expect(types).toContain('tab.closed')
  })

  it('three projects can be registered and open simultaneously', () => {
    for (const name of ['proj-a', 'proj-b', 'proj-c']) {
      manager.addProject(makeSourceDir(name))
    }
    expect(manager.listProjects().length).toBeGreaterThanOrEqual(3)
    expect(manager.listTabs().length).toBeGreaterThanOrEqual(3)
  })
})
