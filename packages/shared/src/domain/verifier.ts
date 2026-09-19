/** Independent verifier domain (spec §15). */
export type VerifierDecisionValue = 'approve' | 'reject' | 'human_required'

export type VerifierDecision = {
  decision: VerifierDecisionValue
  reasons: string[]
  failedCriteria: string[]
  evidence: string[]
  /** The fresh verifier session; always distinct from the implementer's. */
  verifierSessionId: string
}
