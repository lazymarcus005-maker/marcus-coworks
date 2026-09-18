# OpenCode Agent Studio — Full Product & Technical Specification

**Document:** `spec.md`  
**Status:** Draft v2  
**Target Platform:** macOS-first, Apple Silicon-first  
**Core Agent Engine:** OpenCode  
**UI Stack:** Electron + SolidJS + TypeScript  
**Product Type:** Local-first multi-project coding-agent workspace / agent harness

---

## 1. Product Overview

OpenCode Agent Studio is a macOS desktop application that wraps OpenCode with a Cowork-style interface.

The product is not intended to rebuild OpenCode. OpenCode remains the coding-agent runtime responsible for agent execution, tool calling, code editing, shell operations, context handling, MCP, Skills, subagents, and provider interaction.

Agent Studio adds the operating harness around OpenCode:

- multi-project workspaces
- project tabs
- persistent sessions
- visible task/TODO execution state
- Goal Contracts and Definition of Done
- maker/verifier separation
- per-task Git worktree isolation
- attempt tracking and escalation
- path/resource locking
- machine-readable execution gates
- model-aware context compaction
- MCP and Skills management
- subagent visualization
- LLM/provider configuration
- optional Jev decision/routing engine
- privacy/network controls
- audit history
- resource/token budgets
- human approval and escalation inbox

The core idea is:

```text
Do not rely on a long chat as the system state.

User Intent
    ↓
Goal Contract
    ↓
Task/TODO State
    ↓
Agent Execution
    ↓
Deterministic Verification
    ↓
Independent Verifier
    ↓
Evidence / Escalation / Done
```

---

## 2. Design Principles

### 2.1 Compose Around OpenCode

Prefer:

```text
Agent Studio
    ↓
OpenCode Adapter
    ↓
OpenCode
```

over maintaining a deep OpenCode fork.

OpenCode can be patched only when an upstream-compatible adapter cannot provide the required behavior.

### 2.2 Durable State Over Chat Memory

Important state must not exist only in model conversation history.

Persist:

- goals
- tasks
- TODO states
- attempts
- decisions
- changed files
- test evidence
- verifier results
- approvals
- locks
- agent/subagent status
- model/provider selection
- MCP/Skills state
- audit events

### 2.3 Maker Does Not Grade Its Own Work

For non-trivial autonomous or assisted code changes:

```text
Implementer
    ↓
Build / Test
    ↓
Independent Verifier
```

The implementer must not be the only authority that marks its own work complete.

### 2.4 Isolation Before Parallelism

Concurrent editing work should use isolated Git worktrees.

```text
Project
├── main workspace
├── worktree task-001 attempt-1
└── worktree task-002 attempt-1
```

### 2.5 Mechanically Enforced Policy

Security and execution constraints must be enforced by code where possible.

Do not depend only on system prompts such as:

```text
"Please do not modify .env"
```

Use machine-readable gates and policy checks.

### 2.6 Human Agency

Autonomy is configurable.

The product must make it clear:

- what the agent is doing
- what remains
- what failed
- what needs approval
- what evidence supports completion

---

## 3. Product Goals

The application must provide:

1. A Cowork-style desktop coding workspace.
2. Multiple projects open and running concurrently.
3. Independent OpenCode sessions per project.
4. Project tabs that can be added, closed, reopened, renamed, and removed.
5. A visible task/TODO list created when work begins.
6. Goal + Definition of Done for substantial tasks.
7. Native OpenCode MCP support.
8. Native OpenCode Skills support.
9. Native OpenCode subagent/delegation support.
10. Model-aware context compaction.
11. Independent maker/verifier workflow.
12. Per-task/per-attempt Git worktree support.
13. Attempt caps and human escalation.
14. Locking to prevent concurrent agents from mutating overlapping scope.
15. Machine-readable policy gates.
16. OpenAI-compatible, LiteLLM, local-model, and supported provider configuration.
17. Optional Jev decision/routing support.
18. Activity, audit, task, agent, network, and verification visibility.
19. No hidden Agent Studio telemetry or unexpected upload of project data.
20. macOS-native secret storage and packaging.

---

## 4. Non-Goals

Version 1 does not require:

- replacing OpenCode's agent loop
- replacing OpenCode MCP runtime
- replacing OpenCode Skills format
- replacing OpenCode subagent format
- building an LLM inference runtime
- automatically deleting user source directories
- unrestricted host filesystem access from the renderer
- mandatory Jev usage
- mandatory cloud backend
- unattended auto-merge as a default behavior
- scheduled maintenance loops such as dependency sweeping as a v1 requirement

Scheduled autonomous loops may be introduced in later releases.

---

# 5. Platform and Technology Stack

## 5.1 Target Platform

Primary:

- macOS
- Apple Silicon (`arm64`)
- M1 / M2 / M3 / M4 families

Optional later:

- Intel Mac (`x64`)
- universal builds
- Windows/Linux ports

Platform-specific code should remain isolated behind adapters where practical.

## 5.2 Desktop

- Electron
- TypeScript
- SolidJS
- Vite / electron-vite

## 5.3 UI Components

Recommended:

