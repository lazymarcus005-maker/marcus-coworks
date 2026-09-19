import { describe, expect, it } from 'vitest'
import { patternsMayOverlap, scopesOverlap } from '../src/glob.js'

describe('pattern overlap analysis', () => {
  it('detects overlapping directory globs', () => {
    expect(patternsMayOverlap('src/Auth/**', 'src/Auth/login.ts')).toBe(true)
    expect(patternsMayOverlap('src/Auth/**', 'src/Auth/**/*.ts')).toBe(true)
    expect(patternsMayOverlap('src/**', 'src/deep/nested/file.ts')).toBe(true)
  })

  it('keeps disjoint trees separate', () => {
    expect(patternsMayOverlap('src/Auth/**', 'src/Billing/**')).toBe(false)
    expect(patternsMayOverlap('src/**', 'docs/**/*.md')).toBe(false)
  })

  it('matches exact file patterns only with themselves', () => {
    expect(patternsMayOverlap('package.json', 'package.json')).toBe(true)
    expect(patternsMayOverlap('package.json', 'package-lock.json')).toBe(false)
    expect(patternsMayOverlap('package.json', '**/package.json')).toBe(true)
  })

  it('treats logical resources as exact-match scopes', () => {
    expect(patternsMayOverlap('branch:feature/US-001', 'branch:feature/US-001')).toBe(true)
    expect(patternsMayOverlap('branch:feature/US-001', 'branch:feature/US-002')).toBe(false)
    expect(patternsMayOverlap('pr:123', 'src/**')).toBe(false)
  })

  it('wildcard segments stay conservative', () => {
    // *.json vs Makefile: no literal overlap
    expect(patternsMayOverlap('*.json', 'Makefile')).toBe(false)
    // **/secrets/** vs anything under secrets overlaps
    expect(patternsMayOverlap('**/secrets/**', 'config/secrets/prod.yaml')).toBe(true)
  })

  it('scopesOverlap checks any pair across sets', () => {
    expect(scopesOverlap(['src/Auth/**', 'docs/**'], ['README.md', 'src/Auth/api.ts'])).toBe(true)
    expect(scopesOverlap(['src/Auth/**'], ['src/Billing/**', 'README.md'])).toBe(false)
  })
})
