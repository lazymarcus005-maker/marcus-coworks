import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PolicyAction, PolicyCheckOutcome, PolicyDocument } from '@studio/shared'
import { DEFAULT_POLICY } from '@studio/shared'

export const POLICY_FILENAME = 'agent-studio.policy.json'

/** Segment-wise glob match: `**` spans any depth, `*` matches within a segment. */
export function globMatchesPath(pattern: string, path: string): boolean {
  const normalize = (value: string) => value.replace(/^\.\//, '').replace(/\\/g, '/')
  const patternSegments = normalize(pattern).split('/')
  const pathSegments = normalize(path).split('/')

  let pIndex = 0
  let sIndex = 0
  let starSegment: number | null = null
  let starPath = 0

  while (sIndex < pathSegments.length) {
    if (pIndex < patternSegments.length && patternSegments[pIndex] === '**') {
      starSegment = pIndex
      starPath = sIndex
      pIndex += 1
      continue
    }
    if (
      pIndex < patternSegments.length &&
      segmentMatches(patternSegments[pIndex] ?? '', pathSegments[sIndex] ?? '')
    ) {
      pIndex += 1
      sIndex += 1
      continue
    }
    if (starSegment !== null) {
      pIndex = starSegment + 1
      starPath += 1
      sIndex = starPath
      continue
    }
    return false
  }
  while (pIndex < patternSegments.length && patternSegments[pIndex] === '**') {
    pIndex += 1
  }
  return pIndex === patternSegments.length
}

function segmentMatches(pattern: string, segment: string): boolean {
  if (pattern === '*') return segment !== ''
  const parts = pattern.split('*')
  if (parts.length === 1) return pattern === segment
  let cursor = 0
  for (const [index, part] of parts.entries()) {
    if (part === '') continue
    if (index === 0) {
      if (!segment.startsWith(part)) return false
      cursor = part.length
      continue
    }
    const found = segment.indexOf(part, cursor)
    if (found === -1) return false
    cursor = found + part.length
  }
  if (parts[parts.length - 1] !== '' && !segment.endsWith(parts[parts.length - 1] ?? '')) {
    return false
  }
  return true
}

/**
 * Loads a project's policy file; falls back to the safe default when none
 * exists. Unknown fields are ignored; invalid JSON falls back with a
 * warning channel (the loader never throws for content issues).
 */
export function loadPolicy(projectPath: string): {
  policy: PolicyDocument
  source: 'project' | 'default'
} {
  const policyPath = join(projectPath, POLICY_FILENAME)
  if (!existsSync(policyPath)) {
    return { policy: structuredClone(DEFAULT_POLICY), source: 'default' }
  }
  try {
    const raw = JSON.parse(readFileSync(policyPath, 'utf-8')) as Partial<PolicyDocument>
    return {
      policy: normalizePolicy(raw),
      source: 'project',
    }
  } catch {
    return { policy: structuredClone(DEFAULT_POLICY), source: 'default' }
  }
}

export function normalizePolicy(raw: Partial<PolicyDocument>): PolicyDocument {
  const base = structuredClone(DEFAULT_POLICY)
  return {
    version: typeof raw.version === 'number' ? raw.version : base.version,
    protectedPaths: Array.isArray(raw.protectedPaths)
      ? raw.protectedPaths.map(String)
      : base.protectedPaths,
    humanApprovalPaths: Array.isArray(raw.humanApprovalPaths)
      ? raw.humanApprovalPaths.map(String)
      : base.humanApprovalPaths,
    changeLimits: {
      maxFiles:
        typeof raw.changeLimits?.maxFiles === 'number' && raw.changeLimits.maxFiles > 0
          ? Math.floor(raw.changeLimits.maxFiles)
          : base.changeLimits.maxFiles,
      maxAttempts:
        typeof raw.changeLimits?.maxAttempts === 'number' && raw.changeLimits.maxAttempts > 0
          ? Math.floor(raw.changeLimits.maxAttempts)
          : base.changeLimits.maxAttempts,
    },
    git: { ...base.git, ...(raw.git ?? {}) },
    verification: { ...base.verification, ...(raw.verification ?? {}) },
  }
}

/**
 * The policy gate (spec §20): pure, mechanical evaluation. It never sees
 * an LLM and never will — DENY is absolute regardless of who asks.
 */
export function evaluatePolicy(
  policy: PolicyDocument,
  action: PolicyAction,
  context: { changedFiles?: number; attempts?: number } = {},
): PolicyCheckOutcome {
  // Attempt caps are enforced even before path rules.
  if (action.kind !== 'git' && context.attempts !== undefined) {
    if (context.attempts >= policy.changeLimits.maxAttempts) {
      return {
        decision: 'DENY',
        matchedRule: 'changeLimits.maxAttempts',
        reason: `Attempt cap ${policy.changeLimits.maxAttempts} reached`,
      }
    }
  }

  switch (action.kind) {
    case 'file-write':
    case 'file-delete': {
      for (const pattern of policy.protectedPaths) {
        if (globMatchesPath(pattern, action.path)) {
          return {
            decision: 'DENY',
            matchedRule: pattern,
            reason: `Path is protected: ${action.path}`,
          }
        }
      }
      for (const pattern of policy.humanApprovalPaths) {
        if (globMatchesPath(pattern, action.path)) {
          return {
            decision: 'ASK',
            matchedRule: pattern,
            reason: `Human approval required for ${action.path}`,
          }
        }
      }
      if (
        context.changedFiles !== undefined &&
        context.changedFiles > policy.changeLimits.maxFiles
      ) {
        return {
          decision: 'DENY',
          matchedRule: 'changeLimits.maxFiles',
          reason: `Change limit ${policy.changeLimits.maxFiles} files exceeded`,
        }
      }
      return { decision: 'ALLOW' }
    }
    case 'git': {
      // Wire format is kebab-case; the policy table is camelCase.
      const tableKey = action.operation.replace(/-([a-z])/g, (_m, char: string) =>
        char.toUpperCase(),
      ) as keyof typeof policy.git
      const rule = policy.git[tableKey]
      return {
        decision: rule,
        matchedRule: `git.${tableKey}`,
        reason: rule === 'DENY' ? `git ${action.operation} is denied by policy` : undefined,
      }
    }
    case 'shell': {
      // Best-effort guard: shell commands that reference protected paths
      // via common read/exfil verbs are denied.
      for (const pattern of policy.protectedPaths) {
        const literal = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\/+$/, '')
        if (
          literal !== '' &&
          action.command.includes(literal) &&
          /(cat|curl|scp|rsync|tee|>|cp|mv|rm)/.test(action.command)
        ) {
          return {
            decision: 'DENY',
            matchedRule: pattern,
            reason: 'Shell command touches a protected path',
          }
        }
      }
      return { decision: 'ALLOW' }
    }
    case 'external-write': {
      return {
        decision: 'ASK',
        matchedRule: 'external-write',
        reason: 'External mutation needs approval',
      }
    }
  }
}