- Tailwind CSS
- Monaco Editor for code/diff
- xterm.js for terminal
- Solid Store or equivalent
- accessible keyboard-first interaction

## 5.4 Persistence

Recommended:

- SQLite for durable application metadata
- append-only event/audit records where appropriate

Do not store plaintext provider/API credentials in SQLite.

## 5.5 macOS Integration

Use:

- macOS Keychain
- native file/folder picker
- macOS Notification Center
- `/bin/zsh` default shell
- user login-shell detection
- Finder integration
- native application menu
- native keyboard shortcuts
- Dock attention indicator where useful

## 5.6 Packaging

Primary artifacts:

- signed `.app`
- `.dmg`
- optional `.zip`

Production:

- Apple code signing
- Hardened Runtime
- notarization
- update-compatible artifacts

Normal operation should not require Full Disk Access.

---

# 6. High-Level Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                    OpenCode Agent Studio                      │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ SolidJS Renderer                                        │  │
│  │                                                         │  │
│  │ Projects / Tabs                                         │  │
│  │ Explorer                                                │  │
│  │ Chat                                                    │  │
│  │ Tasks / TODO                                            │  │
│  │ Agent Tree                                              │  │
│  │ Diff / Terminal / Git                                   │  │
│  │ Activity / Verification / Network                       │  │
│  │ MCP / Skills / Settings                                 │  │
│  └───────────────────────┬─────────────────────────────────┘  │
│                          │ Typed IPC                          │
│  ┌───────────────────────▼─────────────────────────────────┐  │
│  │ Electron Main / Local Controller                       │  │
│  │                                                       │  │
│  │ Project Manager                                       │  │
│  │ Task Manager                                          │  │
│  │ Goal Manager                                          │  │
│  │ Session Manager                                       │  │
│  │ OpenCode Adapter                                      │  │
│  │ Scheduler                                             │  │
│  │ Worktree Manager                                      │  │
│  │ Lock Manager                                          │  │
│  │ Attempt Ledger                                        │  │
│  │ Verification Manager                                  │  │
│  │ Policy/Gate Engine                                    │  │
│  │ Context Manager                                       │  │
│  │ Budget Manager                                        │  │
│  │ Failure Classifier                                    │  │
│  │ Audit/Network/Secret Manager                          │  │
│  │ Decision Engine (Optional)                            │  │
│  └───────────────────────┬─────────────────────────────────┘  │
└──────────────────────────┼────────────────────────────────────┘
                           │
                 ┌─────────┼─────────┐
                 ▼         ▼         ▼
              Project A Project B Project C
                 │         │         │
              OpenCode  OpenCode  OpenCode
                 │         │         │
                 └─────────┼─────────┘
                           ▼
                     LLM / MCP Layer
```

---

# 7. macOS Runtime Model

```text
macOS
│
├── OpenCode Agent Studio.app
│
├── OpenCode runtime/processes
│
├── project repositories
│
├── Git worktrees
│
├── development tools
│   ├── git
│   ├── zsh
│   ├── node
│   ├── dotnet
│   └── project-specific tools
│
└── optional AI services
    ├── oMLX
    ├── LiteLLM
    ├── LM Studio
    └── other OpenAI-compatible endpoints
```

Localhost LLM endpoints are first-class:

```text
http://127.0.0.1:8000/v1
http://localhost:4000/v1
```

No proprietary Agent Studio cloud backend is required.

---

# 8. Multi-Project Workspace

A project is a first-class object.

```ts
type ProjectWorkspace = {
  id: string
  name: string
  path: string

  status:
    | "idle"
    | "running"
    | "waiting"
    | "testing"
    | "verifying"
    | "blocked"
    | "error"
    | "interrupted"

  sessionId?: string
  model?: string
  branch?: string

  createdAt: string
  lastActiveAt: string
}
```

Each project owns:

- workspace path
- OpenCode session(s)
- chat history
- Goal Contracts
- task/TODO store
- attempt history
- worktrees
- locks
- Git state
- terminal sessions
- MCP selection
- Skills selection
- agent/subagent configuration
- context checkpoints
- model configuration
- activity/audit history
- network policy
- project instructions

Project context and state must never leak into another project.

---

# 9. Project Tabs

Example:

```text
[ + ] [ cxutility ● ] [ gateway ⟳ ] [ mock-server ○ ] [ frontend ! ]
```

Status:

```text
● Running
○ Idle
⟳ Tool/Test/Verifier running
! Needs attention
× Error
```

Switching tabs must not stop background work.

Closing a tab closes the view only unless the user explicitly stops the task/session.

---

# 10. Project Lifecycle

Supported actions:

- Add Project
- Open Project
- Close Tab
- Reopen Project
- Rename Project
- Restart Agent
- Pause Project
- Remove Project

Removing a project from Agent Studio must not delete source files.

Optional removal cleanup:

```text
[x] Remove Agent Studio history
[ ] Remove Agent Studio cache
[ ] Remove completed Agent Studio worktrees
```

Never make deleting the source repository a normal Remove Project behavior.

---

# 11. Main Workspace UI

Recommended layout:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ OpenCode Agent Studio                              ⚙   ⏸   Notifications │
├────────────────────────────────────────────────────────────────────────────┤
│ [+] [cxutility ●] [gateway ⟳] [mock-server ○] [frontend !]                │
├───────────────┬───────────────────────────────────────┬────────────────────┤
│ Explorer      │ Chat / Agent                          │ Tasks / TODO       │
│               │                                       │                    │
│ src/          │ User                                  │ Goal               │
│ tests/        │ > Fix login timeout                   │ Fix login timeout  │
│ README.md     │                                       │                    │
│               │ Agent                                 │ ✓ Analyze          │
│               │ Inspecting AuthService...             │ ● Implement        │
│               │                                       │ ○ Test             │
│               │                                       │ ○ Verify           │
│               │                                       │                    │
│               │                                       │ Attempt 1 / 3      │
├───────────────┴───────────────────────────────────────┴────────────────────┤
│ Terminal | Diff | Git | Agents | Verification | Activity | Network        │
└────────────────────────────────────────────────────────────────────────────┘
```

