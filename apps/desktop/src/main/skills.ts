import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { SkillCreateInput, SkillInfo, SkillScope } from '@studio/shared'

export interface SkillsManagerDeps {
  /** Global OpenCode skills directory. */
  globalSkillsDir: string
  gitClone?: (url: string, target: string) => void
}

const SKILL_FILE = 'SKILL.md'

/** Parses `name:` and `description:` out of SKILL.md YAML frontmatter. */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const frontmatter = match[1] ?? ''
  const field = (key: string): string | undefined => {
    const line = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return line?.[1]?.trim().replace(/^["']|["']$/g, '')
  }
  return { name: field('name'), description: field('description') }
}

/**
 * Skills manager (spec §31 / P3.2): manages the SKILL.md folders OpenCode
 * loads natively — global dir for global scope, .opencode/skills inside
 * the project for project scope. Disabling moves the folder out of the
 * loader path (into .agent-studio/disabled-skills) so OpenCode simply
 * doesn't see it; the format never changes.
 */
export class SkillsManager {
  constructor(private readonly deps: SkillsManagerDeps) {}

  private dirFor(scope: SkillScope, projectPath?: string): string {
    if (scope === 'global') return this.deps.globalSkillsDir
    if (!projectPath) throw new Error('Project scope requires a project path')
    return join(projectPath, '.opencode', 'skills')
  }

  private disabledDirFor(scope: SkillScope, projectPath?: string): string {
    if (scope === 'global')
      return join(this.deps.globalSkillsDir, '..', '.agent-studio', 'disabled-skills')
    return join(projectPath ?? '', '.agent-studio', 'disabled-skills')
  }

  private readSkill(skillDir: string, scope: SkillScope, enabled: boolean): SkillInfo | null {
    const file = join(skillDir, SKILL_FILE)
    if (!existsSync(file)) return null
    const content = readFileSync(file, 'utf-8')
    const meta = parseFrontmatter(content)
    return {
      name: meta.name ?? basename(skillDir),
      scope,
      path: skillDir,
      description: meta.description,
      enabled,
    }
  }

  list(projectPath?: string): SkillInfo[] {
    const skills: SkillInfo[] = []
    const scan = (dir: string, scope: SkillScope, enabled: boolean): void => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skill = this.readSkill(join(dir, entry.name), scope, enabled)
        if (skill) skills.push(skill)
      }
    }
    scan(this.dirFor('global'), 'global', true)
    scan(this.disabledDirFor('global'), 'global', false)
    if (projectPath) {
      scan(this.dirFor('project', projectPath), 'project', true)
      scan(this.disabledDirFor('project', projectPath), 'project', false)
    }
    return skills
  }

  create(input: SkillCreateInput, projectPath?: string): SkillInfo {
    const dir = join(this.dirFor(input.scope, projectPath), input.name)
    if (existsSync(dir)) throw new Error(`Skill already exists: ${input.name}`)
    mkdirSync(dir, { recursive: true })
    const body =
      input.body ?? `Use this skill when: ${input.description}\n\n1. Step one\n2. Step two\n`
    writeFileSync(
      join(dir, SKILL_FILE),
      `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${body}`,
    )
    const info = this.readSkill(dir, input.scope, true)
    if (!info) throw new Error('Skill creation failed')
    return info
  }

  read(name: string, scope: SkillScope, projectPath?: string): string {
    return readFileSync(join(this.dirFor(scope, projectPath), name, SKILL_FILE), 'utf-8')
  }

  write(name: string, scope: SkillScope, content: string, projectPath?: string): void {
    writeFileSync(join(this.dirFor(scope, projectPath), name, SKILL_FILE), content)
  }

  /** Imports a local folder containing a SKILL.md. */
  import(sourceDir: string, scope: SkillScope, projectPath?: string): SkillInfo {
    if (!existsSync(join(sourceDir, SKILL_FILE))) {
      throw new Error(`No ${SKILL_FILE} in ${sourceDir}`)
    }
    const target = join(this.dirFor(scope, projectPath), basename(sourceDir))
    if (existsSync(target)) throw new Error(`Skill already exists: ${basename(sourceDir)}`)
    mkdirSync(this.dirFor(scope, projectPath), { recursive: true })
    cpSync(sourceDir, target, { recursive: true })
    const info = this.readSkill(target, scope, true)
    if (!info) throw new Error('Import failed')
    return info
  }

  /** Clones a Git repository and imports every SKILL.md folder it holds. */
  installFromGit(gitUrl: string, scope: SkillScope, projectPath?: string): SkillInfo[] {
    const temp = join(
      tmpdir(),
      `studio-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    try {
      const clone = this.deps.gitClone ?? defaultGitClone
      clone(gitUrl, temp)
      return this.importAllFrom(temp, scope, projectPath)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }

  private importAllFrom(root: string, scope: SkillScope, projectPath?: string): SkillInfo[] {
    const imported: SkillInfo[] = []
    if (existsSync(join(root, SKILL_FILE))) {
      imported.push(this.import(root, scope, projectPath))
      return imported
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, SKILL_FILE))) {
        try {
          imported.push(this.import(join(root, entry.name), scope, projectPath))
        } catch {
          // Duplicate names across sources are skipped, not fatal.
        }
      }
    }
    return imported
  }

  setEnabled(name: string, scope: SkillScope, enabled: boolean, projectPath?: string): void {
    const from = join(this.dirFor(scope, projectPath), name)
    const to = join(this.disabledDirFor(scope, projectPath), name)
    if (enabled) {
      if (!existsSync(from)) {
        if (existsSync(to)) {
          mkdirSync(this.dirFor(scope, projectPath), { recursive: true })
          renameSync(to, from)
          return
        }
        throw new Error(`Skill not found: ${name}`)
      }
      return
    }
    if (!existsSync(from)) throw new Error(`Skill not found: ${name}`)
    mkdirSync(this.disabledDirFor(scope, projectPath), { recursive: true })
    renameSync(from, to)
  }
}

function defaultGitClone(url: string, target: string): void {
  execFileSync('git', ['clone', '--depth', '1', url, target], { stdio: 'ignore' })
}
