import type { ProjectWorkspace } from '@studio/shared'
import { describe, expect, it } from 'vitest'
import { migrate, SqliteDb } from '../src/index.js'
import { ActivityRepository } from '../src/repos/activity.js'
import { ProjectRepository } from '../src/repos/projects.js'
import { TabRepository } from '../src/repos/tabs.js'

function fixture() {
  const db = SqliteDb.open(':memory:')
  migrate(db)
  return {
    db,
    projects: new ProjectRepository(db),
    tabs: new TabRepository(db),
    activity: new ActivityRepository(db),
  }
}

function project(path: string, name?: string): ProjectWorkspace {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: name ?? path.split('/').pop() ?? 'project',
    path,
    status: 'idle',
    createdAt: now,
    lastActiveAt: now,
  }
}

describe('ProjectRepository', () => {
  it('round-trips projects with optional fields', () => {
    const { db, projects } = fixture()
    const p = project('/tmp/alpha', 'Alpha')
    p.sessionId = 'sess-1'
    projects.insert(p)

    const listed = projects.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('Alpha')
    expect(listed[0]?.sessionId).toBe('sess-1')
    expect(listed[0]?.model).toBeUndefined()
    db.close()
  })

  it('renames and deletes', () => {
    const { db, projects } = fixture()
    const p = project('/tmp/beta')
    projects.insert(p)
    projects.rename(p.id, 'Renamed', new Date().toISOString())
    expect(projects.get(p.id)?.name).toBe('Renamed')
    projects.delete(p.id)
    expect(projects.get(p.id)).toBeUndefined()
    db.close()
  })
})

describe('TabRepository', () => {
  it('orders tabs by position and tracks the active tab', () => {
    const { db, projects, tabs } = fixture()
    const a = project('/tmp/a')
    const b = project('/tmp/b')
    const c = project('/tmp/c')
    for (const p of [a, b, c]) projects.insert(p)

    tabs.open(a.id, new Date().toISOString())
    tabs.open(b.id, new Date().toISOString())
    tabs.open(c.id, new Date().toISOString())
    tabs.setActive(b.id)

    expect(tabs.list().map((t) => t.projectId)).toEqual([a.id, b.id, c.id])
    expect(tabs.activeTabId()).toBe(b.id)

    tabs.close(b.id)
    expect(tabs.list().map((t) => t.projectId)).toEqual([a.id, c.id])
    // Closing the active tab moves activation to the first remaining tab.
    expect(tabs.activeTabId()).toBe(a.id)
    db.close()
  })

  it('open is idempotent per project', () => {
    const { db, projects, tabs } = fixture()
    const a = project('/tmp/a')
    projects.insert(a)
    tabs.open(a.id, new Date().toISOString())
    tabs.open(a.id, new Date().toISOString())
    expect(tabs.list()).toHaveLength(1)
    db.close()
  })
})

describe('ActivityRepository', () => {
  it('records and lists events newest-first with optional payload', () => {
    const { db, activity } = fixture()
    activity.record('project.added', 'Added /tmp/a', { at: '2026-01-01T00:00:01Z' })
    activity.record('project.renamed', 'Renamed to B', {
      projectId: 'p1',
      payload: { from: 'A', to: 'B' },
      at: '2026-01-01T00:00:02Z',
    })

    const events = activity.listAll()
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('project.renamed')
    expect(events[0]?.payload).toEqual({ from: 'A', to: 'B' })
    expect(activity.listForProject('p1')).toHaveLength(1)
    db.close()
  })
})
