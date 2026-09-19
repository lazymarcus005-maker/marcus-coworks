import { readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export type FileEntry = {
  name: string
  /** Path relative to the project root, using '/' separators. */
  path: string
  kind: 'dir' | 'file'
  size?: number
}

export class ExplorerError extends Error {}

/**
 * Containment-checked directory listing for the file explorer. The
 * renderer only ever passes project-relative paths; anything that would
 * escape the project root is rejected.
 */
export function listDirectory(projectRoot: string, relative = '.'): FileEntry[] {
  const root = resolve(projectRoot)
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new ExplorerError('Path escapes the project root')
  }

  let dirents
  try {
    dirents = readdirSync(target, { withFileTypes: true })
  } catch (cause) {
    throw new ExplorerError(
      `Cannot read directory: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const prefix = relative === '.' || relative === '' ? '' : `${relative.replace(/\/+$/, '')}/`
  const entries: FileEntry[] = dirents.map((dirent) => {
    const entryPath = `${prefix}${dirent.name}`
    if (dirent.isDirectory()) {
      return { name: dirent.name, path: entryPath, kind: 'dir' as const }
    }
    let size: number | undefined
    try {
      size = statSync(join(target, dirent.name)).size
    } catch {
      size = undefined
    }
    return { name: dirent.name, path: entryPath, kind: 'file' as const, size }
  })

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}
