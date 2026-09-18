# Implementation Phase 1 Plan
## Foundation + Multi-Project Cowork UI

**Goal:** Deliver a usable macOS desktop application that can manage multiple projects and operate OpenCode sessions through a stable adapter.

### Scope

Build:

- Electron + SolidJS desktop shell
- macOS-first packaging skeleton
- secure preload/IPC boundary
- SQLite persistence
- macOS Keychain abstraction
- project registry
- project tabs
- project switcher
- file explorer
- chat panel
- basic Task/TODO panel
- OpenCode adapter
- session create/resume/stop
- streaming agent responses
- LLM provider configuration
- OpenAI-compatible/LiteLLM/local endpoints
- terminal panel
- basic activity event bus
- settings shell

Do not yet implement full worktree/verifier/policy orchestration.

### Milestones

#### P1.1 Repository and Desktop Foundation

Create monorepo:

```text
apps/desktop
packages/ui
packages/shared
packages/persistence
packages/secrets
packages/opencode-adapter
packages/project-manager
packages/task-manager
```

Configure:

- TypeScript strict mode
- lint
- unit tests
- Electron security defaults
- arm64 dev/build

Acceptance:

- app boots
- renderer has no Node integration
- typed preload calls main process successfully

#### P1.2 Persistence

Create migrations/tables for:

```text
projects
project_tabs
sessions
goals
tasks
settings
providers
activity_events
```

Secrets contain references only.

Acceptance:

- restart restores projects and tabs
- schema migrations are repeatable

#### P1.3 Project Management

Implement:

- Add Project
- Browse folder
- Validate folder
- Close/Reopen tab
- Rename
- Remove from Agent Studio
- Do not delete source

Acceptance:

- at least 3 projects registered/open
- tab switching preserves state

#### P1.4 OpenCode Adapter

Define:

```ts
CodingAgentRuntime
```

Implement:

- detect OpenCode
- start/connect
- create session
- resume session
- send user message
- stream messages/events
- stop run
- fetch basic status

Acceptance:

- one project can chat with OpenCode
- three projects can hold independent sessions

#### P1.5 Provider Configuration

Support:

- base URL
- API key secret reference
- model
- connectivity test
- localhost endpoints

Acceptance:

- LiteLLM works
- local OpenAI-compatible endpoint works
- API key is stored in Keychain

#### P1.6 Task/TODO UI v1

Create persistent Task Store.

On a new substantial request:

- create Goal draft
- create initial task container
- show Task/TODO panel

Integrate OpenCode TODO events where exposed.

Task states initially:

```text
pending
in_progress
blocked
done
cancelled
```

Acceptance:

- task list visible during work
- task state survives restart
- user can add/edit/cancel task

#### P1.7 Terminal + Explorer

Implement:

- project-scoped file explorer
- project-scoped PTY
- zsh default
- basic terminal tabs

Acceptance:

- terminal cwd matches project
- project A terminal never changes project B cwd

### Tests

- unit: stores/managers/adapters
- integration: SQLite restore
- integration: Keychain abstraction
- integration: OpenCode session isolation
- E2E: add 3 projects → run chats → restart → restore

### Exit Criteria

Phase 1 is done when Agent Studio is a functional multi-project macOS GUI over OpenCode with persistent sessions, basic tasks, provider config, explorer, chat, and terminal.
