/** Decision engine domain (spec §34–35). Advisory only — hard limits live elsewhere. */
export type DecisionProviderName = 'disabled' | 'rule-based' | 'jev'

export type JevSettings = {
  enabled: boolean
  baseUrl: string
  /** Keychain secret reference; the raw key never lives in settings. */
  apiKeySecretId?: string
  model: string
  minConfidence: number
}

export const DEFAULT_JEV_SETTINGS: JevSettings = {
  enabled: false,
  baseUrl: '',
  model: '',
  minConfidence: 0.8,
}

export type JevConnectionStatus = { ok: boolean; detail: string }

/** Advisory: which model tier to route the next run to. */
export type ModelRouteDecision = { tier: 'fast' | 'quality' }

export type DecisionResult<T> = {
  value: T
  confidence: number
  provider: Exclude<DecisionProviderName, 'disabled'>
  explanation?: string
}