The Task/TODO panel is visible by default for active work.

---

# 12. Task/TODO System

## 12.1 Purpose

Task/TODO is durable execution state, not a cosmetic checklist.

When meaningful work starts, the system should create an initial task plan before broad implementation begins.

Example:

```text
Goal: Fix login timeout

✓ Understand current timeout path
✓ Locate affected code/tests
● Implement minimal fix
○ Add/adjust regression test
○ Run required verification
○ Independent review
```

The user can:

- inspect tasks
- reorder tasks where safe
- add tasks
- edit descriptions
- pause/cancel tasks
- retry failed tasks
- request verification
- open the related agent/session/worktree

## 12.2 OpenCode TODO Integration

Where OpenCode exposes native TODO operations, Agent Studio should integrate with them.

Do not create two disconnected task systems.

Preferred model:

```text
OpenCode TODO events
       ↓
Task Adapter
       ↓
Agent Studio Durable Task Store
       ↓
Task/TODO UI
```

Agent Studio may enrich native TODO records with harness metadata not present in OpenCode.

## 12.3 Task Data Model

```ts
type TaskStatus =
  | "pending"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "testing"
  | "verifying"
  | "rejected"
  | "done"
  | "cancelled"

type HarnessTask = {
  id: string
  projectId: string
  goalId: string

  title: string
  description?: string
  status: TaskStatus

  parentTaskId?: string
  dependencies: string[]

  ownerAgentId?: string
  verifierAgentId?: string

  attempt: number
  maxAttempts: number

  worktreeId?: string
  lockId?: string

  createdAt: string
  startedAt?: string
  completedAt?: string

  evidenceIds: string[]
}
```

## 12.4 Task Initialization

For non-trivial work:

```text
User request
   ↓
Understand / Clarify if needed
   ↓
Goal Contract
   ↓
Initial Task List
   ↓
Execution
```

Simple one-step work may use a single task.

## 12.5 Task Completion

A task may become `done` only when its required completion policy is satisfied.

Example:

```text
implementation complete
      +
required tests passed
      +
required verifier approved
      +
required human approval completed
            ↓
           DONE
```

---

# 13. Goal Contract

Substantial work should have a structured Goal Contract.

```yaml
goal:
  id: goal-0182
  objective: Fix login timeout

  scope:
    - src/Auth/**
    - tests/Auth/**

  non_goals:
    - no authentication redesign
    - no unrelated refactor

  done_when:
    - build passes
    - unit tests pass
    - regression test passes
    - no unrelated files modified

  risk: medium
  max_attempts: 3
```

Fields should include:

- objective
- scope
- non-goals
- constraints
- Definition of Done
- expected evidence
- risk
- allowed autonomy
- attempt cap
- optional time/token budget

Goal state:

```text
draft
ready
running
blocked
verification
human_required
done
cancelled
```

---

# 14. Run / Task State Machine

Recommended state machine:

```text
CREATED
   ↓
PLANNING
   ↓
READY
   ↓
RUNNING
   ↓
TESTING
   ↓
VERIFYING
   ├── APPROVED → DONE
   ├── REJECTED → RETRY
   └── ESCALATE → HUMAN_REQUIRED
```

Additional terminal states:

```text
CANCELLED
FAILED
INTERRUPTED
```

State transitions must be persisted and auditable.

---

# 15. Maker / Verifier Split

For configured tasks, use:

```text
Implementer
    ↓
deterministic verification
    ↓
Independent Verifier
```

The verifier should preferably:

- use a fresh child session/context
- have read-only source permissions where feasible
- be able to run required tests/checks
- inspect diff and evidence
- return a structured decision

Example:

```ts
type VerificationDecision = {
  decision: "approve" | "reject" | "human_required"
  reasons: string[]
  failedCriteria: string[]
  evidence: string[]
}
```

The verifier must not edit the implementation during verification unless the workflow explicitly starts a new repair attempt.

For higher-risk autonomous work, a different model may be used for verification.

---

# 16. Verification Pipeline

Verification should combine deterministic tools and model review.

```text
Code change
   ↓
Format
   ↓
Lint
   ↓
Build
   ↓
Tests
   ↓
Policy checks
   ↓
Independent Verifier
```

A model review does not replace required deterministic checks.

Store evidence:

