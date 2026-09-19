# Skills

Settings → **Skills**.

Skills are **OpenCode-compatible `SKILL.md` folders** — no proprietary
format. They live where OpenCode already loads them:

- **Global**: `~/.config/opencode/skills/<name>/SKILL.md`
- **Project**: `<project>/.opencode/skills/<name>/SKILL.md`

## Operations

- **Create** — writes a standard frontmatter skeleton
  (`name:`, `description:`) you can edit in place
- **Edit** — opens the SKILL.md content for direct editing
- **Import** — copies a local folder containing a SKILL.md
- **Install from Git** — clones (shallow), then imports every
  SKILL.md folder it finds
- **Enable/Disable** — moves the folder in or out of OpenCode's loader
  path, so a disabled skill is genuinely invisible to the agent while
  the file format stays untouched

## Skill content tips

The frontmatter `description` is what the agent sees when deciding to
load a skill — write it as "use when …". The body should be short,
imperative steps, not prose.
