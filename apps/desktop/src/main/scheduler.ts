import type { ActivityRepository, SettingsRepository } from '@studio/persistence'

import type { SchedulerSnapshot } from '@studio/shared'

export type { SchedulerSnapshot }

export type ResourceName = 'remote-llm' | 'local-llm' | 'shell'

export type SchedulerLimits = Record<ResourceName, number>

export const DEFAULT_LIMITS: SchedulerLimits = {
  'remote-llm': 4,
  'local-llm': 1,
  shell: 4,
}

export interface SchedulerDeps {
  settings: SettingsRepository
  activity: ActivityRepository
  now?: () => Date
  newId?: () => string
}

const LIMITS_KEY = 'scheduler/limits'

type Waiter = {
  ticketId: string
  resource: ResourceName
  priority: number
  label?: string
  queuedAt: string
  resolve: () => void
  reject: (cause: Error) => void
}

/**
 * Resource scheduler (P3.5): named concurrency pools for remote LLM
 * requests, local LLM requests, and shell jobs, with a priority queue,
 * cancellation, and persisted limits. A local LLM at concurrency 1
 * serializes its requests while other projects keep working.
 */
export class SchedulerService {
  private limits: SchedulerLimits
  private running: Record<ResourceName, number> = { 'remote-llm': 0, 'local-llm': 0, shell: 0 }
  private queue: Waiter[] = []
  private held = new Map<string, ResourceName>()

  constructor(private readonly deps: SchedulerDeps) {
    this.limits = {
      ...DEFAULT_LIMITS,
      ...deps.settings.getJson<Partial<SchedulerLimits>>(LIMITS_KEY, {}),
    }
  }

  setLimit(resource: ResourceName, limit: number): void {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Scheduler limit must be a positive integer')
    }
    this.limits = { ...this.limits, [resource]: limit }
    this.deps.settings.setJson(LIMITS_KEY, this.limits)
    this.deps.activity.record('scheduler.limit', `${resource} concurrency set to ${limit}`)
    this.drain()
  }

  getLimits(): SchedulerLimits {
    return { ...this.limits }
  }

  /** Acquires a slot, waiting in the priority queue when saturated. */
  async acquire(
    resource: ResourceName,
    options: { priority?: number; label?: string } = {},
  ): Promise<string> {
    if (this.running[resource] < this.limits[resource]) {
      this.running[resource] += 1
      const ticketId = this.deps.newId?.() ?? crypto.randomUUID()
      this.held.set(ticketId, resource)
      this.deps.activity.record('scheduler.acquired', `${resource} slot acquired`, {
        payload: { ticketId, resource },
      })
      return ticketId
    }

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        ticketId: this.deps.newId?.() ?? crypto.randomUUID(),
        resource,
        priority: options.priority ?? 0,
        label: options.label,
        queuedAt: (this.deps.now?.() ?? new Date()).toISOString(),
        resolve: () => {
          this.held.set(waiter.ticketId, waiter.resource)
          resolve(waiter.ticketId)
        },
        reject,
      }
      this.queue.push(waiter)
      // Priority desc, then FIFO by arrival.
      this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt.localeCompare(b.queuedAt))
    })
  }

  release(ticketId: string): void {
    const resource = this.held.get(ticketId)
    if (resource === undefined) return
    this.held.delete(ticketId)
    this.running[resource] = Math.max(0, this.running[resource] - 1)
    this.drain()
  }

  cancel(ticketId: string): void {
    const index = this.queue.findIndex((waiter) => waiter.ticketId === ticketId)
    const waiter = index >= 0 ? this.queue.splice(index, 1)[0] : undefined
    if (waiter) {
      waiter.reject(new Error('cancelled while waiting for a slot'))
    }
  }

  private drain(): void {
    let progressed = true
    while (progressed) {
      progressed = false
      const index = this.queue.findIndex(
        (waiter) => this.running[waiter.resource] < this.limits[waiter.resource],
      )
      const waiter = index >= 0 ? this.queue.splice(index, 1)[0] : undefined
      if (waiter) {
        this.running[waiter.resource] += 1
        this.held.set(waiter.ticketId, waiter.resource)
        waiter.resolve()
        progressed = true
      }
    }
  }

  snapshot(): SchedulerSnapshot {
    return {
      limits: { ...this.limits },
      running: { ...this.running },
      queue: this.queue.map((waiter) => ({
        ticketId: waiter.ticketId,
        resource: waiter.resource,
        priority: waiter.priority,
        label: waiter.label,
        queuedAt: waiter.queuedAt,
      })),
    }
  }
}
