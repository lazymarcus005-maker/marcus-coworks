# OpenCode Agent Studio — Implementation Handoff

You are taking over implementation of **OpenCode Agent Studio**.

Your job is to read the provided specification and implementation plans, understand the architecture and constraints, then implement the system phase by phase until the requested scope is complete.

Do not treat this as a one-shot code generation task.

Operate as a coding agent working against a real repository:

```text
Understand
→ Plan
→ Implement
→ Build
→ Test
→ Verify
→ Fix
→ Re-test
→ Review Diff
→ Deliver Evidence
```

---

# 1. Required Reading

Before modifying code, read these files completely.

Read in this order:

```text
1. spec.md

2. implementation-phase-1.plan.md
3. implementation-phase-2.plan.md
4. implementation-phase-3.plan.md
5. implementation-phase-4.plan.md
6. implementation-phase-5.plan.md
```

`spec.md` is the authoritative product and technical specification.

The phase plan files define implementation order and milestones.

If a phase plan conflicts with `spec.md`, follow `spec.md` unless the repository contains a newer explicit decision.

---

# 2. Primary Objective

Build a macOS-first, Apple-Silicon-first desktop coding-agent workspace around OpenCode.

The system must provide:

- Electron + SolidJS desktop GUI
- multi-project workspace
- project tabs
- independent OpenCode sessions per project
- persistent Task/TODO state
- Goal Contracts
- maker/verifier workflow
- per-task Git worktree isolation
- attempt tracking
- path/resource locking
- machine-readable policy gates
- MCP management
- Skills management
- subagent/delegation visualization
- model-aware context compaction
- local/OpenAI-compatible/LiteLLM providers
- optional Jev decision engine
- audit/activity history
- budgets and kill switch
- macOS Keychain integration
- privacy/network controls

Do not rebuild OpenCode functionality that can be reused through supported interfaces.

---

# 3. Architectural Rule

Maintain this ownership boundary.

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

Prefer composition over a deep OpenCode fork.

If OpenCode already provides a usable primitive, integrate it.

---

# 4. Start With Repository Inspection

Before implementing anything:

1. Inspect repository structure.
2. Inspect existing package manager and workspace configuration.
3. Inspect current Electron/SolidJS setup if present.
4. Inspect tests.
5. Inspect lint/build scripts.
6. Inspect OpenCode integration code if present.
7. Inspect persistence/schema code.
8. Inspect existing TODO/task implementation.
9. Inspect Git status.
10. Identify what phase/milestone is already complete.

Do not overwrite working functionality.

Do not assume the repository is empty.

---

# 5. Determine Current Phase

Compare the repository against:

```text
implementation-phase-1.plan.md
implementation-phase-2.plan.md
implementation-phase-3.plan.md
implementation-phase-4.plan.md
implementation-phase-5.plan.md
```

Create an internal status such as:

```text
Phase 1
✓ P1.1 Repository Foundation
✓ P1.2 Persistence
● P1.3 Project Management
○ P1.4 OpenCode Adapter
...
```

Continue from the first incomplete milestone.

Do not restart completed work without a technical reason.

---

# 6. Task/TODO Requirement

At the beginning of implementation work, maintain a task list.

Example:

```text
✓ Inspect repository
✓ Map current implementation against specification
● Implement ProjectManager
○ Add persistence migration
○ Add tests
○ Run build
○ Run verification
```

Update tasks as work progresses.

A TODO list is not evidence of completion.

A task is complete only when implementation and required verification pass.

---

# 7. Implementation Strategy

Work in small, verifiable increments.

For each milestone:

```text
Read relevant spec
↓
Inspect existing code
↓
Define minimal implementation
↓
Implement
↓
Run format/lint/build/tests
↓
Inspect failures
↓
Fix
↓
Re-run verification
↓
Inspect git diff
↓
Update task state
```

Avoid large speculative rewrites.

Prefer the smallest coherent change that satisfies the current milestone.

---

# 8. Phase Order

Unless explicitly instructed otherwise, implement in this order.

## Phase 1

Foundation + Multi-Project Cowork UI

Primary result:

```text
macOS desktop application
+
multi-project tabs
+
persistent OpenCode sessions
+
basic Task/TODO
+
provider configuration
+
terminal/explorer/chat
```

## Phase 2

Harness Execution + Task/TODO + Verification

Primary result:

```text
Goal
→ Task
→ Worktree
→ Implement
→ Test
→ Independent Verify
→ Retry / Escalate / Done
```

## Phase 3

Agent Ecosystem + Context + Decision Routing

Primary result:

```text
MCP
Skills
Subagents
Context management
Scheduler
Autonomy
Optional Jev
```

## Phase 4

Privacy + Security + Operational Hardening

Primary result:

