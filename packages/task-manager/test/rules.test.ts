import { describe, expect, it } from 'vitest'
import { canTransition, isSubstantialRequest } from '../src/task-manager.js'

describe('canTransition (v1 rules)', () => {
  it('allows forward progress from pending', () => {
    expect(canTransition('pending', 'in_progress')).toBe(true)
    expect(canTransition('pending', 'blocked')).toBe(true)
    expect(canTransition('pending', 'done')).toBe(true)
    expect(canTransition('pending', 'cancelled')).toBe(true)
  })

  it('allows recovery from blocked', () => {
    expect(canTransition('blocked', 'pending')).toBe(true)
    expect(canTransition('blocked', 'in_progress')).toBe(true)
    expect(canTransition('blocked', 'cancelled')).toBe(true)
  })

  it('treats done and cancelled as terminal', () => {
    expect(canTransition('done', 'pending')).toBe(false)
    expect(canTransition('done', 'in_progress')).toBe(false)
    expect(canTransition('cancelled', 'pending')).toBe(false)
    expect(canTransition('cancelled', 'in_progress')).toBe(false)
  })
})

describe('isSubstantialRequest', () => {
  it('flags long single-line requests', () => {
    expect(isSubstantialRequest('a'.repeat(100))).toBe(true)
  })

  it('flags multi-line requests of moderate length', () => {
    expect(isSubstantialRequest(`${'a'.repeat(25)}\n${'b'.repeat(25)}`)).toBe(true)
  })

  it('does not flag short quick requests', () => {
    expect(isSubstantialRequest('fix the login timeout')).toBe(false)
    expect(isSubstantialRequest('a'.repeat(30))).toBe(false)
  })
})
