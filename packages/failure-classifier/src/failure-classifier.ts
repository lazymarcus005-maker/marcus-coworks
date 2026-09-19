import type { FailureAssessment, FailureClass, FailureSignal } from '@studio/shared'

type Rule = {
  name: string
  applies: (signal: FailureSignal) => boolean
  classification: FailureClass
  recovery: FailureAssessment['recovery']
}

/**
 * Rule-first classification (spec §23): deterministic rules decide; there
 * is no model in this path. Rules are ordered — the first match wins —
 * with hard safety classes (policy, permission) before soft ones.
 */
const RULES: Rule[] = [
  {
    name: 'policy-deny',
    applies: (s) => s.source === 'policy' || /policy (deny|denied)/i.test(s.output ?? ''),
    classification: 'PolicyFailure',
    recovery: 'policy-stop',
  },
  {
    name: 'permission-denied',
    applies: (s) =>
      s.errorName === 'PermissionFailure' ||
      /EACCES|EPERM|permission denied/i.test(s.output ?? '') ||
      (s.exitCode !== undefined && s.exitCode === 126) ||
      s.status === 401 ||
      s.status === 403,
    classification: 'PermissionFailure',
    recovery: 'human-approval',
  },
  {
    name: 'provider-auth-or-overload',
    applies: (s) =>
      s.source === 'runtime' &&
      (s.errorName === 'ProviderAuthError' ||
        s.errorName === 'APIError' ||
        s.status === 429 ||
        s.status === 502 ||
        s.status === 503 ||
        /rate limit|provider unavailable|timeout (waiting )?for (model|provider)/i.test(
          s.output ?? '',
        )),
    classification: 'ProviderFailure',
    recovery: 'backoff-provider',
  },
  {
    name: 'network-unreachable',
    applies: (s) =>
      s.source === 'network' ||
      s.errorName === 'AbortError' ||
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(s.output ?? ''),
    classification: 'NetworkFailure',
    recovery: 'backoff-provider',
  },
  {
    name: 'context-overflow',
    applies: (s) =>
      s.errorName === 'ContextOverflowError' ||
      /context (length|window) exceeded|too many tokens|maximum context/i.test(s.output ?? ''),
    classification: 'ContextFailure',
    recovery: 'compact-context',
  },
  {
    name: 'tool-missing-or-crashed',
    applies: (s) =>
      s.source === 'tool' &&
      (s.errorName === 'ToolFailure' ||
        /command not found|ENOENT at runtime|tool (crashed|failed)/i.test(s.output ?? '')),
    classification: 'ToolFailure',
    recovery: 'diagnose-environment',
  },
  {
    name: 'flaky-test',
    applies: (s) =>
      s.source === 'verification' &&
      (s.passedInEarlierAttempt === true ||
        /flaky|timed out.*test|test timeout/i.test(s.output ?? '')),
    classification: 'FlakyTest',
    recovery: 'retry-test',
  },
  {
    name: 'test-regression',
    applies: (s) =>
      s.source === 'verification' &&
      ((s.exitCode !== undefined &&
        s.exitCode !== 0 &&
        /\d+ (failed|failing)/i.test(s.output ?? '')) ||
        /FAILED|AssertionError|Expected .* to /i.test(s.output ?? '')),
    classification: 'TestRegression',
    recovery: 'repair-attempt',
  },
  {
    name: 'build-break',
    applies: (s) =>
      (s.command ?? '').match(/build|compile|tsc|webpack|vite build/i) !== null ||
      /error TS\d+|CompilationError|cannot find module.*import|linker error/i.test(s.output ?? ''),
    classification: 'BuildFailure',
    recovery: 'repair-attempt',
  },
  {
    name: 'environment-broken',
    applies: (s) =>
      s.source === 'environment' ||
      /ENOSPC|disk (full|quota)|out of memory|NODE_MODULE_VERSION|missing dependency/i.test(
        s.output ?? '',
      ),
    classification: 'EnvironmentFailure',
    recovery: 'diagnose-environment',
  },
]

/**
 * Classifies a failure signal. Rule-first: the matched rule set is
 * reported so decisions stay auditable. Falls back to an
 * ImplementationFailure suggestion for verification-source failures and
 * UnknownFailure otherwise — never silently optimistic.
 */
export function classifyFailure(signal: FailureSignal): FailureAssessment {
  for (const rule of RULES) {
    if (rule.applies(signal)) {
      return {
        class: rule.classification,
        matchedRules: [rule.name],
        recovery: rule.recovery,
      }
    }
  }

  if (signal.source === 'verification') {
    return {
      class: 'ImplementationFailure',
      matchedRules: ['verification-default'],
      recovery: 'repair-attempt',
    }
  }

  return {
    class: 'UnknownFailure',
    matchedRules: [],
    recovery: 'inspect-manually',
  }
}

/** Routes a classified failure to its spec §23 recovery behavior. */
export function recoveryAction(assessment: FailureAssessment): string {
  switch (assessment.recovery) {
    case 'retry-test':
      return 'Re-run the failing test according to policy; do NOT edit source.'
    case 'backoff-provider':
      return 'Apply provider backoff/fallback; do NOT edit source.'
    case 'compact-context':
      return 'Compact/rebuild context before the next request.'
    case 'human-approval':
      return 'Route to the Human Inbox for approval.'
    case 'repair-attempt':
      return 'Start a repair attempt within the attempt cap.'
    case 'diagnose-environment':
      return 'Diagnose the environment before any source modification.'
    case 'policy-stop':
      return 'Stop: policy DENY is absolute.'
    case 'inspect-manually':
      return 'Escalate for manual inspection.'
  }
}
