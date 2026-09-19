import type { FailureSignal } from '@studio/shared'
import { describe, expect, it } from 'vitest'
import { classifyFailure, recoveryAction } from '../src/index.js'

function signal(overrides: Partial<FailureSignal>): FailureSignal {
  return { source: 'verification', ...overrides }
}

describe('classifyFailure (rule-first, spec §23)', () => {
  it('classifies test regressions and routes to repair attempts', () => {
    const result = classifyFailure(
      signal({
        exitCode: 1,
        output: 'Tests: 2 failed, 48 passed\nAssertionError: expected 200 to be 404',
      }),
    )
    expect(result.class).toBe('TestRegression')
    expect(result.recovery).toBe('repair-attempt')
  })

  it('classifies flaky tests: retry the test, never edit source', () => {
    const flaky = classifyFailure(
      signal({ exitCode: 1, output: 'test timeout: db.spec.ts', passedInEarlierAttempt: true }),
    )
    expect(flaky.class).toBe('FlakyTest')
    expect(flaky.recovery).toBe('retry-test')
    expect(recoveryAction(flaky)).toContain('do NOT edit source')
  })

  it('prioritizes flaky (earlier pass) over regression within verification', () => {
    const result = classifyFailure(
      signal({ exitCode: 1, output: '1 failed', passedInEarlierAttempt: true }),
    )
    expect(result.class).toBe('FlakyTest')
  })

  it('classifies build failures by command and compiler output', () => {
    expect(
      classifyFailure(signal({ command: 'npm run build', exitCode: 2, output: '' })).class,
    ).toBe('BuildFailure')
    expect(
      classifyFailure(signal({ exitCode: 2, output: 'error TS2345: not assignable' })).class,
    ).toBe('BuildFailure')
  })

  it('routes provider failures to backoff, not source edits', () => {
    const result = classifyFailure(
      signal({ source: 'runtime', errorName: 'ProviderAuthError', output: '401 from provider' }),
    )
    expect(result.class).toBe('ProviderFailure')
    expect(result.recovery).toBe('backoff-provider')
    expect(recoveryAction(result)).toContain('do NOT edit source')

    expect(
      classifyFailure(signal({ source: 'runtime', status: 429, output: 'rate limited' })).class,
    ).toBe('ProviderFailure')
  })

  it('routes permission failures to human approval', () => {
    const result = classifyFailure(signal({ exitCode: 126, output: 'permission denied' }))
    expect(result.class).toBe('PermissionFailure')
    expect(result.recovery).toBe('human-approval')
  })

  it('routes context overflow to compaction', () => {
    const result = classifyFailure(
      signal({
        source: 'runtime',
        errorName: 'ContextOverflowError',
        output: 'context length exceeded',
      }),
    )
    expect(result.class).toBe('ContextFailure')
    expect(result.recovery).toBe('compact-context')
  })

  it('treats policy DENY as an absolute stop', () => {
    const result = classifyFailure(signal({ source: 'policy', output: 'policy DENY on chat send' }))
    expect(result.class).toBe('PolicyFailure')
    expect(result.recovery).toBe('policy-stop')
    expect(recoveryAction(result)).toContain('absolute')
  })

  it('routes environment failures to diagnosis before source edits', () => {
    const result = classifyFailure(
      signal({ source: 'environment', output: 'ENOSPC: no space left on device' }),
    )
    expect(result.class).toBe('EnvironmentFailure')
    expect(result.recovery).toBe('diagnose-environment')
  })

  it('routes network errors to backoff', () => {
    const result = classifyFailure(
      signal({ source: 'network', output: 'getaddrinfo ENOTFOUND llm.local' }),
    )
    expect(result.class).toBe('NetworkFailure')
    expect(result.recovery).toBe('backoff-provider')
  })

  it('verification failures default to ImplementationFailure (repair)', () => {
    const result = classifyFailure(signal({ exitCode: 1, output: 'mysterious failure' }))
    expect(result.class).toBe('ImplementationFailure')
    expect(result.recovery).toBe('repair-attempt')
  })

  it('unknown failures escalate for inspection — never silently optimistic', () => {
    const result = classifyFailure(signal({ source: 'runtime', output: 'something odd' }))
    expect(result.class).toBe('UnknownFailure')
    expect(result.recovery).toBe('inspect-manually')
  })

  it('reports which rule matched for auditability', () => {
    const result = classifyFailure(signal({ exitCode: 1, output: '2 failed' }))
    expect(result.matchedRules).toEqual(['test-regression'])
  })
})