- command
- exit code
- pass/fail counts
- duration
- relevant summary
- full output reference
- diff/hash
- verifier decision

---

# 17. Attempt Ledger

Every retry must be tracked.

```ts
type AttemptRecord = {
  id: string
  taskId: string
  attempt: number

  agentId: string
  model?: string
  worktreeId?: string

  startedAt: string
  endedAt?: string

  outcome:
    | "approved"
    | "rejected"
    | "failed"
    | "escalated"
    | "cancelled"

  failureClass?: string
  summary?: string
  evidenceIds: string[]
}
```

Example:

```text
Task #182

Attempt 1
Model: local-coder
Result: test failed

Attempt 2
Model: coding-premium
Result: verifier rejected
Reason: unrelated change

Attempt 3
Result: environment failure

→ Human Required
```

Default recommended attempt cap:

```text
3
```

Attempt caps must be enforced mechanically.

The model or Jev cannot self-raise a hard attempt cap.

---

# 18. Git Worktree Isolation

Editing tasks should support isolated Git worktrees.

Recommended:

```text
repo/
└── .agent-studio/
    └── worktrees/
        ├── task-182-attempt-1/
        └── task-183-attempt-1/
```

Workflow:

```text
Task
 ↓
Create worktree/branch
 ↓
Acquire scope lock
 ↓
Run implementer
 ↓
Capture diff
 ↓
Test
 ↓
Verify
 ↓
Approve / Reject / Escalate
 ↓
Apply/Commit or discard
 ↓
Release lock
 ↓
Cleanup
```

Worktree states:

```text
active
approved
rejected
escalated
merged
stale
```

Cleanup must be conservative.

Uncommitted worktrees should not be destructively removed without explicit policy.

Worktree isolation is not an OS security sandbox.

---

# 19. Lock / Collision Manager

Parallel agents must not silently mutate overlapping scope.

Lock target examples:

```text
src/Auth/**
package.json
package-lock.json
PR #123
branch feature/US-001
```

Lock record:

```ts
type ScopeLock = {
  id: string
  ownerTaskId: string
  ownerAgentId?: string
  patterns: string[]
  acquiredAt: string
  expiresAt?: string
}
```

Behavior on conflict:

```text
Conflict detected
   ↓
queue / wait / escalate
```

Do not silently continue.

Support:

- TTL
- owner
- wait timeout
- deadlock detection where practical
- stale-lock reconciliation
- visible lock state in task details

---

# 20. Machine-Readable Gate Policy

Project policy should be machine-readable.

Example:

```yaml
version: 1

protected_paths:
  - "**/.env"
  - "**/.env.*"
  - "**/secrets/**"
  - "**/credentials/**"

human_approval:
  - "**/auth/**"
  - "**/payments/**"
  - "**/billing/**"
  - "**/migrations/**"
  - "**/k8s/production/**"

change_limits:
  max_files: 15
  max_attempts: 3

git:
  commit: allow
  push: ask
  force_push: deny
  delete_branch: ask

verification:
  build_required: true
  tests_required: true
  independent_verifier: true
```

Policy check:

```text
Proposed action
    ↓
Policy/Gate Engine
    ├── ALLOW
    ├── ASK
    └── DENY
```

Policy must be separate from LLM judgment.

---

# 21. Autonomy Levels

Autonomy is separate from model-quality mode.

## 21.1 Autonomy

```text
L0 Manual
L1 Report
L2 Assisted
L3 Autonomous
```

### L0 — Manual

Agent suggests; user drives actions.

### L1 — Report

Agent may inspect and plan but does not modify source automatically.

### L2 — Assisted

Agent may implement within policy, but high-risk actions require approval.

### L3 — Autonomous

Agent may execute approved workflow without per-step approval, but remains bounded by:

- policy
- attempt limits
- budgets
- verifier
- locks
- kill switch
- human escalation rules

Default for a new project should be L1 or L2, not L3.

## 21.2 Model Mode

Separate setting:

```text
Auto
Fast
Quality
Manual
```

Example:

```text
Autonomy: L2 Assisted
Model Mode: Quality
```

---

# 22. Human Inbox / Escalation Queue

Agent Studio must provide a shared Human Inbox.

Examples:

```text
Human Inbox

[!] Task #182
Verifier rejected attempt 3/3
Action required

[!] Task #205
Requested change touches **/auth/**
Approval required

[!] gateway
Path lock conflict on package.json
```

Escalation triggers include:

- max attempts reached
- protected path
- policy ASK
- ambiguous goal/Definition of Done
- repeated verifier rejection
- security-sensitive change
- lock conflict that cannot resolve
- budget extension request
- unknown destructive action

Notifications should prioritize actionable events, not every loop step.

---

# 23. Failure Classification and Recovery

Classify failures before deciding whether to edit code.

Suggested categories:

```text
ImplementationFailure
TestRegression
FlakyTest
BuildFailure
EnvironmentFailure
NetworkFailure
ProviderFailure
ToolFailure
PermissionFailure
ContextFailure
PolicyFailure
UnknownFailure
```

Example recovery:

