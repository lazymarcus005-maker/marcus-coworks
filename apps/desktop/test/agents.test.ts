import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodingAgentRuntime, RuntimeEvent } from '@studio/shared'
import { DEFAULT_DELEGATION_LIMITS } from '@studio/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AgentManager } from '../src/main/agents.js'

let dir: string
let project: string
let manager: AgentManager

function fakeActivity() {
  return { record: () => ({}) } as unknown as import('@studio/persistence').ActivityRepository
}

class TreeRuntime implements CodingAgentRuntime {
  tree = new Map<string, string[]>()
  async detect() {
    return { available: true, binary: 'fake' }
  }
  async ensureServer() {
    return 'http://127.0.0.1:1'
  }
  async createSession() {
    return { id: 'ses_x' }
  }
  async resumeSession() {
    return true
  }
  async sendMessage() {}
  async stopSession() {}
  async getStatus() {
    return 'idle' as const
  }
  async listMessages() {
    return []
  }
  async listChildren(sessionId: string) {
    return this.tree.get(sessionId) ?? []
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    void listener
    return () => undefined
  }
  async dispose() {}
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-agents-'))
  project = join(dir, 'project')
  manager = new AgentManager({ runtime: new TreeRuntime(), activity: fakeActivity() })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('AgentManager config CRUD', () => {
  it('saves an agent profile in the project opencode.json', () => {
    manager.save(
      {
        name: 'reviewer',
        mode: 'subagent',
        model: 'openai/gpt-5-mini',
        description: 'Reviews diffs',
        tools: { write: false, edit: false },
        maxDelegationDepth: 2,
      },
      project,
    )

    const doc = JSON.parse(readFileSync(join(project, 'opencode.json'), 'utf-8')) as {
      agent: Record<string, { mode: string; model?: string; tools?: Record<string, boolean> }>
    }
    expect(doc.agent.reviewer).toMatchObject({
      mode: 'subagent',
      model: 'openai/gpt-5-mini',
      tools: { write: false, edit: false },
    })
  })

  it('lists profiles with normalized fields', () => {
    const profiles = manager.list(project)
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      name: 'reviewer',
      mode: 'subagent',
      maxDelegationDepth: 2,
    })
  })

  it('removes profiles', () => {
    manager.save({ name: 'temp', mode: 'subagent' }, project)
    manager.remove('temp', project)
    expect(manager.list(project).map((profile) => profile.name)).toEqual(['reviewer'])
  })

  it('rejects empty names and preserves foreign config keys', () => {
    expect(() => manager.save({ name: '', mode: 'primary' }, project)).toThrow(/name/)

    const path = join(project, 'opencode.json')
    const doc = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    doc.theme = 'night'
    writeFileSync(path, JSON.stringify(doc, null, 2))
    manager.save({ name: 'explorer', mode: 'subagent' }, project)
    const after = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    expect(after.theme).toBe('night')
  })
})

describe('delegation tree + limits', () => {
  it('builds the live session tree up to maxDepth', async () => {
    const runtime = new TreeRuntime()
    runtime.tree.set('root', ['c1', 'c2'])
    runtime.tree.set('c1', ['c1a'])
    const treeManager = new AgentManager({
      runtime,
      activity: fakeActivity(),
      limits: { maxDepth: 2, maxActivePerProject: 8, maxTotal: 32 },
    })

    const tree = await treeManager.buildTree('root')
    expect(tree.sessionId).toBe('root')
    expect(tree.children.map((child) => child.sessionId).sort()).toEqual(['c1', 'c2'])
    expect(tree.children[0]?.children.map((child) => child.sessionId)).toEqual(['c1a'])
  })

  it('cuts deep trees at the configured depth', async () => {
    const runtime = new TreeRuntime()
    runtime.tree.set('a', ['b'])
    runtime.tree.set('b', ['c'])
    runtime.tree.set('c', ['d'])
    const shallow = new AgentManager({
      runtime,
      activity: fakeActivity(),
      limits: { maxDepth: 2, maxActivePerProject: 8, maxTotal: 32 },
    })

    const tree = await shallow.buildTree('a')
    expect(tree.children[0]?.sessionId).toBe('b') // depth 1
    expect(tree.children[0]?.children[0]?.sessionId).toBe('c') // depth 2
    expect(tree.children[0]?.children[0]?.children).toEqual([]) // depth cap
  })

  it('enforces active and total subagent limits mechanically', () => {
    const limits = DEFAULT_DELEGATION_LIMITS
    void limits
    const runtime = new TreeRuntime()
    const limited = new AgentManager({
      runtime,
      activity: fakeActivity(),
      limits: { maxDepth: 4, maxActivePerProject: 2, maxTotal: 3 },
    })

    limited.assertCanDelegate()
    limited.trackSubagentStarted()
    limited.trackSubagentStarted()
    expect(() => limited.assertCanDelegate()).toThrow(/active subagents/)

    limited.trackSubagentEnded()
    limited.assertCanDelegate()
    limited.trackSubagentStarted() // active 2, total 3
    limited.trackSubagentEnded() // active 1, total 3
    expect(() => limited.assertCanDelegate()).toThrow(/total subagents/)
  })
})
