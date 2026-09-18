import { existsSync, type Stats, statSync } from 'node:fs'
import { basename } from 'node:path'

export type PathValidation =
  | { ok: true; name: string; isGitRepo: boolean }
  | { ok: false; reason: string }

/**
 * Validates a folder the user wants to register as a project.
 * A missing path, a file, or an unreadable directory is rejected.
 * Being a Git repository is reported but not required.
 */
export function validateProjectPath(path: string): PathValidation {
  if (path.trim() === '') {
    return { ok: false, reason: 'Path is empty' }
  }

  let stats: Stats | undefined
  try {
    stats = statSync(path)
  } catch {
    return { ok: false, reason: 'Path does not exist or is not accessible' }
  }

  if (!stats.isDirectory()) {
    return { ok: false, reason: 'Path is not a directory' }
  }

  const isGitRepo = existsSync(`${path.replace(/\/+$/, '')}/.git`)

  const name = basename(path) || path
  return { ok: true, name, isGitRepo }
}
