import { InMemorySecretStore } from '@studio/secrets'
import { describe, expect, it } from 'vitest'
import { SecretBroker } from '../src/main/secret-broker.js'

describe('SecretBroker', () => {
  it('resolves values and redacts them from audit text', async () => {
    const store = new InMemorySecretStore()
    await store.set('secret://provider-x', 'sk-super-secret-value')
    const broker = new SecretBroker(store)

    // Issue at the request boundary.
    const value = await broker.resolve('secret://provider-x')
    expect(value).toBe('sk-super-secret-value')

    const scrubbed = broker.redact('auth header was Bearer sk-super-secret-value in payload')
    expect(scrubbed).not.toContain('sk-super-secret-value')
    expect(scrubbed).toContain('[REDACTED:secret://provider-x]')
  })

  it('redacts through the activity wrapper (payload JSON too)', async () => {
    const store = new InMemorySecretStore()
    await store.set('secret://provider-y', 'sk-second-key')
    const broker = new SecretBroker(store)

    const rows: { message: string; payload: unknown }[] = []
    const inner = {
      record(
        type: string,
        message: string,
        options: { payload?: Record<string, unknown>; at?: string } = {},
      ) {
        rows.push({ message, payload: options.payload })
        return { id: 'e', type, message, createdAt: 'now' }
      },
      listForProject: () => [],
      listAll: () => [],
    }
    const wrapped = broker.redactingActivity(inner as never)

    await broker.resolve('secret://provider-y')
    wrapped.record('test.event', 'sent Bearer sk-second-key to provider', {
      payload: { headers: { Authorization: 'Bearer sk-second-key' } },
    })

    expect(JSON.stringify(rows)).not.toContain('sk-second-key')
    expect(JSON.stringify(rows)).toContain('[REDACTED:secret://provider-y]')
  })

  it('redacts multiple distinct secrets', async () => {
    const store = new InMemorySecretStore()
    await store.set('a', 'aaa-111')
    await store.set('b', 'bbb-222')
    const broker = new SecretBroker(store)
    await broker.resolve('a')
    await broker.resolve('b')
    const out = broker.redact('keys: aaa-111 and bbb-222')
    expect(out).not.toContain('aaa-111')
    expect(out).not.toContain('bbb-222')
  })
})
