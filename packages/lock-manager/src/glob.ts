/**
 * Conservative scope-overlap analysis for lock patterns (spec §19).
 *
 * Two patterns may overlap when no segment pair provably differs. This
 * approximation can over-block (safe) but never under-block: agents that
 * might touch the same scope serialize.
 */

const WILDCARD_SEGMENT = new Set(['**', '*'])

function isLogical(pattern: string): boolean {
  return /^(branch|pr|resource):/.test(pattern)
}

function segmentsOf(pattern: string): string[] {
  return pattern.split('/').filter((segment) => segment !== '' && segment !== '.')
}

function segmentCompatible(a: string, b: string): boolean {
  if (WILDCARD_SEGMENT.has(a) || WILDCARD_SEGMENT.has(b)) return true
  const aHasWildcard = a.includes('*')
  const bHasWildcard = b.includes('*')
  if (aHasWildcard || bHasWildcard) {
    // One wildcard segment vs a concrete segment: may overlap unless the
    // concrete side is provably longer (e.g. `*.json` vs `Makefile`).
    return globSegmentCompatible(a, b)
  }
  return a === b
}

function globSegmentCompatible(a: string, b: string): boolean {
  const wildcard = a.includes('*') ? a : b
  const concrete = a.includes('*') ? b : a
  const parts = wildcard.split('*')
  let cursor = 0
  for (const part of parts) {
    if (part === '') continue
    const found = concrete.indexOf(part, cursor)
    if (found === -1) return false
    cursor = found + part.length
  }
  return true
}

/** True when two lock patterns may reference overlapping scope. */
export function patternsMayOverlap(a: string, b: string): boolean {
  if (isLogical(a) || isLogical(b)) {
    // Logical resources only conflict with themselves.
    return a === b
  }

  const aSegments = segmentsOf(a)
  const bSegments = segmentsOf(b)
  const shared = Math.min(aSegments.length, bSegments.length)
  for (let index = 0; index < shared; index += 1) {
    const left = aSegments[index] ?? ''
    const right = bSegments[index] ?? ''
    if (!segmentCompatible(left, right)) return false
  }
  // One pattern is a prefix of the other: a directory pattern covers its
  // descendants, so they overlap — unless both are single-file patterns
  // with no wildcards, which were already compared exactly above.
  return true
}

/** True when any pattern pair across two sets may overlap. */
export function scopesOverlap(a: string[], b: string[]): boolean {
  for (const left of a) {
    for (const right of b) {
      if (patternsMayOverlap(left, right)) return true
    }
  }
  return false
}
