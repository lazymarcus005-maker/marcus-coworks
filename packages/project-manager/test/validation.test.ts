import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateProjectPath } from '../src/validation.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-validation-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('validateProjectPath', () => {
  it('accepts an existing directory', () => {
    const result = validateProjectPath(dir)
    expect(result.ok).toBe(true)
  })

  it('reports whether the folder is a git repository', () => {
    const gitDir = join(dir, 'repo')
    const plainDir = join(dir, 'plain')
    mkdirSync(join(gitDir, '.git'), { recursive: true })
    mkdirSync(plainDir, { recursive: true })

    expect(validateProjectPath(gitDir)).toMatchObject({ ok: true, isGitRepo: true })
    expect(validateProjectPath(plainDir)).toMatchObject({ ok: true, isGitRepo: false })
  })

  it('rejects a missing path', () => {
    const result = validateProjectPath(join(dir, 'does-not-exist'))
    expect(result.ok).toBe(false)
  })

  it('rejects a file', () => {
    const file = join(dir, 'some-file.txt')
    writeFileSync(file, 'x')
    const result = validateProjectPath(file)
    expect(result.ok).toBe(false)
  })

  it('rejects an empty path', () => {
    const result = validateProjectPath('  ')
    expect(result.ok).toBe(false)
  })
})
