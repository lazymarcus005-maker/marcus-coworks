import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActivityRepository } from '@studio/persistence'
import type {
  AgentProfile,
  AgentTreeNode,
  CodingAgentRuntime,
  DelegationLimits,
} from '@studio/shared'
import { DEFAULT_DELEGATION_LIMITS } from '@studio/shared'

export interface AgentManagerDeps {
  runtime: CodingAgentRuntime
  activity: ActivityRepository
  limits?: DelegationLimits
}

function readDoc(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Agent/subagent manager (spec §32): CRUD over OpenCode's native `agent`
 * config entries in the project's opencode.json, plus delegation-limit
 * bookkeeping and the live session tree (spec §33).
 */
export class AgentManager {
  private readonly limits: DelegationLimits
  private activeSubagents = 0
  private totalSubagents = 0

  constructor(private readonly deps: AgentManagerDeps) {
    this.limits = deps.limits ?? DEFAULT_DELEGATION_LIMITS
  }

  list(projectPath: string): AgentProfile[] {
    const doc = readDoc(join(projectPath, 'opencode.json'))
    const agents = (doc.agent ?? {}) as Record<string, Record<string, unknown>>
    return Object.entries(agents).map(([name, raw]) => ({
      name,
      mode: raw.mode === 'subagent' || raw.mode === 'all' ? raw.mode : 'primary',
      model: typeof raw.model === 'string' ? raw.model : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      prompt: typeof raw.prompt === 'string' ? raw.prompt : undefined,
      tools:
        raw.tools !== null && typeof raw.tools === 'object'
          ? (raw.tools as Record<string, boolean>)
          : undefined,
      maxDelegationDepth:
        typeof raw.maxDelegationDepth === 'number' ? raw.maxDelegationDepth : undefined,
    }))
  }

  save(profile: AgentProfile, projectPath: string): AgentProfile {
    if (profile.name.trim() === '') throw new Error('Agent name is required')
    const path = join(projectPath, 'opencode.json')
    const doc = readDoc(path)
    const agents = { ...((doc.agent ?? {}) as Record<string, unknown>) }
    const entry: Record<string, unknown> = { mode: profile.mode }
    if (profile.model) entry.model = profile.model
    if (profile.description) entry.description = profile.description
    if (profile.prompt) entry.prompt = profile.prompt
    if (profile.tools) entry.tools = profile.tools
    if (profile.maxDelegationDepth) entry.maxDelegationDepth = profile.maxDelegationDepth
    agents[profile.name] = entry
    this.writeDoc(path, { ...doc, agent: agents })
    return profile
  }

  remove(name: string, projectPath: string): void {
    const path = join(projectPath, 'opencode.json')
    const doc = readDoc(path)
    const agents = { ...((doc.agent ?? {}) as Record<string, unknown>) }
    delete agents[name]
    this.writeDoc(path, { ...doc, agent: agents })
  }

  private writeDoc(path: string, doc: Record<string, unknown>): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8')
  }

  /**
   * Live delegation tree from the runtime's session hierarchy
   * (spec §33). A session can appear once per tree; cycles are cut.
   */
  async buildTree(rootSessionId: string, depth = 0): Promise<AgentTreeNode> {
    const children = await this.deps.runtime.listChildren(rootSessionId)
    const node: AgentTreeNode = { sessionId: rootSessionId, children: [] }
    if (depth >= this.limits.maxDepth) return node
    for (const child of children) {
      node.children.push(await this.buildTree(child, depth + 1))
    }
    return node
  }

  /** Mechanical delegation guardrails (spec §32 delegation limits). */
  assertCanDelegate(): void {
    if (this.activeSubagents + 1 > this.limits.maxActivePerProject) {
      throw new Error(
        `Delegation limit reached: ${this.limits.maxActivePerProject} active subagents per project`,
      )
    }
    if (this.totalSubagents + 1 > this.limits.maxTotal) {
      throw new Error(`Delegation limit reached: ${this.limits.maxTotal} total subagents`)
    }
  }

  trackSubagentStarted(): void {
    this.activeSubagents += 1
    this.totalSubagents += 1
  }

  trackSubagentEnded(): void {
    this.activeSubagents = Math.max(0, this.activeSubagents - 1)
  }

  getLimits(): DelegationLimits {
    return { ...this.limits }
  }
}
