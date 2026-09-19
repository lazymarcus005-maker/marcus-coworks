/** Deterministic verification domain (spec §16 / P2.7). */
export type EvidenceKind = 'format' | 'lint' | 'build' | 'test' | 'custom'

export type VerificationCommand = {
  kind: EvidenceKind
  /** Shell command run inside the project/worktree. */
  command: string
  /** When true, a failure blocks task completion (spec §16). */
  required: boolean
}

export type VerificationEvidence = {
  id: string
  projectId: string
  taskId?: string
  worktreeId?: string
  attempt?: number
  kind: EvidenceKind
  command: string
  exitCode: number
  /** Parsed pass/fail counts where the output allowed it. */
  passed?: number
  failed?: number
  durationMs: number
  /** First meaningful lines of the output. */
  summary: string
  /** Reference to the full output file (kept outside chat). */
  outputPath?: string
  startedAt: string
  finishedAt: string
}

export type VerificationRun = {
  allRequiredPassed: boolean
  evidence: VerificationEvidence[]
}

export type ProjectVerificationConfig = {
  commands: VerificationCommand[]
}
