/** Machine-readable policy domain (spec §20). */
export type PolicyDecision = 'ALLOW' | 'ASK' | 'DENY'

export type PolicyAction =
  | { kind: 'file-write'; path: string }
  | { kind: 'file-delete'; path: string }
  | { kind: 'git'; operation: 'commit' | 'push' | 'force-push' | 'delete-branch'; branch?: string }
  | { kind: 'shell'; command: string }
  | { kind: 'external-write'; target: string }

export type PolicyCheckOutcome = {
  decision: PolicyDecision
  /** The policy rule that produced the decision. */
  matchedRule?: string
  /** For ASK: approval item reason. For DENY: the wall the agent hit. */
  reason?: string
}

export type PolicyDocument = {
  version: number
  /** Glob patterns; a path hit means the action is blocked outright. */
  protectedPaths: string[]
  /** Glob patterns; a path hit requires human approval first. */
  humanApprovalPaths: string[]
  changeLimits: {
    maxFiles: number
    maxAttempts: number
  }
  git: {
    commit: PolicyDecision
    push: PolicyDecision
    forcePush: PolicyDecision
    deleteBranch: PolicyDecision
  }
  verification: {
    buildRequired: boolean
    testsRequired: boolean
    independentVerifier: boolean
  }
}

export const DEFAULT_POLICY: PolicyDocument = {
  version: 1,
  protectedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/credentials/**'],
  humanApprovalPaths: [
    '**/auth/**',
    '**/payments/**',
    '**/billing/**',
    '**/migrations/**',
    '**/k8s/production/**',
  ],
  changeLimits: { maxFiles: 15, maxAttempts: 3 },
  git: { commit: 'ALLOW', push: 'ASK', forcePush: 'DENY', deleteBranch: 'ASK' },
  verification: { buildRequired: true, testsRequired: true, independentVerifier: true },
}
