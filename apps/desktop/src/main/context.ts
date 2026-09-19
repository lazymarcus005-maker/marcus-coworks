import type { ActivityRepository } from '@studio/persistence'
import type { CodingAgentRuntime } from '@studio/shared'

export type ModelContextProfile = {
  provider?: string
  model: string
  contextWindow: number
  maxOutputTokens?: number
  autoCompact: boolean
  /** Source of the resolution, per spec §27.2 priority chain. */
  source: 'explicit' | 'provider-metadata' | 'catalog' | 'fallback'
}

export type ContextUsage = {
  profile: ModelContextProfile
  estimatedActiveTokens: number
  safetyReserve: number
  lastCompactedAt?: string
}

export interface ContextManagerDeps {
  runtime: CodingAgentRuntime
  activity: ActivityRepository
  /** Explicit per-model overrides from app settings (highest priority). */
  explicitOverrides?: Record<string, { contextWindow: number; maxOutputTokens?: number }>
  /** Fetches provider/model metadata from the runtime (second priority). */
  fetchProviderMetadata?: () => Promise<Record<string, number>>
  now?: () => Date
}

/** Built-in catalog for well-known model families (fourth priority). */
const CATALOG: Record<string, number> = {
  'gpt-5': 400_000,
  'gpt-4o': 128_000,
  'claude-sonnet': 200_000,
  'claude-opus': 200_000,
  qwen: 262_144,
  llama: 128_000,
  gemini: 1_000_000,
  deepseek: 128_000,
}

export const FALLBACK_CONTEXT_WINDOW = 32_768
export const DEFAULT_SAFETY_RESERVE = 8_192

/**
 * Context manager (spec §27). OpenCode's native compaction stays the
 * mechanism (summarize endpoint + internal auto-compact); Agent Studio
 * adds model-aware profiles, usage visibility, audits, and safe model
 * switching.
 */
export class ContextManager {
  private readonly now: () => Date
  private readonly lastCompacted = new Map<string, string>()

  constructor(private readonly deps: ContextManagerDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Resolution priority: explicit → provider metadata → catalog → fallback. */
  async profileFor(model: string): Promise<ModelContextProfile> {
    const override = this.deps.explicitOverrides?.[model]
    if (override) {
      return {
        model,
        contextWindow: override.contextWindow,
        maxOutputTokens: override.maxOutputTokens,
        autoCompact: true,
        source: 'explicit',
      }
    }

    if (this.deps.fetchProviderMetadata) {
      try {
        const metadata = await this.deps.fetchProviderMetadata()
        const window = metadata[model]
        if (window !== undefined) {
          return { model, contextWindow: window, autoCompact: true, source: 'provider-metadata' }
        }
      } catch {
        // Metadata unavailable — fall through.
      }
    }

    for (const [family, window] of Object.entries(CATALOG)) {
      if (model.toLowerCase().includes(family)) {
        return { model, contextWindow: window, autoCompact: true, source: 'catalog' }
      }
    }

    return {
      model,
      contextWindow: FALLBACK_CONTEXT_WINDOW,
      autoCompact: true,
      source: 'fallback',
    }
  }

  /** Estimated active tokens for a session from runtime-reported usage. */
  async usageFor(sessionId: string, model: string): Promise<ContextUsage> {
    const profile = await this.profileFor(model)
    const messages = await this.deps.runtime.listMessages(sessionId)
    const latest = [...messages].reverse().find((message) => message.tokens !== undefined)
    // Runtime token counters are cumulative for the session; the latest
    // message's counters approximate the active context size.
    const estimated = latest?.tokens === undefined ? 0 : latest.tokens.input + latest.tokens.output
    return {
      profile,
      estimatedActiveTokens: estimated,
      safetyReserve: DEFAULT_SAFETY_RESERVE,
      lastCompactedAt: this.lastCompacted.get(sessionId),
    }
  }

  /** Manual Compact Now (native summarize), audited. */
  async compact(sessionId: string): Promise<void> {
    await this.deps.runtime.summarizeSession(sessionId)
    const at = this.now().toISOString()
    this.lastCompacted.set(sessionId, at)
    this.deps.activity.record('context.compacted', `Session compacted via native summarization`, {
      payload: { sessionId },
    })
  }

  /**
   * Model-switch safety (spec §27.7): if the target model's window cannot
   * hold the current context plus reserve, compaction MUST run first.
   * Returns whether a compaction was performed.
   */
  async assertModelSwitchSafe(
    sessionId: string,
    currentModel: string,
    targetModel: string,
  ): Promise<{ compacted: boolean; profile: ModelContextProfile }> {
    const usage = await this.usageFor(sessionId, currentModel)
    const target = await this.profileFor(targetModel)

    if (usage.estimatedActiveTokens + usage.safetyReserve > target.contextWindow) {
      await this.compact(sessionId)
      return { compacted: true, profile: target }
    }
    return { compacted: false, profile: target }
  }
}
