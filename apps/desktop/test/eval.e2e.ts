import { describe, expect, it } from 'vitest'
import { runEvalSuite } from '../src/main/eval.js'

describe('Evaluation harness (P5.4)', () => {
  it('runs scenarios through the real harness loop with metrics', {
    timeout: 120_000,
  }, async () => {
    const report = await runEvalSuite(['bug-fix', 'ci-repair', 'failure-recovery', 'multi-project'])
    expect(report.scenarios).toHaveLength(4)
    expect(report.summary.passed).toBe(4)
    expect(report.summary.totalAttempts).toBeGreaterThanOrEqual(5) // 1+2+0+2

    const ci = report.scenarios.find((entry) => entry.scenario === 'ci-repair')
    expect(ci?.attempts).toBe(2)
    expect(ci?.success).toBe(true)
    expect(ci?.verifierAcceptance).toBe(true)

    const recovery = report.scenarios.find((entry) => entry.scenario === 'failure-recovery')
    expect(recovery?.success).toBe(true)
    expect(recovery?.humanInterventions).toBe(1)
  })
})
