import type { ActivityRepository, LockRepository } from '@studio/persistence'
import type { AcquireResult, ScopeLock } from '@studio/shared'
import { scopesOverlap } from './glob.js'

export interface LockManagerDeps {
  locks: LockRepository
  activity: ActivityRepository
  now?: () => Date
  newId?: () => string
}

export const DEFAULT_TTL_MS = 30 * 60 * 1000
export const DEFAULT_WAIT_TIMEOUT_MS = 60 * 1000

/**
 * Lock/collision manager (spec §19): concurrent tasks may not silently
 * mutate overlapping scope. Conflicts queue (waiting), and a waiting lock
 * that exceeds its wait deadline is flagged for escalation — surfaced to
 * the Human Inbox by its own ticket.
 */
export class LockManager {
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: LockManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  /**
   * Acquires the scope for a task, or records a waiting lock when another
   * active lock overlaps. Waiting locks are granted FIFO on release.
   */
  acquire(input: {
    projectId: string
    ownerTaskId: string
    ownerAgentId?: string
    patterns: string[]
    ttlMs?: number
    waitTimeoutMs?: number
  }): AcquireResult {
    this.reconcile(input.projectId)

    const now = this.now()
    const conflict = this.findConflict(input.projectId, input.patterns)

    if (!conflict) {
      const lock: ScopeLock = {
        id: this.newId(),
        projectId: input.projectId,
        ownerTaskId: input.ownerTaskId,
        ownerAgentId: input.ownerAgentId,
        patterns: input.patterns,
        status: 'active',
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
      }
      this.deps.locks.insert(lock)
      this.deps.activity.record('lock.acquired', `Lock acquired: ${input.patterns.join(', ')}`, {
        projectId: input.projectId,
        payload: { lockId: lock.id, taskId: input.ownerTaskId, patterns: input.patterns },
      })
      return { granted: true, lock }
    }

    const waiting: ScopeLock = {
      id: this.newId(),
      projectId: input.projectId,
      ownerTaskId: input.ownerTaskId,
      ownerAgentId: input.ownerAgentId,
      patterns: input.patterns,
      status: 'waiting',
      acquiredAt: now.toISOString(),
      waitDeadline: new Date(
        now.getTime() + (input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
      ).toISOString(),
    }
    this.deps.locks.insert(waiting)
    this.deps.activity.record(
      'lock.waiting',
      `Lock waiting on ${conflict.ownerTaskId}: ${input.patterns.join(', ')}`,
      {
        projectId: input.projectId,
        payload: {
          lockId: waiting.id,
          taskId: input.ownerTaskId,
          heldBy: conflict.ownerTaskId,
          patterns: input.patterns,
        },
      },
    )
    return {
      granted: false,
      lock: waiting,
      conflict: {
        lockId: conflict.id,
        ownerTaskId: conflict.ownerTaskId,
        patterns: conflict.patterns,
      },
    }
  }

  private findConflict(projectId: string, patterns: string[]): ScopeLock | undefined {
    return this.deps.locks
      .listByProject(projectId, 'active')
      .find((lock) => scopesOverlap(lock.patterns, patterns))
  }

  /** Releases a lock and promotes the first waiting lock that now fits. */
  release(lockId: string): void {
    const lock = this.deps.locks.get(lockId)
    if (!lock || lock.status !== 'active') return
    this.deps.locks.setStatus(lockId, 'released', this.now().toISOString())
    this.deps.activity.record('lock.released', `Lock released: ${lock.patterns.join(', ')}`, {
      projectId: lock.projectId,
      payload: { lockId, taskId: lock.ownerTaskId },
    })
    this.promoteNext(lock.projectId)
  }

  private promoteNext(projectId: string): void {
    const waiting = this.deps.locks.listByProject(projectId, 'waiting')
    for (const candidate of waiting) {
      const conflict = this.findConflict(projectId, candidate.patterns)
      if (!conflict) {
        const now = this.now()
        this.deps.locks.promote(
          candidate.id,
          now.toISOString(),
          new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
        )
        this.deps.activity.record(
          'lock.acquired',
          `Waiting lock granted: ${candidate.patterns.join(', ')}`,
          { projectId, payload: { lockId: candidate.id, taskId: candidate.ownerTaskId } },
        )
        return
      }
    }
  }

  /**
   * TTL + wait-deadline sweep: expired active locks become stale (and free
   * the scope); waiting locks past their deadline are flagged escalated.
   */
  reconcile(projectId?: string): ScopeLock[] {
    const changed: ScopeLock[] = []
    const nowIso = this.now().toISOString()

    for (const lock of this.deps.locks.listAll()) {
      if (projectId && lock.projectId !== projectId) continue

      if (lock.status === 'active' && lock.expiresAt && lock.expiresAt < nowIso) {
        this.deps.locks.setStatus(lock.id, 'stale', nowIso)
        this.deps.activity.record('lock.stale', `Lock expired (TTL): ${lock.patterns.join(', ')}`, {
          projectId: lock.projectId,
          payload: { lockId: lock.id, taskId: lock.ownerTaskId },
        })
        changed.push({ ...lock, status: 'stale' })
        this.promoteNext(lock.projectId)
        continue
      }

      if (
        lock.status === 'waiting' &&
        lock.waitDeadline &&
        lock.waitDeadline < nowIso &&
        !lock.escalatedAt
      ) {
        this.deps.locks.setEscalated(lock.id, nowIso)
        this.deps.activity.record(
          'lock.escalated',
          `Lock wait timed out: ${lock.patterns.join(', ')}`,
          {
            projectId: lock.projectId,
            payload: { lockId: lock.id, taskId: lock.ownerTaskId },
          },
        )
        changed.push({ ...lock, escalatedAt: nowIso })
      }
    }
    return changed
  }

  listForProject(projectId: string): ScopeLock[] {
    this.reconcile(projectId)
    return this.deps.locks.listByProject(projectId)
  }

  /** Locks owned by a task in any state. */
  listForTask(taskId: string): ScopeLock[] {
    return this.deps.locks.listByTask(taskId)
  }

  releaseAllForTask(taskId: string): void {
    for (const lock of this.deps.locks.listByTask(taskId)) {
      if (lock.status === 'active') this.release(lock.id)
      if (lock.status === 'waiting') {
        this.deps.locks.setStatus(lock.id, 'released', this.now().toISOString())
      }
    }
  }
}
