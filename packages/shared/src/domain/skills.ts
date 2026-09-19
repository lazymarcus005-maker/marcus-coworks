/**
 * Skills domain (spec §31). SKILL.md files stay OpenCode-compatible;
 * Agent Studio only curates the folders OpenCode already loads.
 */
export type SkillScope = 'global' | 'project'

export type SkillInfo = {
  name: string
  scope: SkillScope
  /** Directory holding the SKILL.md. */
  path: string
  description?: string
  enabled: boolean
}

export type SkillCreateInput = {
  name: string
  scope: SkillScope
  description: string
  body?: string
}
