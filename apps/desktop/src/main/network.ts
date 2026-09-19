import type { ActivityRepository, SettingsRepository, SqliteDb, SqlRow } from '@studio/persistence'
import type {
  NetworkCategory,
  NetworkEvent,
  NetworkPolicySettings,
  NetworkProfileName,
} from '@studio/shared'
import { DEFAULT_NETWORK_POLICY } from '@studio/shared'

const POLICY_KEY = 'network/policy'

function toEvent(row: SqlRow): NetworkEvent {
  return {
    id: String(row.id),
    projectId:
      row.project_id === null || row.project_id === undefined ? undefined : String(row.project_id),
    destination: String(row.destination),
    method: String(row.method),
    bytes: row.bytes === null || row.bytes === undefined ? undefined : Number(row.bytes),
    allowed: Number(row.allowed) === 1,
    category: String(row.category) as NetworkCategory,
    createdAt: String(row.created_at),
  }
}

export class NetworkEventRepository {
  constructor(private readonly db: SqliteDb) {}

  insert(event: NetworkEvent): void {
    this.db.run(
      'INSERT INTO network_events (id, project_id, destination, method, bytes, allowed, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      event.id,
      event.projectId ?? null,
      event.destination,
      event.method,
      event.bytes ?? null,
      event.allowed ? 1 : 0,
      event.category,
      event.createdAt,
    )
  }

  list(limit = 200): NetworkEvent[] {
    return this.db
      .all('SELECT * FROM network_events ORDER BY created_at DESC, rowid DESC LIMIT ?', limit)
      .map(toEvent)
  }
}

export function categorize(destination: string): NetworkCategory {
  const host =
    destination
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      ?.split(':')[0] ?? ''
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '0.0.0.0') {
    return 'localhost'
  }
  if (/git|github|gitlab|bitbucket/.test(host)) return 'git'
  if (/npm|registry|pypi|nuget|maven|crates/.test(host)) return 'registry'
  if (/llm|openai|anthropic|openrouter|model|jev|omlx|litellm|ai-?gateway/.test(host)) return 'llm'
  return 'unknown'
}

type Decision = { allowed: boolean; reason: string }

const PROFILES: Record<
  Exclude<NetworkProfileName, 'custom'>,
  (category: NetworkCategory) => Decision | null
> = {
  safe: (category) =>
    category === 'llm' || category === 'localhost'
      ? null
      : { allowed: false, reason: `Safe profile blocks ${category} destinations` },
  developer: (category) =>
    category === 'unknown'
      ? { allowed: true, reason: 'Developer profile allows with a warning; recorded' }
      : null,
  autonomous: () => null,
}

/**
 * Egress policy + activity recorder (P4.1–4.2).
 *
 * Scope is stated honestly: this governs the HTTP traffic AGENT STUDIO
 * itself initiates (provider tests, Jev calls). It does not intercept
 * OpenCode's own spawned processes — enforcement for those needs the
 * worker-proxy architecture from the advanced-isolation ticket.
 */
export class NetworkPolicyManager {
  private policy: NetworkPolicySettings

  constructor(
    private readonly deps: {
      db: SqliteDb
      settings: SettingsRepository
      activity: ActivityRepository
      events: NetworkEventRepository
      now?: () => Date
      newId?: () => string
      fetchImpl?: typeof fetch
    },
  ) {
    this.policy = {
      ...DEFAULT_NETWORK_POLICY,
      ...deps.settings.getJson<Partial<NetworkPolicySettings>>(POLICY_KEY, {}),
    }
  }

  getPolicy(): NetworkPolicySettings {
    return { ...this.policy, customAllowlist: [...this.policy.customAllowlist] }
  }

  setPolicy(patch: Partial<NetworkPolicySettings>): NetworkPolicySettings {
    this.policy = { ...this.policy, ...patch }
    this.deps.settings.setJson(POLICY_KEY, this.policy)
    this.deps.activity.record('network.policy', `Profile → ${this.policy.profile}`, {
      payload: { profile: this.policy.profile },
    })
    return this.getPolicy()
  }

  private evaluate(destination: string): Decision {
    const category = categorize(destination)
    if (category === 'localhost') return { allowed: true, reason: 'localhost is always allowed' }

    if (this.policy.profile === 'custom') {
      const allowed = this.policy.customAllowlist.some((entry) =>
        destination.includes(entry.replace(/^https?:\/\//, '').split('/')[0] ?? ''),
      )
      return allowed
        ? { allowed: true, reason: 'custom allowlist' }
        : { allowed: false, reason: 'custom allowlist does not include the destination' }
    }

    const verdict = PROFILES[this.policy.profile](category)
    if (verdict !== null) return verdict
    return { allowed: true, reason: `${this.policy.profile} profile allows ${category}` }
  }

  /**
   * The instrumented gate: call instead of raw fetch for app-initiated
   * requests. Blocked requests throw BEFORE any traffic is sent; every
   * attempt is recorded either way.
   */
  async fetch(
    url: string,
    init: { method?: string; body?: string; projectId?: string } = {},
  ): Promise<Response> {
    const decision = this.evaluate(url)
    const bytes = init.body === undefined ? undefined : init.body.length
    const event: NetworkEvent = {
      id: this.deps.newId?.() ?? crypto.randomUUID(),
      projectId: init.projectId,
      destination: url,
      method: init.method ?? 'GET',
      bytes,
      allowed: decision.allowed,
      category: categorize(url),
      createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
    }
    this.deps.events.insert(event)

    if (!decision.allowed) {
      this.deps.activity.record('network.blocked', `Blocked egress to ${url}`, {
        projectId: init.projectId,
        payload: { reason: decision.reason, profile: this.policy.profile },
      })
      throw new Error(`Blocked by network policy (${this.policy.profile}): ${decision.reason}`)
    }
    const doFetch = this.deps.fetchImpl ?? fetch
    return doFetch(url, { method: init.method, body: init.body })
  }

  listEvents(limit = 200): NetworkEvent[] {
    return this.deps.events.list(limit)
  }
}
