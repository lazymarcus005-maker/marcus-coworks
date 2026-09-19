import type { ActivityRepository, SettingsRepository } from '@studio/persistence'

export type BudgetLimits = {
  /** Daily token budget per project; 0 disables the limit. */
  dailyTokensPerProject: number
  /** Max concurrently active subagents; 0 disables. */
  maxSubagents: number
  /** Max model calls per project per day; 0 disables. */
  dailyModelCallsPerProject: number
}

export type BudgetUsage = {
  date: string
  tokensByProject: Record<string, number>
  modelCallsByProject: Record<string, number>
}

export type BudgetThresholdAction =
  | 'ok'
  | 'warn'
  | 'stop-subagents'
  | 'downgrade-to-report'
  | 'pause'

export const DEFAULT_BUDGETS: BudgetLimits = {
  dailyTokensPerProject: 0,
  maxSubagents: 0,
  dailyModelCallsPerProject: 0,
}

const BUDGETS_KEY = 'budgets/limits'

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Budget manager (spec §25 / P4.4): usage tracking per project with
 * threshold actions — warn, stop subagents, downgrade to report-only
 * (via autonomy), pause. Caps are set ONLY through the user-facing IPC;
 * no agent or model output reaches this class, so nothing can self-raise
 * a hard cap.
 */
export class BudgetManager {
  private limits: BudgetLimits
  private usage: BudgetUsage

  constructor(
    private readonly deps: {
      settings: SettingsRepository
      activity: ActivityRepository
      now?: () => Date
    },
  ) {
    this.limits = {
      ...DEFAULT_BUDGETS,
      ...deps.settings.getJson<Partial<BudgetLimits>>('budgets/limits', {}),
    }
    const today = todayKey(deps.now?.() ?? new Date())
    this.usage = deps.settings.getJson<BudgetUsage>(`budgets/usage/${today}`, {
      date: today,
      tokensByProject: {},
      modelCallsByProject: {},
    })
  }

  getLimits(): BudgetLimits {
    return { ...this.limits }
  }

  /** User-facing only. */
  setLimits(patch: Partial<BudgetLimits>): BudgetLimits {
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'number' && (value < 0 || !Number.isInteger(value))) {
        throw new Error(`Invalid budget for ${key}`)
      }
    }
    this.limits = { ...this.limits, ...patch }
    this.deps.settings.setJson(BUDGETS_KEY, this.limits)
    this.deps.activity.record('budgets.updated', 'Budget limits updated', {
      payload: { ...this.limits },
    })
    return this.getLimits()
  }

  /** Records usage from runtime-reported token counters. */
  recordUsage(projectId: string, tokens: number): BudgetThresholdAction {
    const today = todayKey(this.deps.now?.() ?? new Date())
    if (this.usage.date !== today) {
      this.usage = { date: today, tokensByProject: {}, modelCallsByProject: {} }
    }
    this.usage.tokensByProject[projectId] = (this.usage.tokensByProject[projectId] ?? 0) + tokens
    this.deps.settings.setJson(`budgets/usage/${today}`, this.usage)

    const limit = this.limits.dailyTokensPerProject
    if (limit > 0) {
      const used = this.usage.tokensByProject[projectId] ?? 0
      if (used > limit) {
        this.deps.activity.record('budgets.exceeded', `Token budget exceeded for ${projectId}`, {
          projectId,
          payload: { used, limit },
        })
        return 'pause'
      }
      if (used > limit * 0.8) {
        return 'warn'
      }
    }
    return 'ok'
  }

  recordModelCall(projectId: string): BudgetThresholdAction {
    const today = todayKey(this.deps.now?.() ?? new Date())
    if (this.usage.date !== today) {
      this.usage = { date: today, tokensByProject: {}, modelCallsByProject: {} }
    }
    this.usage.modelCallsByProject[projectId] = (this.usage.modelCallsByProject[projectId] ?? 0) + 1
    this.deps.settings.setJson(`budgets/usage/${today}`, this.usage)

    const limit = this.limits.dailyModelCallsPerProject
    if (limit > 0 && (this.usage.modelCallsByProject[projectId] ?? 0) > limit) {
      this.deps.activity.record('budgets.exceeded', `Model-call budget exceeded for ${projectId}`, {
        projectId,
        payload: { used: this.usage.modelCallsByProject[projectId], limit },
      })
      return 'downgrade-to-report'
    }
    return 'ok'
  }

  snapshot(): { limits: BudgetLimits; usage: BudgetUsage } {
    return { limits: this.getLimits(), usage: { ...this.usage } }
  }
}