```text
FlakyTest
→ retry test according to policy
→ do not edit source automatically

ProviderFailure
→ backoff / provider fallback if configured

ContextFailure
→ compact/rebuild context

PermissionFailure
→ Human Inbox

ImplementationFailure
→ repair attempt

EnvironmentFailure
→ diagnose environment before source modification
```

Failure classification may use deterministic rules first and model/Jev assistance second.

---

# 24. Idempotency and Duplicate Detection

Before creating durable external effects, check existing state.

Examples:

- existing task for same goal
- existing worktree
- existing branch
- existing open PR
- existing issue
- repeated MCP mutation
- already-applied patch

External mutation should use idempotency keys when supported.

Retry must not blindly duplicate actions.

---

# 25. Budget Manager

Support budgets at task/project/global levels.

## 25.1 Per Task

```text
max attempts
max model calls
max tokens
max subagents
max duration
```

## 25.2 Per Project

```text
max concurrent tasks
daily token budget
daily estimated cost
```

## 25.3 Global

```text
max concurrent agents
max remote LLM requests
max local LLM requests
max shell jobs
daily token budget
daily estimated cost
```

At defined thresholds, the harness may:

- warn
- downgrade autonomy
- switch to report-only
- stop spawning subagents
- pause work
- escalate

Budget caps cannot be raised by an agent without policy/user authorization.

---

# 26. Global Pause / Kill Switch

Provide a visible global control:

```text
[ ⏸ Pause All Agents ]
```

On pause:

- prevent new LLM calls
- prevent new tool actions
- cancel or safely finish current operations according to policy
- persist state
- retain evidence
- release or reconcile locks

Resume must be explicit.

Project-level pause is also required.

---

# 27. Context Management and Compaction

Context management is a core harness requirement.

OpenCode native compaction should be the primary mechanism.

Agent Studio adds:

- model-aware configuration
- durable state
- context visibility
- project isolation
- compaction audit
- safe model switching

## 27.1 Requirements

The Context Manager must:

- detect model input/context limits
- reserve output/tool headroom
- compact before overflow
- retain recent high-value context
- preserve critical task state
- prune obsolete/large tool results where safe
- support overflow recovery
- isolate project/subagent contexts
- support manual compaction
- record compaction events

## 27.2 Model Context Profile

```ts
type ModelContextProfile = {
  provider: string
  model: string

  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: number

  compaction?: {
    auto: boolean
    keepTokens?: number
    bufferTokens?: number
  }
}
```

Resolution priority:

```text
Explicit model config
 ↓
OpenCode/provider metadata
 ↓
Gateway metadata
 ↓
Known catalog
 ↓
Conservative fallback
```

## 27.3 Compaction Must Preserve

At minimum:

- Objective
- Requirements
- Definition of Done
- Non-goals
- Constraints
- Decisions
- Task/TODO state
- Attempts
- Files inspected
- Files changed
- Git/worktree state
- tests/build results
- verifier state
- blockers
- next action
- active Skills
- relevant MCP dependencies
- security/policy constraints

## 27.4 Durable State + Active Context

Preferred model:

```text
Durable Project State
       +
Latest Compact Checkpoint
       +
Recent Context
       +
On-demand Retrieval
          ↓
Next Agent Step
```

Do not put the full repository into every request.

## 27.5 Tool Output Pruning

Example:

```text
Raw test output: 48 KB

Active context:
dotnet test
exit: 0
passed: 52
failed: 0
duration: 8.4s

Full output remains persisted outside active context.
```

## 27.6 Subagent Context

Send only the delegated objective and relevant context.

Do not automatically clone the complete parent history.

Child completion should return a compact result:

```text
Result
Evidence
Files changed
Blockers
Important decisions
Recommended next step
```

## 27.7 Model Switching

Switching from a larger context model to a smaller model must trigger a budget re-evaluation and compaction/rebuild before the next request.

## 27.8 Context UI

Example:

```text
Context

Model               qwen3.6-35b-a3b
Context Window      262,144
Estimated Active    118,320
Safety Reserve       32,000
Auto Compaction      ON
Last Compacted       10:42:11

[ Compact Now ] [ Advanced ]
```

---

# 28. OpenCode Integration

Use the supported SDK/server interface where possible.

Keep a runtime abstraction:

```ts
interface CodingAgentRuntime {
  createSession(projectId: string): Promise<string>
  resumeSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string): Promise<void>
  stopSession(sessionId: string): Promise<void>
  getStatus(sessionId: string): Promise<AgentStatus>
}
```

Agent Studio-specific harness state remains outside OpenCode so that the OpenCode adapter can evolve independently.

---

# 29. LLM Provider Configuration

Support:

- OpenAI-compatible API
- LiteLLM
- localhost OpenAI-compatible endpoints
- direct OpenCode-supported providers
- per-project model
- per-agent model
- per-subagent model
- optional separate verifier model

Example:

```json
{
  "id": "company-litellm",
  "name": "Company LiteLLM",
  "type": "openai-compatible",
  "baseUrl": "https://llm.company.local/v1",
  "apiKeySecretId": "secret://company-litellm",
  "defaultModel": "qwen3.6-35b-a3b"
}
```

---

# 30. MCP Support

MCP must remain compatible with OpenCode.

Support:

- Global MCP
- Project MCP
- Enable/disable per project
- Local MCP
- Remote MCP
- MCP authentication configuration
- permission policy per MCP/tool
- connection/test status

