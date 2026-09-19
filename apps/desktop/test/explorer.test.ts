import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ExplorerError, listDirectory } from '../src/main/explorer.js'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'studio-explorer-'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'src', 'auth'))
  writeFileSync(join(root, 'README.md'), '# test\n')
  writeFileSync(join(root, 'src', 'auth', 'login.ts'), 'export {}\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listDirectory', () => {
  it('lists the project root with directories first', () => {
    const entries = listDirectory(root)
    expect(entries.map((entry) => entry.name)).toEqual(['src', 'README.md'])
    expect(entries[0]?.kind).toBe('dir')
    expect(entries[1]).toMatchObject({ kind: 'file', size: 7 })
  })

  it('lists subdirectories via relative path', () => {
    const entries = listDirectory(root, 'src')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'auth', kind: 'dir', path: 'src/auth' })
  })

  it('rejects paths that escape the project root', () => {
    expect(() => listDirectory(root, '..')).toThrow(ExplorerError)
    expect(() => listDirectory(root, '../../etc')).toThrow(/escapes/)
  })

  it('produces relative paths that stay inside the root', () => {
    const nested = listDirectory(root, 'src/auth')
    const child = nested.find((entry) => entry.name === 'login.ts')
    expect(child?.path).toBe('src/auth/login.ts')
    // The relative path resolves inside the root when listed again.
    expect(() => listDirectory(root, 'src/auth')).not.toThrow()
  })
})
