/**
 * LLM provider configuration domain (spec §29).
 * Credentials never appear here — only secret references into Keychain.
 */
export type ProviderType = 'openai-compatible' | 'litellm' | 'localhost'

export type LlmProvider = {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  /** Keychain reference, e.g. secret://provider-<id>. */
  apiKeySecretId?: string
  defaultModel?: string
  createdAt: string
  updatedAt: string
}

export type ConnectionTestResult = {
  ok: boolean
  status?: number
  models?: string[]
  error?: string
}