Example:

```text
MCP Servers

Name       Type      Scope       Status
GitLab     Remote    Global      ●
Elastic    Remote    Project     ●
Docling    Local     Project     ●
Jira       Remote    Global      ○
```

MCP tools add to model context; only relevant/needed MCP servers should be enabled for a project/task where practical.

---

# 31. Skills Support

Preserve OpenCode-compatible `SKILL.md`.

Support:

- Global Skills
- Project Skills
- import local skill
- install from Git
- create/edit skill
- enable/disable per project
- permission per agent

Example:

```text
Skills

coding-standard   Global   ✓
dotnet            Project  ✓
gitlab-flow       Project  ✓
release-prod      Global   ○
```

Possible future feature:

- Company Skills Registry

Do not create a proprietary Skill format unless necessary.

---

# 32. Agent and Subagent Support

Use OpenCode native agents/subagents.

Example:

```text
Primary / Orchestrator
│
├── Explorer
├── Implementer
├── Tester
└── Verifier
```

Agents may have different:

- model
- prompt
- permissions
- Skills
- MCP access
- context
- write privileges

Delegation limits:

```text
max delegation depth
max active subagents/project
max total subagents
max subagent model calls
```

---

# 33. Agent Tree UI

Example:

```text
Main Agent
│
├── ✓ Explorer
│     Locate timeout path
│
├── ● Implementer
│     Worktree task-182-attempt-1
│
├── ○ Tester
│
└── ○ Verifier
```

Selecting a node shows:

- parent
- child session
- task
- model
- context usage
- tools used
- Skills used
- MCP calls
- files read/changed
- worktree
- duration
- token usage if available
- result

---

# 34. Optional Decision Engine

Decision/routing is optional.

Core behavior must work without it.

Potential decisions:

- task classification
- complexity
- model selection
- subagent selection
- whether to delegate
- whether review is required
- whether to escalate
- confidence/risk

Generic interface:

```ts
interface DecisionEngine {
  decide<T>(
    state: AgentDecisionState,
    schema: DecisionSchema
  ): Promise<DecisionResult<T>>
}
```

Providers:

```text
Disabled
Jev
Structured-output LLM
Rule-Based
Other
```

Hard safety limits remain enforced outside the Decision Engine.

---

# 35. Jev Provider

Default:

```text
Jev Decision Engine = OFF
```

Settings:

```text
Settings
└── Decision Engine

    [ ] Enable Decision Engine

    Provider
    [ Jev ]

    Endpoint Type
    [ OpenRouter Compatible ]

    Base URL
    [ __________________________ ]

    API Key
    [ ************************** ]

    Model
    [ __________________________ ]

    Minimum Confidence
    [ 0.80 ]

    [ Test Connection ]
```

The user configures API key, endpoint/path, and model.

Jev must never be a hard dependency.

If Jev fails, normal OpenCode operation must remain available.

---

# 36. Privacy and Data Flow

Expected:

```text
Project context
   ↓
Configured LLM endpoint
```

This is normal behavior.

Requirement:

> Agent Studio must not secretly upload project source, prompts, files, or metadata to unrelated services.

Agent Studio telemetry should be disabled by default unless explicitly implemented and opted in.

The user may configure remote LLM providers; this is an expected trust boundary.

---

# 37. Network Policy and Visibility

Support profiles:

```text
Safe
Developer
Autonomous
Custom
```

Potential allowlist:

```text
llm.company.local
git.company.local
registry.npmjs.org
```

Network Activity UI:

```text
10:14:01 POST llm.company.local/v1/chat/completions
32 KB
Allowed

10:14:20 GET git.company.local/api/v4/projects
4 KB
Allowed

10:14:44 POST unknown.example.com
1 KB
Blocked
```

Show:

- timestamp
- project
- process/session
- task
- destination
- method
- size
- allowed/blocked
- category

Advanced network enforcement may be delivered in a hardening phase.

---

# 38. Audit and Run History

Each run/task should produce structured history.

Example:

```json
{
  "runId": "run-20260919-001",
  "projectId": "cxutility",
  "goalId": "goal-182",
  "taskId": "task-182-3",
  "attempt": 1,
  "startedAt": "2026-09-19T10:14:00+07:00",
  "durationMs": 54000,
  "model": "coding-premium",
  "outcome": "rejected",
  "failureClass": "TestRegression"
}
```

Activity should show:

```text
READ
SEARCH
LLM
MCP
SKILL
WRITE
EXEC
TEST
VERIFY
POLICY
LOCK
WORKTREE
CONTEXT
APPROVAL
```

Full sensitive prompts do not need to be duplicated in audit logs by default.

---

# 39. Renderer Security

Required Electron security defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- narrow preload API
- Content Security Policy
- no unrestricted renderer filesystem access
- no unrestricted renderer shell execution
- no renderer Keychain access

Flow:

```text
Renderer
 ↓
Preload
 ↓
Typed IPC
 ↓
Main Process
```

---

# 40. Secret Management

Use macOS Keychain.

Application configs store secret references:

```text
secret://company-litellm
secret://gitlab-mcp
secret://jev
```

