# Agents & subagents

Settings → **Agents**, plus the live **Agents** tree in the project side
panel.

## Agent profiles

Profiles are written to OpenCode's native `agent` config in the project's
`opencode.json` — OpenCode owns subagent execution. Each profile sets:

- **Mode**: `primary`, `subagent`, or `all`
- **Model**: any `provider/model` the runtime supports — subagents can
  run a different (e.g. cheaper) model than the primary
- **Tools**: switch tools on/off per agent (e.g. no `write` for
  reviewers)
- **Prompt / description**

## Delegation tree

The Agents panel shows the live session hierarchy from the runtime
(parent session → subagent children). Built-in harness roles:

| Role | Runs where |
|---|---|
| Implementer | the task's isolated worktree session |
| Verifier | a fresh session created per review (read-only policy enforced) |

## Delegation limits

Enforced by code, not prompts: max delegation depth (4), max active
subagents per project (8), max total subagents (32). Attempting to exceed
a limit fails loudly.
