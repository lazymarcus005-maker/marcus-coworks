import { createServer, type Server } from 'node:http'
import { migrate, ProviderRepository, SqliteDb } from '@studio/persistence'
import { InMemorySecretStore } from '@studio/secrets'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderService, secretIdFor, validateProviderDraft } from '../src/main/providers.js'

let server: Server
let baseUrl: string
let requestCount = 0
let lastAuth: string | null = null

beforeAll(async () => {
  server = createServer((req, res) => {
    requestCount += 1
    lastAuth = req.headers.authorization ?? null
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'qwen3.6-35b-a3b' }, { id: 'llama-4-70b' }] }))
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  baseUrl = `http://127.0.0.1:${address.port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeService() {
  const db = SqliteDb.open(':memory:')
  migrate(db)
  const secrets = new InMemorySecretStore()
  const providers = new ProviderService({
    providers: new ProviderRepository(db),
    secrets,
  })
  return { db, secrets, providers }
}

describe('validateProviderDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(() =>
      validateProviderDraft({
        name: 'Local',
        type: 'localhost',
        baseUrl: 'http://127.0.0.1:8000/v1',
      }),
    ).not.toThrow()
  })

  it('rejects an invalid URL', () => {
    expect(() =>
      validateProviderDraft({ name: 'X', type: 'litellm', baseUrl: 'not a url' }),
    ).toThrow(/valid/)
  })

  it('rejects non-local hosts for localhost providers', () => {
    expect(() =>
      validateProviderDraft({ name: 'X', type: 'localhost', baseUrl: 'https://example.com/v1' }),
    ).toThrow(/localhost/)
  })
})

describe('ProviderService', () => {
  it('saves a provider with the API key in the secret store only', async () => {
    const { db, secrets, providers } = makeService()
    const saved = await providers.save(
      { name: 'Company LiteLLM', type: 'litellm', baseUrl: 'https://llm.company.local/v1/' },
      'sk-secret-value',
    )

    expect(saved.baseUrl).toBe('https://llm.company.local/v1') // trailing slash normalized
    expect(saved.apiKeySecretId).toBe(secretIdFor(saved.id))
    // Key lives in the secret store, referenced by id.
    expect(await secrets.get(saved.apiKeySecretId as string)).toBe('sk-secret-value')
    // And the repository row holds only the reference.
    const row = db.get('SELECT * FROM providers WHERE id = ?', saved.id)
    expect(row?.api_key_secret_id).toBe(secretIdFor(saved.id))
    expect(JSON.stringify(row)).not.toContain('sk-secret-value')
    db.close()
  })

  it('updates without clobbering the stored key when none is provided', async () => {
    const { db, secrets, providers } = makeService()
    const saved = await providers.save(
      { name: 'A', type: 'openai-compatible', baseUrl: 'https://a.example/v1' },
      'sk-keep-me',
    )
    const updated = await providers.save({
      id: saved.id,
      name: 'A2',
      type: 'openai-compatible',
      baseUrl: 'https://a2.example/v1',
    })
    expect(updated.name).toBe('A2')
    expect(await secrets.get(updated.apiKeySecretId as string)).toBe('sk-keep-me')
    db.close()
  })

  it('remove deletes the provider and its secret', async () => {
    const { db, secrets, providers } = makeService()
    const saved = await providers.save(
      { name: 'B', type: 'localhost', baseUrl: 'http://127.0.0.1:1234/v1' },
      'sk-x',
    )
    await providers.remove(saved.id)
    expect(providers.list()).toHaveLength(0)
    expect(await secrets.get(saved.apiKeySecretId as string)).toBeNull()
    db.close()
  })

  it('testConnection reports models from a live OpenAI-compatible endpoint', async () => {
    const { db, providers } = makeService()
    const result = await providers.testConnection({ baseUrl })
    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['qwen3.6-35b-a3b', 'llama-4-70b'])
    expect(requestCount).toBeGreaterThan(0)
    db.close()
  })

  it('testConnection sends the bearer token when provided', async () => {
    const { db, providers } = makeService()
    await providers.testConnection({ baseUrl, apiKey: 'sk-live' })
    expect(lastAuth).toBe('Bearer sk-live')
    db.close()
  })

  it('testConnection fails cleanly on a bad host', async () => {
    const { db, providers } = makeService()
    const result = await providers.testConnection({ baseUrl: 'http://127.0.0.1:1/v1' })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    db.close()
  })

  it('testSaved uses the stored key without exposing it', async () => {
    const { db, providers } = makeService()
    const saved = await providers.save({ name: 'Local', type: 'localhost', baseUrl }, 'sk-stored')
    const result = await providers.testSaved(saved.id)
    expect(result.ok).toBe(true)
    expect(lastAuth).toBe('Bearer sk-stored')
    db.close()
  })
})
