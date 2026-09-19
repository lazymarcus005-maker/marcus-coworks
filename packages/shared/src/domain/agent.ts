/** Agent/subagent configuration domain (spec §32–33). */
export type AgentMode = 'primary' | 'subagent' | 'all'

export type AgentProfile = {
  name: string
  mode: AgentMode
  /** 'provider/model' as OpenCode expects, or omitted for the default. */
  model?: string
  description?: string
  prompt?: string
  /** Tool switches passed through to OpenCode, e.g. { write: false }. */
  tools?: Record<string, boolean>
  /** Delegation guardrail (Agent Studio enforced). */
  maxDelegationDepth?: number
}

export type AgentTreeNode = {
  sessionId: string
  title?: string
  /** Model that produced messages in this session, when known. */
  model?: string
  children: AgentTreeNode[]
}

export type DelegationLimits = {
  maxDepth: number
  maxActivePerProject: number
  maxTotal: number
}

export const DEFAULT_DELEGATION_LIMITS: DelegationLimits = {
  maxDepth: 4,
  maxActivePerProject: 8,
  maxTotal: 32,
}
