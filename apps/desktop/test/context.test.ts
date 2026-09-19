import type { ActivityRepository } from '@studio/persistence'
import type { ChatMessage, CodingAgentRuntime, RuntimeEvent } from '@studio/shared'
import { describe, expect, it } from 'vitest'
import {
  ContextManager,
  FALLBACK_CONTEXT_WINDOW,
  type ModelContextProfile,
} from '../src/main/context.js'

class UsageRuntime implements CodingAgentRuntime {
  summarizeCalls = 0
  tokens: { input: number; output: number } | undefined
  async detect() {
    return { available: true, binary: 'fake' }
  }
  async ensureServer() {
    return 'http://127.0.0.1:1'
  }
  async createSession() {
    return { id: 'ses_1' }
  }
  async resumeSession() {
    return true
  }
  async sendMessage() {}
  async stopSession() {}
  async getStatus() {
    return 'idle' as const
  }
  async summarizeSession() {
    this.summarizeCalls += 1
  }
  async listChildren() {
    return []
  }
  async listMessages(): Promise<ChatMessage[]> {
    return [
      {
        id: 'm1',
        sessionId: 'ses_1',
        role: 'user',
        text: 'hi',
        createdAt: 1,
        tokens: { input: 100, output: 0 },
      },
      {
        id: 'm2',
        sessionId: 'ses_1',
        role: 'assistant',
        text: 'hello',
        createdAt: 2,
        tokens: this.tokens ?? { input: 40_000, output: 2_000 },
      },
    ]
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    void listener
    return () => undefined
  }
  async dispose() {}
}

function fakeActivity() {
  const events: { type: string }[] = []
  return {
    events,
    repo: {
      record: (type: string) => {
        events.push({ type })
        return {}
      },
    } as unknown as ActivityRepository,
  }
}

describe('ContextManager profile resolution (spec §27.2)', () => {
  const runtime = new UsageRuntime()

  it('explicit overrides win first', async () => {
    const manager = new ContextManager({
      runtime,
      activity: fakeActivity().repo,
      explicitOverrides: { 'my-model': { contextWindow: 16_384 } },
    })
    const profile = await manager.profileFor('my-model')
    expect(profile).toMatchObject({ contextWindow: 16_384, source: 'explicit' })
  })

  it('provider metadata is second', async () => {
    const manager = new ContextManager({
      runtime,
      activity: fakeActivity().repo,
      fetchProviderMetadata: async () => ({ 'custom-model': 65_536 }),
    })
    const profile = await manager.profileFor('custom-model')
    expect(profile).toMatchObject({ contextWindow: 65_536, source: 'provider-metadata' })
  })

  it('catalog matches known families', async () => {
    const manager = new ContextManager({ runtime, activity: fakeActivity().repo })
    const qwen = await manager.profileFor('Qwen3.6-35B-A3B-4bit')
    expect(qwen).toMatchObject({ contextWindow: 262_144, source: 'catalog' })
    const claude = await manager.profileFor('claude-sonnet-5')
    expect(claude.contextWindow).toBe(200_000)
  })

  it('unknown models get the conservative fallback', async () => {
    const manager = new ContextManager({
      runtime,
      activity: fakeActivity().repo,
      fetchProviderMetadata: async () => {
        throw new Error('metadata unavailable')
      },
    })
    const profile = await manager.profileFor('mystery-9b')
    expect(profile.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW)
    expect(profile.source).toBe('fallback')
  })
})

describe('usage, compaction, model switching', () => {
  it('estimates active tokens from runtime usage and reports reserve', async () => {
    const runtime = new UsageRuntime()
    const manager = new ContextManager({ runtime, activity: fakeActivity().repo })
    const usage = await manager.usageFor('ses_1', 'qwen-test')
    expect(usage.estimatedActiveTokens).toBe(42_000)
    expect(usage.safetyReserve).toBe(8_192)
    expect(usage.profile.model).toBe('qwen-test')
  })

  it('compact calls native summarize and audits the event', async () => {
    const runtime = new UsageRuntime()
    const { repo, events } = fakeActivity()
    const manager = new ContextManager({ runtime, activity: repo })
    await manager.compact('ses_1')
    expect(runtime.summarizeCalls).toBe(1)
    expect(events.some((event) => event.type === 'context.compacted')).toBe(true)
  })

  it('model switch to a smaller window forces compaction first', async () => {
    const runtime = new UsageRuntime()
    const manager = new ContextManager({
      runtime,
      activity: fakeActivity().repo,
      explicitOverrides: {
        big: { contextWindow: 1_000_000 },
        small: { contextWindow: 16_384 },
      },
    })

    // Current usage 42k fits the big model: no compaction.
    const safe = await manager.assertModelSwitchSafe('ses_1', 'big', 'big')
    expect(safe.compacted).toBe(false)

    // 42k + reserve > 16k: compaction is mandatory before the switch.
    const forced = await manager.assertModelSwitchSafe('ses_1', 'big', 'small')
    expect(forced.compacted).toBe(true)
    expect(runtime.summarizeCalls).toBe(1)
    expect(forced.profile.model).toBe('small')
  })
})

describe('profiles are value objects', () => {
  it('exposes the resolved profile shape', () => {
    const profile: ModelContextProfile = {
      model: 'm',
      contextWindow: 1,
      autoCompact: true,
      source: 'catalog',
    }
    expect(profile.autoCompact).toBe(true)
  })
})
