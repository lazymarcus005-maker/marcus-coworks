import type { ActivityRepository, SettingsRepository } from '@studio/persistence'
import type { SecretStore } from '@studio/secrets'
import type {
  DecisionResult,
  JevConnectionStatus,
  JevSettings,
  ModelRouteDecision,
} from '@studio/shared'
import { DEFAULT_JEV_SETTINGS } from '@studio/shared'

export interface DecisionEngine {
  /** Advisory model-route decision for a request. */
  suggestModelRoute(input: {
    text: string
    autonomy?: string
  }): Promise<DecisionResult<ModelRouteDecision>>
}

export interface DecisionManagerDeps {
  settings: SettingsRepository
  secrets: SecretStore
  activity: ActivityRepository
  fetchImpl?: typeof fetch
  now?: () => Date
}

const JEV_KEY = 'decision/jev'

/** Deterministic advisory rules — always available, never calls out. */
export class RuleBasedEngine implements DecisionEngine {
  async suggestModelRoute(input: { text: string }): Promise<DecisionResult<ModelRouteDecision>> {
    const complex = input.text.length > 500 || /architect|refactor|migrat|design/i.test(input.text)
    return {
      value: { tier: complex ? 'quality' : 'fast' },
      confidence: 0.6,
      provider: 'rule-based',
      explanation: complex ? 'long/structural request' : 'short request',
    }
  }
}

/** Jev via the TypeSafe AI System One API (typed decisions, not chat). */
export class JevEngine implements DecisionEngine {
  constructor(
    private readonly deps: {
      settings: () => JevSettings
      secrets: SecretStore
      fetchImpl: typeof fetch
      minConfidence: number
    },
  ) {}

  async suggestModelRoute(input: { text: string }): Promise<DecisionResult<ModelRouteDecision>> {
    const settings = this.deps.settings()
    if (!settings.enabled || settings.baseUrl === '' || settings.model === '') {
      throw new Error('Jev is not configured')
    }
    const apiKey = settings.apiKeySecretId
      ? ((await this.deps.secrets.get(settings.apiKeySecretId)) ?? undefined)
      : undefined

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await this.deps.fetchImpl(
        `${settings.baseUrl.replace(/\/+$/, '')}/systemone`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey !== undefined ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            state: input.text.slice(0, 4000),
            model: settings.model,
            questions: {
              model_tier: {
                type: 'choice',
                instructions: 'Which model tier should handle this request?',
                criteria: {
                  fast: 'Small fix, single file, low risk',
                  quality: 'Structural work, multiple files, higher risk',
                },
              },
            },
          }),
          signal: controller.signal,
        },
      )
      if (!response.ok) throw new Error(`Jev HTTP ${response.status}`)
      const body = (await response.json()) as {
        answers?: {
          model_tier?: {
            choice?: string
            confidence?: number
          }
        }
      }
      const answer = body.answers?.model_tier
      const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
      if (answer?.choice !== 'fast' && answer?.choice !== 'quality') {
        throw new Error('Jev returned an unusable tier')
      }
      if (confidence < this.deps.minConfidence) {
        throw new Error(`Jev confidence ${confidence} below threshold ${this.deps.minConfidence}`)
      }
      return {
        value: { tier: answer.choice },
        confidence,
        provider: 'jev',
        explanation: `System One choice, confidence ${confidence}`,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * Decision manager (spec §34–35 / P3.7–3.8): Disabled by default. When
 * Jev is enabled, it advises; on ANY failure the rule-based engine
 * answers instead so the normal workflow continues. Hard limits (policy,
 * caps, budgets, approvals) are enforced elsewhere and never consult the
 * engine.
 */
export class DecisionManager {
  private readonly ruleBased = new RuleBasedEngine()
  private readonly fetchImpl: typeof fetch

  constructor(private readonly deps: DecisionManagerDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  jevSettings(): JevSettings {
    return {
      ...DEFAULT_JEV_SETTINGS,
      ...this.deps.settings.getJson<Partial<JevSettings>>(JEV_KEY, {}),
    }
  }

  saveJevSettings(patch: Partial<JevSettings>): JevSettings {
    const next = { ...this.jevSettings(), ...patch }
    this.deps.settings.setJson(JEV_KEY, next)
    return next
  }

  /** Stores the Jev API key in Keychain and links the reference. */
  async setJevApiKey(key: string): Promise<JevSettings> {
    const secretId = 'secret://jev'
    await this.deps.secrets.set(secretId, key)
    return this.saveJevSettings({ apiKeySecretId: secretId })
  }

  /** Effective engine: Jev when enabled, else rule-based. */
  private engine(): DecisionEngine {
    const jev = this.jevSettings()
    if (jev.enabled) {
      return new JevEngine({
        settings: () => this.jevSettings(),
        secrets: this.deps.secrets,
        fetchImpl: this.fetchImpl,
        minConfidence: jev.minConfidence,
      })
    }
    return this.ruleBased
  }

  /** Advises with graceful fallback; `provider` names who answered. */
  async suggestModelRoute(input: { text: string }): Promise<DecisionResult<ModelRouteDecision>> {
    try {
      const result = await this.engine().suggestModelRoute(input)
      this.deps.activity.record('decision.advised', `Model route: ${result.value.tier}`, {
        payload: { provider: result.provider, confidence: result.confidence },
      })
      return result
    } catch (cause) {
      const fallback = await this.ruleBased.suggestModelRoute(input)
      this.deps.activity.record(
        'decision.fallback',
        `Jev unavailable (${cause instanceof Error ? cause.message : String(cause)}); rule-based advised`,
        { payload: { tier: fallback.value.tier } },
      )
      return fallback
    }
  }

  /** Connectivity test against the configured Jev endpoint. */
  async testJevConnection(): Promise<JevConnectionStatus> {
    const jev = this.jevSettings()
    if (jev.baseUrl === '') return { ok: false, detail: 'Base URL not configured' }
    const apiKey = jev.apiKeySecretId
      ? ((await this.deps.secrets.get(jev.apiKeySecretId)) ?? undefined)
      : undefined
    try {
      const response = await this.fetchImpl(`${jev.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: apiKey !== undefined ? { Authorization: `Bearer ${apiKey}` } : {},
      })
      return response.ok
        ? { ok: true, detail: 'connected' }
        : { ok: false, detail: `HTTP ${response.status}` }
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}