```text
Network visibility/control
Secrets
Budgets
Audit
Idempotency
Harness Doctor
```

## Phase 5

macOS Production + Evaluation + Isolation

Primary result:

```text
Signed/notarized app
Recovery
Advanced isolation
Evaluation
Performance
Documentation
```

---

# 9. macOS Requirements

The primary target is:

```text
macOS
Apple Silicon
arm64
```

Use:

- macOS Keychain for credentials
- native folder picker
- `/bin/zsh` default shell
- macOS Notification Center where required
- Electron secure preload bridge
- native packaging suitable for `.app` / `.dmg`

Do not require Full Disk Access for normal operation.

Do not expose unrestricted host filesystem access to the renderer.

---

# 10. Electron Security Requirements

Required defaults:

```text
contextIsolation = true
nodeIntegration = false
```

Renderer access must flow through:

```text
Renderer
→ Preload
→ Typed IPC
→ Electron Main
```

Do not expose:

```text
fs
child_process
Keychain
arbitrary exec
```

directly to renderer code.

Expose narrow application APIs.

---

# 11. OpenCode Integration

Use OpenCode through a stable adapter.

Example abstraction:

```ts
interface CodingAgentRuntime {
  createSession(projectId: string): Promise<string>
  resumeSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, message: string): Promise<void>
  stopSession(sessionId: string): Promise<void>
  getStatus(sessionId: string): Promise<AgentStatus>
}
```

Do not spread OpenCode-specific implementation details throughout UI/business logic.

Keep integration behind `opencode-adapter`.

---

# 12. Multi-Project Isolation

Each project must have independent:

- workspace
- session
- chat
- tasks
- terminal
- Git state
- agent state
- MCP config
- Skills config
- model config
- context state
- audit history

Never mix project context.

Switching project tabs must not stop background work.

---

# 13. Harness Execution Rules

For non-trivial code modifications, follow:

```text
Goal
↓
Task/TODO
↓
Attempt
↓
Worktree
↓
Implementer
↓
Deterministic Verification
↓
Independent Verifier
↓
Approve / Reject / Human Required
```

The implementer must not be the only authority that marks work complete when independent verification is required.

---

# 14. Attempt Limits

Default maximum attempts:

```text
3
```

Attempt limits must be enforced by code.

Do not create infinite self-repair loops.

After the limit:

```text
HUMAN_REQUIRED
```

Preserve:

- failure reason
- diff
- evidence
- test output reference
- attempt history

---

# 15. Git Worktrees

For isolated editing tasks, use per-task/per-attempt worktrees.

Example:

```text
task-182-attempt-1
task-182-attempt-2
```

Do not destroy the user's main working tree.

Rejected attempts must be recoverable/auditable until cleanup policy applies.

Remember:

> Git worktrees are code isolation, not an OS security sandbox.

---

# 16. Locking

Concurrent agents must not silently modify overlapping scope.

Before editing:

```text
acquire scope lock
```

Examples:

```text
src/Auth/**
package.json
branch feature/US-001
PR #123
```

On collision:

```text
wait
queue
or escalate
```

Do not silently race.

---

# 17. Policy Gates

Machine-readable policy has authority over agent suggestions.

Example outcomes:

```text
ALLOW
ASK
DENY
```

Protected/high-risk paths may include:

```text
.env
secrets
credentials
auth
payments
billing
migrations
production infrastructure
```

Never bypass a DENY because an LLM requested it.

---

# 18. Verification

Required deterministic checks may include:

```text
format
lint
build
unit tests
integration tests
custom verification
```

Store evidence.

A model statement such as:

```text
"tests should pass"
```

is not verification.

Use command exit codes/results.

---

# 19. Failure Classification

Before modifying source after a failure, classify it.

Possible classes:

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

Examples:

```text
ProviderFailure
→ retry/backoff/provider fallback

ContextFailure
→ compact/rebuild

PermissionFailure
→ human approval

FlakyTest
→ test retry/quarantine flow
→ do not blindly modify source
```

---

# 20. Context Management

Use OpenCode native compaction where available.

Agent Studio must preserve durable harness state separately.

Important data that must survive context compaction:

- goal
- Definition of Done
- requirements
- decisions
- TODO state
- attempts
- changed files
- tests
- verifier state
- blockers
- next action

When switching models, recalculate context budget.

Do not blindly send a context created for a 256k model to a 32k model.

---

# 21. MCP

MCP must continue to work normally through OpenCode.

Support:

```text
Global MCP
Project MCP
Local MCP
Remote MCP
Enable/Disable
Authentication
Permission
Connection Test
```

Do not create a separate incompatible MCP implementation.

---

# 22. Skills

Use OpenCode-compatible Skills.

Support:

```text
Global Skills
Project Skills
Import
Create
Install from Git
Enable/Disable
```

