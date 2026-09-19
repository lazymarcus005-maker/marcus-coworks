import type { ActivityRepository } from '@studio/persistence'
import type { SecretStore } from '@studio/secrets'

/**
 * Secret broker (P4.3): resolves Keychain-backed secrets at the request
 * boundary and remembers every value it has issued so audit records can
 * be scrubbed. The renderer never receives raw values — only references
 * cross the IPC boundary, by construction.
 */
export class SecretBroker {
  private readonly issued = new Map<string, string>()

  constructor(private readonly secrets: SecretStore) {}

  async resolve(secretId: string): Promise<string | null> {
    const value = await this.secrets.get(secretId)
    if (value !== null) {
      this.issued.set(value, secretId)
    }
    return value
  }

  /** Replaces every issued secret value with a REDACTED marker. */
  redact(text: string): string {
    let result = text
    for (const [value, id] of this.issued) {
      if (value !== '' && result.includes(value)) {
        result = result.split(value).join(`[REDACTED:${id}]`)
      }
    }
    return result
  }

  /** Wraps the activity repository so audit rows are scrubbed. */
  redactingActivity(inner: ActivityRepository): ActivityRepository {
    const broker = this
    return new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'record') {
          return (
            type: string,
            message: string,
            options: {
              id?: string
              projectId?: string
              payload?: Record<string, unknown>
              at?: string
            } = {},
          ) => {
            const scrubbedPayload =
              options.payload === undefined
                ? undefined
                : (JSON.parse(broker.redact(JSON.stringify(options.payload))) as Record<
                    string,
                    unknown
                  >)
            return target.record(broker.redact(type), broker.redact(message), {
              ...options,
              payload: scrubbedPayload,
            })
          }
        }
        return Reflect.get(target, property, receiver)
      },
    })
  }
}
