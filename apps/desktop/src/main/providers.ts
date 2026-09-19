import type { ProviderRepository } from '@studio/persistence'
import type { SecretStore } from '@studio/secrets'
import type { ConnectionTestResult, LlmProvider, ProviderType } from '@studio/shared'

export class ProviderServiceError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export type ProviderDraft = {
  id?: string
  name: string
  type: ProviderType
  baseUrl: string
  defaultModel?: string
}

export interface ProviderServiceDeps {
  providers: ProviderRepository
  secrets: SecretStore
  /** Optional broker: issued values get audit-redacted. */
  broker?: { resolve(id: string): Promise<string | null> }
  fetchImpl?: typeof fetch
  now?: () => Date
  newId?: () => string
}

/** Secret reference scheme: secret://<provider-id>. */
export function secretIdFor(providerId: string): string {
  return `secret://provider-${providerId}`
}

export function validateProviderDraft(draft: ProviderDraft): void {
  if (draft.name.trim() === '') throw new ProviderServiceError('Provider name is required')
  if (!['openai-compatible', 'litellm', 'localhost'].includes(draft.type)) {
    throw new ProviderServiceError(`Unknown provider type: ${draft.type}`)
  }
  const url = parseBaseUrl(draft.baseUrl)
  if (!url) throw new ProviderServiceError('Base URL must be a valid http(s) URL')
  if (draft.type === 'localhost' && !isLocalhost(url)) {
    throw new ProviderServiceError('localhost providers must target 127.0.0.1 or localhost')
  }
}

function parseBaseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isLocalhost(url: URL): boolean {
  const host = url.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/**
 * Manages LLM provider configuration. API keys go to the secret store and
 * only their reference is persisted. Connectivity test hits the
 * OpenAI-compatible /models endpoint.
 */
export class ProviderService {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: ProviderServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  list(): LlmProvider[] {
    return this.deps.providers.list()
  }

  /** Creates or updates a provider. When apiKey is provided (non-empty),
   *  it is written to the secret store and referenced by id. */
  async save(draft: ProviderDraft, apiKey?: string): Promise<LlmProvider> {
    validateProviderDraft(draft)
    const at = this.now().toISOString()

    if (draft.id) {
      const existing = this.deps.providers.get(draft.id)
      if (!existing) throw new ProviderServiceError('Provider not found')
      const updated: LlmProvider = {
        ...existing,
        name: draft.name.trim(),
        type: draft.type,
        baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
        defaultModel: draft.defaultModel?.trim() || undefined,
        updatedAt: at,
      }
      if (apiKey !== undefined && apiKey !== '') {
        await this.deps.secrets.set(existing.apiKeySecretId ?? secretIdFor(existing.id), apiKey)
        updated.apiKeySecretId = existing.apiKeySecretId ?? secretIdFor(existing.id)
      }
      this.deps.providers.update(updated)
      return updated
    }

    const provider: LlmProvider = {
      id: this.newId(),
      name: draft.name.trim(),
      type: draft.type,
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      defaultModel: draft.defaultModel?.trim() || undefined,
      createdAt: at,
      updatedAt: at,
    }
    if (apiKey !== undefined && apiKey !== '') {
      const secretId = secretIdFor(provider.id)
      await this.deps.secrets.set(secretId, apiKey)
      provider.apiKeySecretId = secretId
    }
    this.deps.providers.insert(provider)
    return provider
  }

  async remove(id: string): Promise<void> {
    const existing = this.deps.providers.get(id)
    if (!existing) throw new ProviderServiceError('Provider not found')
    if (existing.apiKeySecretId) {
      await this.deps.secrets.delete(existing.apiKeySecretId)
    }
    this.deps.providers.delete(id)
  }

  /** Resolves the API key for a configured provider (main process only). */
  async apiKeyFor(provider: LlmProvider): Promise<string | null> {
    if (!provider.apiKeySecretId) return null
    if (this.deps.broker) return this.deps.broker.resolve(provider.apiKeySecretId)
    return this.deps.secrets.get(provider.apiKeySecretId)
  }

  /** Tests a saved provider using its stored secret; the key never leaves main. */
  async testSaved(id: string): Promise<ConnectionTestResult> {
    const provider = this.deps.providers.get(id)
    if (!provider) return { ok: false, error: 'Provider not found' }
    const apiKey = (await this.apiKeyFor(provider)) ?? undefined
    return this.testConnection({ baseUrl: provider.baseUrl, apiKey })
  }

  async testConnection(input: { baseUrl: string; apiKey?: string }): Promise<ConnectionTestResult> {
    const url = parseBaseUrl(input.baseUrl)
    if (!url) return { ok: false, error: 'Invalid base URL' }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`
      const response = await this.fetchImpl(`${url.toString().replace(/\/+$/, '')}/models`, {
        headers,
        signal: controller.signal,
      })
      if (!response.ok) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` }
      }
      const body = (await response.json()) as { data?: { id?: string }[] }
      const models = (body.data ?? [])
        .map((entry) => entry?.id)
        .filter((id): id is string => typeof id === 'string')
      return { ok: true, status: response.status, models }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        return { ok: false, error: 'Connection timed out (5s)' }
      }
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      clearTimeout(timeout)
    }
  }
}
