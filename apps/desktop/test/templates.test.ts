import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, SettingsRepository, SqliteDb } from '@studio/persistence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TemplateManager } from '../src/main/templates.js'
import { buildHarnessContainer, type HarnessContainer } from './harness-container.js'

let dir: string
let db: SqliteDb
let container: HarnessContainer
let templates: TemplateManager
let repo: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-tpl-'))
  db = SqliteDb.open(':memory:')
  migrate(db)
  let templatesRef: TemplateManager | undefined
  container = await buildHarnessContainer(db, dir, {
    hasRequiredVerification: (projectId) => {
      const active = templatesRef?.activeFor(projectId)
      if (!active) return true
      return active.verification.some((command) => command.required)
    },
  })
  templates = new TemplateManager({
    tasks: container.tasks,
    activity: container.activity,
    settings: new SettingsRepository(db),
  })
  templatesRef = templates
  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 't@t')
  git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'app.txt'), 'v1')
  mkdirSync(repo, { recursive: true })
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  container.projectManager.addProject(repo)
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Workflow templates (P5.5)', () => {
  it('ships all six templates', () => {
    expect(templates.list().map((template) => template.id)).toEqual([
      'bug-fix',
      'feature',
      'refactor-slice',
      'review',
      'ci-repair',
      'documentation',
    ])
  })

  it('apply preconfigures the goal contract and records the active template', () => {
    const project = container.projectManager.listProjects()[0]!
    const { goalId, template } = templates.apply({
      projectId: project.id,
      templateId: 'bug-fix',
      objective: 'Fix login timeout',
    })
    expect(template.id).toBe('bug-fix')

    const state = container.tasks.stateForProject(project.id)
    expect(state.goal?.id).toBe(goalId)
    expect(state.goal?.doneWhen).toContain('regression test added and passes')
    expect(state.goal?.nonGoals).toContain('no unrelated refactor')
    expect(state.goal?.status).toBe('ready') // apply marks it ready to run
    expect(state.goal?.maxAttempts).toBe(3)

    const active = templates.activeFor(project.id)
    expect(active?.templateId).toBe('bug-fix')
    expect(active?.independentVerifier).toBe(true)
    expect(active?.verification.length).toBeGreaterThan(0)
  })

  it('a template-driven run completes the standard workflow', async () => {
    const project = container.projectManager.listProjects()[0]!
    const { goalId } = templates.apply({
      projectId: project.id,
      templateId: 'documentation',
      objective: 'Document the backup feature',
    })
    const task = container.tasks.addTask(project.id, { title: 'Write docs', goalId })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)

    const started = await container.attempts.startAttempt({
      projectId: project.id,
      projectPath: repo,
      taskId: task.id,
    })
    const run = await container.verification.runPipeline(
      { id: project.id, path: repo },
      templates.activeFor(project.id)?.verification ?? [],
      { taskId: task.id },
    )
    expect(run.allRequiredPassed).toBe(true) // documentation template has no required checks

    container.runtime.replies = [
      'ok\n```json\n{"decision":"approve","reasons":["docs verified"],"failedCriteria":[],"evidence":[]}\n```',
    ]
    container.tasks.applyTransition(task.id, 'testing', 'self-check')
    container.tasks.applyTransition(task.id, 'verifying', 'docs ready for review')
    const decision = await container.verifier.reviewAttempt({
      projectId: project.id,
      projectPath: repo,
      taskId: task.id,
      worktreeId: started.worktreeId,
    })
    await container.verifier.applyDecision(task.id, decision)
    expect(
      container.tasks.stateForProject(project.id).tasks.find((entry) => entry.id === task.id)
        ?.status,
    ).toBe('done')
  }, 60_000)
})
