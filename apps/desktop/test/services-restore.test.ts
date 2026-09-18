import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServices } from '../src/main/services.js'

/**
 * Integration: the "restart restores projects and tabs" acceptance.
 * createServices against the same user-data directory is exactly what an
 * app relaunch does.
 */
describe('services restart restore', () => {
  it('restores projects, tabs, and the active tab after close + reopen', () => {
    const userData = mkdtempSync(join(tmpdir(), 'studio-restore-'))
    const sources = ['one', 'two', 'three'].map((name) => {
      const dir = join(userData, `src-${name}`)
      mkdirSync(dir, { recursive: true })
      return dir
    })

    const ids: string[] = []
    const first = createServices(userData)
    for (const source of sources) {
      ids.push(first.projectManager.addProject(source).id)
    }
    first.projectManager.closeTab(ids[0] as string)
    first.projectManager.setActiveTab(ids[1] as string)
    first.db.close()

    const second = createServices(userData)
    const projects = second.projectManager.listProjects()
    expect(projects.map((p) => p.path)).toEqual(sources.map((p) => p))

    const tabs = second.projectManager.listTabs()
    expect(tabs.map((t) => t.projectId)).toEqual([ids[1], ids[2]])
    expect(second.projectManager.activeTabId()).toBe(ids[1])

    second.db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('re-running migrations on an existing database is a no-op', () => {
    const userData = mkdtempSync(join(tmpdir(), 'studio-mig-'))
    const first = createServices(userData)
    first.db.close()
    const second = createServices(userData)
    expect(second.projectManager.listProjects()).toEqual([])
    second.db.close()
    rmSync(userData, { recursive: true, force: true })
  })
})