Where practical:

```text
Agent
 ↓
Broker/Proxy
 ↓
Credential injection
 ↓
External Service
```

Avoid exposing raw credentials in agent-visible environment variables.

---

# 41. Git Policy

UI should display:

- branch
- dirty state
- changed files
- diff
- commit history
- ahead/behind
- conflicts
- task worktree branch

Example policy:

```text
status       allow
diff         allow
commit       allow/ask
push         ask
force push   deny
delete branch ask/deny
```

---

# 42. Terminal

Each project may have multiple terminal sessions.

Default shell:

```text
/bin/zsh
```

Terminal state is project-scoped.

Processes must not leak between projects.

---

# 43. Diff and Patch Review

Use Monaco or equivalent.

Support:

- file-by-file diff
- changed file list
- staged/unstaged where relevant
- worktree diff
- verifier annotations
- apply/revert where safe
- patch export

Future:

- inline human comments
- partial acceptance
- patch consensus

---

# 44. Notifications

Notify only for meaningful events:

- task completed
- task failed
- verifier rejected
- human approval required
- max attempts reached
- MCP authentication required
- lock conflict
- budget threshold
- project error

Avoid notification on every internal run step.

---

# 45. Background Execution and Resume

Switching tabs must not interrupt agents.

If the app exits and local work is interrupted:

```text
status = INTERRUPTED
```

On restart restore:

- projects
- open tabs
- active tab
- Goal Contracts
- tasks/TODOs
- attempts
- session references
- MCP/Skills selections
- model settings
- context checkpoint metadata
- audit history
- worktree manifest
- locks, reconciled as stale/active

Do not falsely show an interrupted process as running.

---

# 46. Settings

Global:

```text
Settings
├── General
├── Appearance
├── LLM Providers
├── Decision Engine
├── Context
├── MCP
├── Skills
├── Agents
├── Autonomy
├── Verification
├── Policy
├── Security
├── Network
├── Concurrency
├── Budgets
├── Git
├── Storage
└── Advanced
```

Project:

```text
Project Settings
├── General
├── Model
├── Instructions
├── Context
├── MCP
├── Skills
├── Agents
├── Autonomy
├── Verification
├── Policy
├── Network
├── Git
└── Advanced
```

Inheritance:

```text
System Default
 ↓
Global
 ↓
Project
 ↓
Agent
 ↓
Session/Task Override
```

---

# 47. Project Instructions

Use OpenCode-native project instruction mechanisms where possible.

Example constraints:

```text
- .NET 10
- no TLS validation bypass
- tests must pass
- do not refactor unrelated modules
```

Avoid duplicating instruction formats unnecessarily.

Machine-enforced policy is separate from prose instructions.

---

# 48. Harness Readiness / Doctor

Provide a project readiness diagnostic.

Example:

```text
Harness Doctor

✓ Git repository detected
✓ OpenCode available
✓ LLM provider reachable
✓ Build command known
✓ Test command known
✓ Goal/Task persistence ready
✓ Worktree supported
✓ Policy loaded
! Independent verifier not configured
! Protected paths not configured

Autonomy recommendation:
L2 Assisted
```

Readiness should check:

- OpenCode availability
- LLM provider
- Git/worktree support
- build/test commands
- policy validity
- verifier configuration
- attempt limits
- budget config
- MCP/Skills health
- context/model metadata
- secret availability

Do not convert readiness into an opaque single score that hides critical failures.

---

# 49. Workflow Templates

Reusable interactive workflow templates may include:

```text
Bug Fix
Feature
Refactor Slice
Code Review
CI Repair
Dependency Investigation
Documentation
```

Example Bug Fix:

```text
Intake
 ↓
Goal
 ↓
Explore
 ↓
Task List
 ↓
Implement
 ↓
Test
 ↓
Verify
 ↓
Human Gate if required
 ↓
Done
```

Templates configure harness behavior, not model-specific prompt tricks.

---

# 50. MVP Acceptance Criteria

## Multi-Project

- open at least 3 projects
- independent sessions
- switching tabs does not interrupt other projects
- closing a tab does not delete state
- project removal does not delete source

## Task/TODO

- meaningful work creates a visible task list
- TODO state is persisted
- task status updates during execution
- task details show current agent/attempt
- user can add/edit/cancel tasks
- task completion respects configured verification policy

## Goal

- substantial task may define objective, scope, non-goals, Definition of Done
- Goal state survives restart

## OpenCode

- start/resume session
- stream responses
- execute normal coding workflow
- map native TODO events where available

## MCP

- add/view/remove/enable/disable
- global/project scopes
- OpenCode can use enabled MCP

## Skills

- OpenCode-compatible skill import/install
- global/project scopes
- per-project enable/disable

## Subagents

- native delegation works
- GUI shows delegation tree
- subagent may use another model

## Context

- automatic compaction enabled
- model-aware context budget
- manual compact
- compact state visible
- model switching re-evaluates context
- project context isolation

## Harness

- per-task attempt count
- max-attempt enforcement
- worktree creation for configured editing tasks
- independent verifier for configured workflows
- machine-readable policy checks
- human escalation state
- global pause

## LLM

