import { describe, expect, it } from 'vitest'
import { type CommandResult, InMemorySecretStore, KeychainSecretStore } from '../src/index.js'

function recordingRunner(responses: ((args: string[]) => CommandResult) | CommandResult) {
  const calls: string[][] = []
  const run = (args: string[]) => {
    calls.push(args)
    return Promise.resolve(typeof responses === 'function' ? responses(args) : responses)
  }
  return { calls, run }
}

describe('KeychainSecretStore', () => {
  it('writes items with the app service, account id, value, and -U', async () => {
    const { calls, run } = recordingRunner({ code: 0, stdout: '', stderr: '' })
    const store = new KeychainSecretStore('com.studio.test', run)
    await store.set('secret://provider-a', 'sk-test')

    const args = calls[0] ?? []
    expect(args[0]).toBe('add-generic-password')
    expect(args.join(' ')).toContain('-s com.studio.test')
    expect(args.join(' ')).toContain('-a secret://provider-a')
    expect(args.join(' ')).toContain('-w sk-test')
    expect(args).toContain('-U')
  })

  it('reads items and trims the value', async () => {
    const { run } = recordingRunner({ code: 0, stdout: 'sk-value\n', stderr: '' })
    const store = new KeychainSecretStore('com.studio.test', run)
    expect(await store.get('secret://provider-a')).toBe('sk-value')
  })

  it('returns null when the item does not exist (exit 44)', async () => {
    const { run } = recordingRunner({ code: 44, stdout: '', stderr: 'not found' })
    const store = new KeychainSecretStore('com.studio.test', run)
    expect(await store.get('missing')).toBeNull()
  })

  it('delete is idempotent for missing items', async () => {
    const { run } = recordingRunner({ code: 44, stdout: '', stderr: '' })
    const store = new KeychainSecretStore('com.studio.test', run)
    await expect(store.delete('missing')).resolves.toBeUndefined()
  })

  it('rejects multi-line values defensively', async () => {
    const { run } = recordingRunner({ code: 0, stdout: '', stderr: '' })
    const store = new KeychainSecretStore('com.studio.test', run)
    await expect(store.set('x', 'a\nb')).rejects.toThrow(/newlines/)
  })

  it('surfaces write failures', async () => {
    const { run } = recordingRunner({ code: 45, stdout: '', stderr: 'boom' })
    const store = new KeychainSecretStore('com.studio.test', run)
    await expect(store.set('x', 'v')).rejects.toThrow(/Keychain write failed/)
  })
})

describe('InMemorySecretStore', () => {
  it('round-trips and deletes', async () => {
    const store = new InMemorySecretStore()
    await store.set('a', '1')
    expect(await store.get('a')).toBe('1')
    await store.delete('a')
    expect(await store.get('a')).toBeNull()
  })
})
