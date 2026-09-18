import { execFile } from 'node:child_process'

export type CommandResult = { code: number; stdout: string; stderr: string }

export type CommandRunner = (args: string[]) => Promise<CommandResult>

/** Exit code returned by `security` when an item does not exist. */
const ITEM_NOT_FOUND = 44

export function securityRunner(): CommandRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile('security', args, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      })
    })
}

export interface SecretStore {
  /** Creates or updates the secret. */
  set(id: string, value: string): Promise<void>
  /** Returns the secret value, or null when it does not exist. */
  get(id: string): Promise<string | null>
  /** Removes the secret; deleting a missing secret is a no-op. */
  delete(id: string): Promise<void>
}

/**
 * macOS Keychain-backed store using the built-in `security` CLI, so no
 * native modules are required. Items are generic passwords scoped to a
 * per-app service name.
 *
 * Credential injection at the request boundary (broker) arrives with the
 * phase-4 hardening ticket; renderer code never sees secret values at any
 * point.
 */
export class KeychainSecretStore implements SecretStore {
  constructor(
    readonly service: string,
    private readonly run: CommandRunner = securityRunner(),
  ) {}

  async set(id: string, value: string): Promise<void> {
    if (value.includes('\n')) {
      throw new Error('Keychain secret values must not contain newlines')
    }
    // -U updates the item when it already exists.
    const result = await this.run([
      'add-generic-password',
      '-s',
      this.service,
      '-a',
      id,
      '-w',
      value,
      '-U',
    ])
    if (result.code !== 0) {
      throw new Error(`Keychain write failed: ${result.stderr.trim()}`)
    }
  }

  async get(id: string): Promise<string | null> {
    const result = await this.run(['find-generic-password', '-s', this.service, '-a', id, '-w'])
    if (result.code === ITEM_NOT_FOUND) return null
    if (result.code !== 0) {
      throw new Error(`Keychain read failed: ${result.stderr.trim()}`)
    }
    return result.stdout.trim()
  }

  async delete(id: string): Promise<void> {
    const result = await this.run(['delete-generic-password', '-s', this.service, '-a', id])
    // Deleting a missing secret is fine (idempotent).
    if (result.code !== 0 && result.code !== ITEM_NOT_FOUND) {
      throw new Error(`Keychain delete failed: ${result.stderr.trim()}`)
    }
  }
}

/** In-memory store for tests and non-macOS development. */
export class InMemorySecretStore implements SecretStore {
  private readonly items = new Map<string, string>()

  async set(id: string, value: string): Promise<void> {
    this.items.set(id, value)
  }

  async get(id: string): Promise<string | null> {
    return this.items.get(id) ?? null
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }
}
