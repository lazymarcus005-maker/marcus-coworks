/** Scope lock domain (spec §19). */
export type LockStatus = 'active' | 'waiting' | 'released' | 'stale'

export type ScopeLock = {
  id: string
  projectId: string
  ownerTaskId: string
  ownerAgentId?: string
  /** Path globs (src/Auth/**) and logical resources (branch:feature/x, pr:123). */
  patterns: string[]
  status: LockStatus
  acquiredAt: string
  /** TTL: active locks expire and become stale after this instant. */
  expiresAt?: string
  /** Wait deadline for waiting locks; after it the wait escalates. */
  waitDeadline?: string
  /** Set when a waiting lock exceeded its wait deadline. */
  escalatedAt?: string
}

export type AcquireResult =
  | { granted: true; lock: ScopeLock }
  | {
      granted: false
      lock: ScopeLock
      conflict: { lockId: string; ownerTaskId: string; patterns: string[] }
    }
