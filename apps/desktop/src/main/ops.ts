import type { ActivityRepository, SettingsRepository, SqliteDb, SqlRow } from '@studio/persistence'

/** Idempotency ledger (spec §24 / P4.7) over the idempotency_keys table. */
export class IdempotencyService {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Executes fn only when the key is new; replays the recorded result for
   * a repeated key so retries never duplicate external effects.
   */
  async once<T>(key: string, fn: () => Promise<T>): Promise<{ first: boolean; result: T }> {
    const existing = this.db.get('SELECT result FROM idempotency_keys WHERE key = ?', key) as
      | SqlRow
      | undefined
    if (existing !== undefined) {
      return { first: false, result: JSON.parse(String(existing.result)) as T }
    }
    const result = await fn()
    this.db.run(
      'INSERT OR IGNORE INTO idempotency_keys (key, result, created_at) VALUES (?, ?, ?)',
      key,
      JSON.stringify(result),
      new Date().toISOString(),
    )
    return { first: true, result }
  }
}

export type NotificationLike = {
  show(): void
}

export type NotifierDeps = {
  settings: SettingsRepository
  activity: ActivityRepository
  /** Electron Notification class; optional so tests run headless. */
  notificationFactory?: {
    isSupported(): boolean
    new (options: { title: string; body: string; silent?: boolean }): NotificationLike
  }
}

/**
 * Notification policy (P4.8): Electron notifications only for meaningful
 * events — inbox escalations, completions, verifier rejections, attempt
 * exhaustion, budget/policy events. Never for internal progress.
 */
export class Notifier {
  private enabled: boolean

  constructor(private readonly deps: NotifierDeps) {
    this.enabled = deps.settings.getJson<boolean>('notifications/enabled', true)
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled
    this.deps.settings.setJson('notifications/enabled', enabled)
    return enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  notify(title: string, body: string): void {
    if (!this.enabled) return
    this.deps.activity.record('notifier.sent', `${title}: ${body}`.slice(0, 200))
    const factory = this.deps.notificationFactory
    if (!factory || !factory.isSupported()) return
    new factory({ title, body: body.slice(0, 200), silent: false }).show()
  }
}
