import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StudioApi } from '@studio/shared'
import {
  type ElectronApplication,
  type Page,
  _electron as playwrightElectron,
} from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Phase 1 exit E2E: register 3 projects in the real app, start independent
 * chat sessions, restart the app against the same data directory, and
 * verify everything restores with no cross-project leakage.
 *
 * Every API call runs inside page.evaluate against the real preload bridge;
 * only serializable data crosses the boundary.
 */
/**
 * Every evaluate callback must be self-contained: Playwright transmits the
 * function source into the page, so outer closures are unavailable. The
 * window cast is inlined in each callback below.
 */
type PageStudio = (window: unknown) => StudioApi
const S: PageStudio = (w) => (w as { studio: StudioApi }).studio

describe('phase 1 exit: multi-project restart E2E', () => {
  let scratch: string
  let userData: string
  const projectDirs: string[] = []
  const sessionIds: string[] = []

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'studio-e2e-'))
    userData = join(scratch, 'user-data')
    for (const name of ['alpha', 'beta', 'gamma']) {
      const dir = join(scratch, name)
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'note.txt'), `project ${name}\n`)
      projectDirs.push(dir)
    }
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  function launch(): Promise<ElectronApplication> {
    return playwrightElectron.launch({
      args: [join('apps', 'desktop')],
      cwd: process.cwd(),
      env: {
        ...process.env,
        STUDIO_USER_DATA_DIR: userData,
        STUDIO_SMOKE: '',
      } as Record<string, string>,
    })
  }

  const api = {
    addProject: (page: Page, dir: string) =>
      page.evaluate(
        (d: string) => (window as unknown as { studio: StudioApi }).studio.projects.add(d),
        dir,
      ),
    listProjects: (page: Page) =>
      page.evaluate(() => (window as unknown as { studio: StudioApi }).studio.projects.list()),
    tabState: (page: Page) =>
      page.evaluate(() => (window as unknown as { studio: StudioApi }).studio.projects.tabState()),
    closeTab: (page: Page, projectId: string) =>
      page.evaluate(
        (id: string) => (window as unknown as { studio: StudioApi }).studio.projects.closeTab(id),
        projectId,
      ),
    openTab: (page: Page, projectId: string) =>
      page.evaluate(
        (id: string) => (window as unknown as { studio: StudioApi }).studio.projects.openTab(id),
        projectId,
      ),
    activateTab: (page: Page, projectId: string) =>
      page.evaluate(
        (id: string) =>
          (window as unknown as { studio: StudioApi }).studio.projects.activateTab(id),
        projectId,
      ),
    chatStart: (page: Page, projectId: string) =>
      page.evaluate(
        (id: string) => (window as unknown as { studio: StudioApi }).studio.chat.start(id),
        projectId,
      ),
    createGoal: (page: Page, projectId: string, objective: string) =>
      page.evaluate(
        ([id, text]: [string, string]) =>
          (window as unknown as { studio: StudioApi }).studio.tasks.createGoal(id, text),
        [projectId, objective] as [string, string],
      ),
    addTask: (page: Page, projectId: string, title: string) =>
      page.evaluate(
        ([id, t]: [string, string]) =>
          (window as unknown as { studio: StudioApi }).studio.tasks.add(id, t),
        [projectId, title] as [string, string],
      ),
    taskState: (page: Page, projectId: string) =>
      page.evaluate(
        (id: string) => (window as unknown as { studio: StudioApi }).studio.tasks.state(id),
        projectId,
      ),
  }

  it('3 projects → independent sessions → restart → full restore', {
    timeout: 300_000,
  }, async () => {
    // ---- first launch ----
    const appOne = await launch()
    const pageOne = await appOne.firstWindow()

    for (const dir of projectDirs) {
      await api.addProject(pageOne, dir)
    }
    const listed = await api.listProjects(pageOne)
    expect(listed.projects).toHaveLength(3)
    expect(listed.projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma'])

    // Independent chat sessions per project.
    for (const project of listed.projects) {
      const { sessionId } = await api.chatStart(pageOne, project.id)
      sessionIds.push(sessionId)
    }
    expect(new Set(sessionIds).size).toBe(3)

    // Durable task state: goal + task for project alpha.
    const alpha = listed.projects.find((p) => p.name === 'alpha')
    if (!alpha) throw new Error('alpha missing')
    await api.createGoal(pageOne, alpha.id, 'E2E goal for alpha')
    await api.addTask(pageOne, alpha.id, 'Verify restart restore')

    // Tab semantics: close alpha's tab; activation moves to another.
    await api.closeTab(pageOne, alpha.id)
    const afterClose = await api.tabState(pageOne)
    expect(afterClose.tabs).toHaveLength(2)
    expect(afterClose.activeProjectId).not.toBe(alpha.id)
    await api.openTab(pageOne, alpha.id)

    await appOne.close()

    // ---- restart against the same data directory ----
    const appTwo = await launch()
    const pageTwo = await appTwo.firstWindow()

    // Projects restored.
    const relisted = await api.listProjects(pageTwo)
    expect(relisted.projects.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma'])

    // Tabs + active tab restored.
    const tabState = await api.tabState(pageTwo)
    expect(tabState.tabs).toHaveLength(3)
    expect(tabState.activeProjectId).toBe(alpha.id)

    // Sessions resume to the same ids — no duplicate session creation.
    for (const project of relisted.projects) {
      const { sessionId } = await api.chatStart(pageTwo, project.id)
      expect(sessionIds).toContain(sessionId)
    }

    // Task state restored.
    const taskState = await api.taskState(pageTwo, alpha.id)
    expect(taskState.goal?.objective).toBe('E2E goal for alpha')
    expect(taskState.tasks.map((t) => t.title)).toContain('Verify restart restore')

    // Isolation after restore: alpha's goal does not leak into beta.
    const beta = relisted.projects.find((p) => p.name === 'beta')
    if (!beta) throw new Error('beta missing')
    const betaTasks = await api.taskState(pageTwo, beta.id)
    expect(betaTasks.goal).toBeUndefined()

    // Tab switching preserves state for every project.
    for (const project of relisted.projects) {
      await api.activateTab(pageTwo, project.id)
      const switched = await api.tabState(pageTwo)
      expect(switched.activeProjectId).toBe(project.id)
      expect(switched.tabs).toHaveLength(3)
    }

    await appTwo.close()
  })
})
