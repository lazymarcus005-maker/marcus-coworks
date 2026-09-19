/** Failure classification domain (spec §19 / §23). */
export type FailureClass =
  | 'ImplementationFailure'
  | 'TestRegression'
  | 'FlakyTest'
  | 'BuildFailure'
  | 'EnvironmentFailure'
  | 'NetworkFailure'
  | 'ProviderFailure'
  | 'ToolFailure'
  | 'PermissionFailure'
  | 'ContextFailure'
  | 'PolicyFailure'
  | 'UnknownFailure'

export type FailureSignal = {
  /** Where the failure surfaced: verification, chat runtime, tool, policy… */
  source: 'verification' | 'runtime' | 'tool' | 'policy' | 'network' | 'environment'
  /** Exit code when the source is a process (verification/tool). */
  exitCode?: number
  /** Command that failed when known. */
  command?: string
  /** Free-form output or error text. */
  output?: string
  /** Error name, e.g. ProviderAuthError, AbortError. */
  errorName?: string
  /** HTTP-ish status when relevant. */
  status?: number
  /** Attempt number of the failing run (for flaky detection across runs). */
  attempt?: number
  /** Whether this exact check passed in an earlier attempt. */
  passedInEarlierAttempt?: boolean
}

export type FailureAssessment = {
  class: FailureClass
  matchedRules: string[]
  /** Recovery the harness should perform BEFORE editing any source. */
  recovery:
    | 'retry-test'
    | 'backoff-provider'
    | 'compact-context'
    | 'human-approval'
    | 'repair-attempt'
    | 'diagnose-environment'
    | 'policy-stop'
    | 'inspect-manually'
}
