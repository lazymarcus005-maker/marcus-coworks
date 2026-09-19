import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseFrontmatter, SkillsManager } from '../src/main/skills.js'

let dir: string
let globalSkills: string
let project: string
let manager: SkillsManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-skills-'))
  globalSkills = join(dir, 'global-skills')
  project = join(dir, 'project')
  mkdirSync(project, { recursive: true })
  manager = new SkillsManager({ globalSkillsDir: globalSkills })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseFrontmatter', () => {
  it('reads name and description', () => {
    const meta = parseFrontmatter(
      '---\nname: coding-standard\ndescription: "House style"\n---\n\nbody',
    )
    expect(meta).toEqual({ name: 'coding-standard', description: 'House style' })
  })

  it('returns empty for files without frontmatter', () => {
    expect(parseFrontmatter('just text')).toEqual({})
  })
})

describe('SkillsManager', () => {
  it('creates an OpenCode-compatible SKILL.md in the requested scope', () => {
    const info = manager.create(
      {
        name: 'coding-standard',
        scope: 'global',
        description: 'House style guide',
      },
      project,
    )
    expect(info.enabled).toBe(true)
    expect(info.scope).toBe('global')

    const file = join(globalSkills, 'coding-standard', 'SKILL.md')
    expect(existsSync(file)).toBe(true)
    const content = readFileSync(file, 'utf-8')
    expect(content).toContain('name: coding-standard')
    expect(content).toContain('description: House style guide')
  })

  it('lists skills across scopes with attribution', () => {
    manager.create(
      { name: 'dotnet', scope: 'project', description: 'Project conventions' },
      project,
    )
    const names = manager
      .list(project)
      .map((skill) => `${skill.scope}:${skill.name}`)
      .sort()
    expect(names).toEqual(['global:coding-standard', 'project:dotnet'])
  })

  it('read/write edits the SKILL.md in place', () => {
    const original = manager.read('dotnet', 'project', project)
    expect(original).toContain('dotnet')
    manager.write('dotnet', 'project', `${original}\nExtra section.\n`, project)
    expect(manager.read('dotnet', 'project', project)).toContain('Extra section.')
  })

  it('disabling moves the folder out of the loader path; re-enabling restores it', () => {
    manager.setEnabled('dotnet', 'project', false, project)
    // OpenCode's loader path no longer sees it.
    expect(existsSync(join(project, '.opencode', 'skills', 'dotnet'))).toBe(false)
    const listed = manager.list(project)
    const disabled = listed.find((skill) => skill.name === 'dotnet')
    expect(disabled?.enabled).toBe(false)

    manager.setEnabled('dotnet', 'project', true, project)
    expect(existsSync(join(project, '.opencode', 'skills', 'dotnet', 'SKILL.md'))).toBe(true)
    expect(manager.list(project).find((skill) => skill.name === 'dotnet')?.enabled).toBe(true)
  })

  it('imports a local folder containing a SKILL.md', () => {
    const source = join(dir, 'source-skill')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'SKILL.md'),
      '---\nname: gitlab-flow\ndescription: Flow rules\n---\nbody',
    )
    const info = manager.import(source, 'project', project)
    expect(info.name).toBe('gitlab-flow')
    expect(manager.list(project).some((skill) => skill.name === 'gitlab-flow')).toBe(true)
  })

  it('installs skills from a git repository (multiple SKILL.md folders)', () => {
    // Fake "git clone": build a repo-shaped directory with two skills.
    const clone = (url: string, target: string) => {
      if (url !== 'https://git.example/skills.git') throw new Error('unexpected url')
      for (const name of ['skill-a', 'skill-b']) {
        mkdirSync(join(target, name), { recursive: true })
        writeFileSync(
          join(target, name, 'SKILL.md'),
          `---\nname: ${name}\ndescription: from git\n---\nbody`,
        )
      }
      mkdirSync(join(target, 'not-a-skill'), { recursive: true })
    }
    const gitManager = new SkillsManager({ globalSkillsDir: globalSkills, gitClone: clone })
    const installed = gitManager.installFromGit(
      'https://git.example/skills.git',
      'project',
      project,
    )
    expect(installed.map((skill) => skill.name).sort()).toEqual(['skill-a', 'skill-b'])
    expect(manager.list(project).every((skill) => skill.name !== 'not-a-skill')).toBe(true)
  })

  it('refuses duplicate creation', () => {
    expect(() =>
      manager.create({ name: 'coding-standard', scope: 'global', description: 'dup' }, project),
    ).toThrow(/already exists/)
  })
})