Do not introduce a proprietary Skills format unless technically necessary.

---

# 23. Subagents

Use OpenCode native delegation.

Support models/roles such as:

```text
Explorer
Implementer
Tester
Verifier
Custom Agent
```

Agents may use different models.

Show delegation in the UI.

Prevent unbounded recursion using configured delegation limits.

---

# 24. LLM Providers

Support:

- OpenAI-compatible endpoints
- LiteLLM
- localhost endpoints
- supported direct providers
- model selection per project
- model selection per agent/subagent

Credentials belong in macOS Keychain.

---

# 25. Jev Decision Engine

Jev is OPTIONAL.

Default:

```text
OFF
```

Configuration must support:

```text
Enable
API Key
OpenRouter-compatible Base URL/path
Model
Confidence Threshold
```

Do not hard-code provider details.

Jev may help route/model/delegation decisions.

Jev must never override:

- policy DENY
- attempt hard caps
- budgets
- user approval requirements

If Jev is unavailable, normal OpenCode workflow must continue.

---

# 26. Privacy

It is expected that relevant context may be sent to the configured LLM provider.

The privacy requirement is:

> Agent Studio itself must not secretly upload project files, prompts, or metadata to unrelated endpoints.

Do not add hidden telemetry.

If telemetry is ever added, it must be documented and opt-in by default unless product requirements explicitly change.

---

# 27. Budgets

Respect configured limits:

- attempts
- tokens
- model calls
- subagents
- duration
- concurrency

Do not allow an agent to self-increase hard limits.

When approaching limits:

```text
warn
reduce autonomy
stop spawning agents
pause
or escalate
```

according to policy.

---

# 28. Global Pause

Implement and respect:

```text
Pause All Agents
```

When paused:

- no new model calls
- no new tool mutations
- preserve state
- reconcile running operations safely

---

# 29. Do Not Ask Unnecessary Questions

If the specification already answers something, do not ask the user again.

When implementation details are missing:

1. inspect repository conventions
2. choose the simplest compatible approach
3. record the assumption
4. continue

Only block when proceeding would create a meaningful safety or architecture risk that cannot be resolved from the repository/specification.

---

# 30. Build and Test Discipline

Before marking a milestone complete:

1. run relevant formatter
2. run lint
3. run typecheck
4. run unit tests
5. run integration tests where applicable
6. build the application
7. inspect final diff
8. check for accidental secrets
9. check for unrelated modifications

If existing commands differ, use repository-native commands.

Do not disable tests to make the build pass.

---

# 31. Evidence Required

For every completed milestone, report:

```text
Milestone
Status

Files Changed
- ...

Implementation
- ...

Verification
- command
- result

Tests
- passed
- failed

Known Limitations
- ...

Next Milestone
- ...
```

Evidence must come from actual execution.

---

# 32. Commit Discipline

Unless repository instructions say otherwise:

- keep changes scoped
- avoid unrelated refactors
- make logically coherent commits
- do not force-push
- do not push automatically unless explicitly authorized

Do not expose secrets in commits.

---

# 33. Stop Conditions

Stop automatic work and escalate if:

- max attempts reached
- protected action needs human approval
- repository is corrupted/unrecoverable
- destructive migration is ambiguous
- required credential is missing
- verifier repeatedly rejects without progress
- a hard policy prevents continuation
- task goal/Definition of Done is fundamentally ambiguous and cannot be derived safely

Persist the current state before stopping.

---

# 34. Final Delivery

When the requested implementation scope is complete, provide:

```text
Implementation Summary

Completed Phases/Milestones

Architecture Decisions

Files Changed

Build/Test Results

Open Issues / Known Limitations

How to Run

How to Configure OpenCode

How to Configure LLM Provider

How to Configure MCP

How to Configure Skills

How to Configure Jev (optional)

Recommended Next Phase
```

Do not claim completion unless acceptance criteria for the requested phase pass.

---

# 35. Source Documents

Authoritative local documents:

```text
spec.md
implementation-phase-1.plan.md
implementation-phase-2.plan.md
implementation-phase-3.plan.md
implementation-phase-4.plan.md
implementation-phase-5.plan.md
```

Read these files before beginning implementation.

The specification also includes external design references, especially Loop Engineering and OpenCode documentation. Use those references when a design choice needs validation.

---

# 36. First Action

Begin with:

```text
1. Read spec.md completely.
2. Read all implementation phase plans.
3. Inspect the repository.
4. Determine current phase/milestone.
5. Create/update Task/TODO list.
6. Start from the first incomplete milestone.
7. Implement continuously.
8. Verify every milestone before moving forward.
```

Do not begin by rewriting the architecture.

Do not begin by generating large amounts of code before inspecting the repository.

Start by understanding the current state.