- OpenAI-compatible endpoint
- LiteLLM
- localhost endpoint
- Keychain-backed API key

## Jev

- system works with Jev OFF
- optional provider can be enabled
- custom API key/base URL/model
- Jev failure does not break normal OpenCode workflow

## macOS

- native Apple Silicon run
- `.dmg` package
- Keychain integration
- zsh terminal
- native folder picker
- no Full Disk Access required for normal operation

---

# 51. Definition of Done — Product v1

Product v1 is complete when a user can:

1. Install Agent Studio on Apple Silicon macOS.
2. Configure a local or remote OpenAI-compatible/LiteLLM provider.
3. Register multiple repositories.
4. Open projects as independent tabs.
5. Start a coding request and see a Goal/Task/TODO plan.
6. Observe tasks transition while the agent works.
7. Run OpenCode independently across multiple projects.
8. Use MCP and Skills normally.
9. Use OpenCode subagents and inspect their activity.
10. Run model-aware context compaction.
11. Execute an editing task in an isolated worktree where configured.
12. Run deterministic tests and an independent verifier.
13. Reject/retry with an Attempt Ledger.
14. Stop automatic retry at the attempt limit.
15. Escalate blocked/high-risk work to Human Inbox.
16. Enforce machine-readable protected-path/action policy.
17. Pause all agents with a global kill switch.
18. Restart Agent Studio and recover durable project/task state.
19. Run without Jev.
20. Optionally enable Jev routing.
21. Confirm Agent Studio has no required proprietary cloud backend.

---

# 52. Suggested Product Phases

```text
Phase 1
Foundation + Multi-Project Cowork UI

Phase 2
Harness Execution + Task/TODO + Verification

Phase 3
Agent Ecosystem + Context + Decision Routing

Phase 4
Privacy / Security / Network / Operational Hardening

Phase 5
macOS Production Release + Evaluation + Advanced Isolation
```

Implementation details are provided in:

- `implementation-phase-1.plan.md`
- `implementation-phase-2.plan.md`
- `implementation-phase-3.plan.md`
- `implementation-phase-4.plan.md`
- `implementation-phase-5.plan.md`

---

# 53. Key Ownership Boundary

```text
AGENT STUDIO OWNS

GUI
Projects
Goal Contracts
Tasks/TODO
Durable State
Attempts
Worktrees
Locks
Verification Orchestration
Policy Gates
Scheduling
Budgets
Human Inbox
Audit
Network Visibility/Control
Settings
Decision Engine Integration
Secrets


OPENCODE OWNS

Agent Loop
Core Tool Execution
Context/Compaction Runtime
Code Editing
Shell
MCP Runtime
Skills Runtime
Subagents
Provider Interaction
OpenCode Session Semantics
```

Where OpenCode already offers a suitable primitive, integrate it rather than duplicating it.

---

# 54. Design References

These are design references, not formal industry standards.

## Loop Engineering

Repository:

- https://github.com/cobusgreyling/loop-engineering

Concepts / primitives:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/concepts.md
- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/primitives.md

Maker/checker, state, human handoff, budgets, readiness:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/loop-design-checklist.md

Failure modes:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/failure-modes.md

Safety and machine-readable gates:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/safety.md
- https://github.com/cobusgreyling/loop-engineering/blob/main/gate.yaml

Multi-loop collision / coordination:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/multi-loop.md

Production operation / budgets / kill conditions:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/operating-loops.md

Scoped refactor / one slice at a time:

- https://github.com/cobusgreyling/loop-engineering/blob/main/docs/refactor.md

Worktree isolation:

- https://github.com/cobusgreyling/loop-engineering/blob/main/tools/loop-worktree/README.md
- https://github.com/cobusgreyling/loop-engineering/blob/main/tools/loop-sandbox/README.md

OpenCode examples:

- https://github.com/cobusgreyling/loop-engineering/blob/main/examples/opencode/daily-triage.md
- https://github.com/cobusgreyling/loop-engineering/blob/main/examples/opencode/pr-babysitter.md

## OpenCode

Agents / subagents / permissions / TODO permissions:

- https://opencode.ai/docs/agents

Skills:

- https://opencode.ai/docs/skills

MCP:

- https://opencode.ai/v2/docs/mcp-servers

Compaction:

- https://opencode.ai/v2/docs/compaction

---

# 55. Rationale for Loop-Engineering Additions

The following requirements are intentionally adopted from the operating patterns above because they directly address long-running agent failure modes:

| Agent Studio Requirement | Reference Pattern |
|---|---|
| Independent verifier | Maker/checker split |
| Task/TODO durable state | State/memory primitive |
| Attempt cap | Infinite-fix-loop mitigation |
| Per-attempt worktree | Parallelism/isolation primitive |
| Path locks | Multi-loop collision mitigation |
| Machine-readable policy | Safety gate |
| Human Inbox | Escalation/handoff |
| Budget + global pause | Production loop operations |
| Failure classification | Failure-mode-aware recovery |
| Idempotency | Safe repeated loop execution |
| Autonomy levels | Report → assisted → unattended progression |

The objective is not to copy the Loop Engineering CLI. The objective is to apply its robust harness patterns around OpenCode while keeping Agent Studio interactive and Cowork-like.
