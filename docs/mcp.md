# MCP servers

Settings → **MCP Servers**.

Agent Studio manages MCP through **OpenCode's own configuration** — there
is no parallel MCP implementation. Servers live in:

- **Global scope**: your OpenCode config (`~/.config/opencode/
  opencode.json` under `mcp`)
- **Project scope**: `<project>/opencode.json` under `mcp`

Supported entries mirror OpenCode exactly:

| Type | Fields |
|---|---|
| `local` | `command` (array), optional `environment` |
| `remote` | `url`, optional `headers` (auth values may be `secret://…` references) |

Operations: add, edit, delete, **enable/disable** (a disabled server is
disabled for OpenCode itself), and **Test** — a connection check through
the runtime's native connect endpoint.

Project MCP configs are isolated: project A's servers never affect
project B. Global servers apply everywhere.

Only enable the MCP servers a task needs — tool definitions consume model
context.
