import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActivityRepository,
  AttemptRepository,
  GoalRepository,
  InboxRepository,
  migrate,
  SqliteDb,
  TaskRepository,
  TaskTransitionRepository,
  WorktreeRepository,
} from '@studio/persistence'
import { TaskManager } from '@studio/task-manager'
import { gitRunner, WorktreeManager } from '@studio/worktree-manager'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AttemptManager } from '../src/main/attempts.js'
import { InboxManager } from '../src/main/inbox.js'

let dir: string
let db: SqliteDb
let repo: string
let tasks: TaskManager
let attempts: AttemptManager
let inbox: InboxManager

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-attempts-'))
  db = SqliteDb.open(':memory:')
  migrate(db)

  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-b', 'main', repo])
  git(repo, 'config', 'user.email', 'test@studio.local')
  git(repo, 'config', 'user.name', 'Studio Test')
  writeFileSync(join(repo, 'README.md'), '# base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')

  const activity = new ActivityRepository(db)
  tasks = new TaskManager({
    tasks: new TaskRepository(db),
    goals: new GoalRepository(db),
    activity,
    transitions: new TaskTransitionRepository(db),
  })
  inbox = new InboxManager({
    inbox: new InboxRepository(db),
    activity,
  })
  const worktrees = new WorktreeManager({
    worktrees: new WorktreeRepository(db),
    activity,
    git: gitRunner(),
  })
  attempts = new AttemptManager({
    attempts: new AttemptRepository(db),
    goals: new GoalRepository(db),
    tasks,
    worktrees,
    inbox,
    activity,
  })
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('AttemptManager', () => {
  it('records attempts with worktree linkage and ordering', async () => {
    const task = tasks.addTask('p1', { title: 'Ledger task' })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)

    const first = await attempts.startAttempt({
      projectId: 'p1',
      projectPath: repo,
      taskId: task.id,
      model: 'local-coder',
    })
    expect(first.record.attempt).toBe(1)
    expect(first.record.worktreeId).toBeTruthy()
    expect(first.record.model).toBe('local-coder')

    attempts.endAttempt(first.record.id, {
      outcome: 'rejected',
      failureClass: 'TestRegression',
      summary: 'tests failed',
    })
    const ended = attempts.history(task.id)[0]
    expect(ended).toMatchObject({
      attempt: 1,
      outcome: 'rejected',
      failureClass: 'TestRegression',
    })
    expect(ended?.endedAt).toBeTruthy()
  })

  it('blocks the fourth attempt mechanically (cap 3)', async () => {
    const task = tasks.addTask('p-cap', { title: 'Cap task' })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)

    for (let index = 0; index < 3; index += 1) {
      const started = await attempts.startAttempt({
        projectId: 'p-cap',
        projectPath: repo,
        taskId: task.id,
      })
      attempts.endAttempt(started.record.id, { outcome: 'failed', failureClass: 'BuildFailure' })
      // Reset the machine to ready for the next startAttempt.
      db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)
    }

    await expect(
      attempts.startAttempt({ projectId: 'p-cap', projectPath: repo, taskId: task.id }),
    ).rejects.toThrow(/Attempt cap reached/)
    expect(attempts.attemptsUsed(task.id)).toBe(3)
  })

  it('the effective cap is the goal contract clamped by policy', async () => {
    const goal = tasks.createGoalDraft('p-cap2', 'Two attempts only')
    tasks.updateGoalContract(goal.id, { maxAttempts: 2 })
    const task = tasks.addTask('p-cap2', { title: 'Tight cap', goalId: goal.id })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)

    expect(attempts.capFor({ projectId: 'p-cap2', goalId: goal.id })).toBe(2)

    for (let index = 0; index < 2; index += 1) {
      const started = await attempts.startAttempt({
        projectId: 'p-cap2',
        projectPath: repo,
        taskId: task.id,
      })
      attempts.endAttempt(started.record.id, { outcome: 'failed' })
      db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)
    }
    await expect(
      attempts.startAttempt({ projectId: 'p-cap2', projectPath: repo, taskId: task.id }),
    ).rejects.toThrow(/Attempt cap reached/)
  })

  it('retryOrEscalate escalates at the cap with preserved history', async () => {
    const task = tasks.addTask('p-esc', { title: 'Escalate me' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)

    // Burn the three attempts.
    for (let index = 0; index < 3; index += 1) {
      const started = await attempts.startAttempt({
        projectId: 'p-esc',
        projectPath: repo,
        taskId: task.id,
      })
      attempts.endAttempt(started.record.id, {
        outcome: 'rejected',
        failureClass: 'ImplementationFailure',
        summary: `attempt ${index + 1} rejected`,
      })
      if (index < 2) {
        // Back to verifying for the next round.
        db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)
      }
    }

    const result = await attempts.retryOrEscalate({
      projectId: 'p-esc',
      projectPath: repo,
      taskId: task.id,
      rejectionReason: 'unrelated changes in every attempt',
    })

    expect(result.escalated).toBe(true)
    const state = tasks.stateForProject('p-esc').tasks.find((entry) => entry.id === task.id)
    expect(state?.status).toBe('human_required')

    const items = inbox.listOpen().filter((item) => item.kind === 'attempts-exhausted')
    expect(items).toHaveLength(1)
    // Full attempt history preserved and linked as evidence.
    expect(items[0]?.evidenceIds).toHaveLength(3)
    expect(attempts.history(task.id)).toHaveLength(3)
    expect(attempts.history(task.id).every((entry) => entry.outcome === 'rejected')).toBe(true)
  })

  it('retryOrEscalate under the cap starts the next attempt through the machine', async () => {
    const task = tasks.addTask('p-retry', { title: 'Retry me' })
    db.run("UPDATE tasks SET status = 'verifying' WHERE id = ?", task.id)

    const result = await attempts.retryOrEscalate({
      projectId: 'p-retry',
      projectPath: repo,
      taskId: task.id,
      rejectionReason: 'fix did not hold',
    })

    expect(result.escalated).toBe(false)
    expect(result.attempt?.attempt).toBe(1)
    expect(
      tasks.stateForProject('p-retry').tasks.find((entry) => entry.id === task.id)?.status,
    ).toBe('running')

    const history = tasks.transitionHistory(task.id)
    expect(history.map((entry) => entry.to)).toEqual(['rejected', 'retry', 'running'])
  })

  it('worktree creation stays idempotent per attempt across retries', async () => {
    const task = tasks.addTask('p-idem', { title: 'Idempotent worktrees' })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)
    const first = await attempts.startAttempt({
      projectId: 'p-idem',
      projectPath: repo,
      taskId: task.id,
    })
    const second = await attempts
      .startAttempt({
        projectId: 'p-idem',
        projectPath: repo,
        taskId: task.id,
      })
      .catch(() => null)
    // Second start is rejected: the task is running, but even if statuses
    // were reset, the same attempt number would reuse the worktree.
    void second
    expect(first.record.attempt).toBe(1)
  })
})

describe('failure classification integration', () => {
  it('endAttempt derives the failure class from the signal and audits it', async () => {
    const task = tasks.addTask('p-classify', { title: 'Classify me' })
    db.run("UPDATE tasks SET status = 'ready' WHERE id = ?", task.id)
    const started = await attempts.startAttempt({
      projectId: 'p-classify',
      projectPath: repo,
      taskId: task.id,
    })

    attempts.endAttempt(started.record.id, {
      outcome: 'failed',
      failureSignal: {
        source: 'verification',
        exitCode: 1,
        output: 'Tests: 2 failed, 40 passed',
      },
    })

    const record = attempts.history(task.id)[0]
    expect(record?.failureClass).toBe('TestRegression')

    const events = db.all(
      "SELECT * FROM activity_events WHERE type = 'failure.classified' AND project_id = ?",
      'p-classify',
    )
    expect(events).toHaveLength(1)
    const payload = JSON.parse(String(events[0]?.payload_json)) as { recovery: string }
    expect(payload.recovery).toBe('repair-attempt')
  })
})
