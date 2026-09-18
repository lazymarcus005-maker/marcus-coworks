# Implementation Phase 2 Plan
## Harness Execution + Task/TODO + Verification

**Goal:** Turn the GUI wrapper into a reliable coding-agent harness with explicit goals, durable tasks, isolation, attempts, verification, and escalation.

### Scope

Build:

- Goal Contract
- complete Task/TODO lifecycle
- run/task state machine
- Attempt Ledger
- per-task/per-attempt Git worktrees
- Lock Manager
- deterministic verification pipeline
- independent verifier
- machine-readable policy/gates
- Human Inbox
- failure classification
- idempotency checks
- global/project pause

### P2.1 Goal Contract

Add fields:

```text
objective
scope
non_goals
constraints
done_when
risk
max_attempts
autonomy
```

GUI:

- Goal summary at top of Tasks panel
- expandable details
- edit before execution

Acceptance:

- goal persists
- task completion references Goal DoD

### P2.2 Task State Machine

Implement:

```text
CREATED
PLANNING
READY
RUNNING
TESTING
VERIFYING
RETRY
HUMAN_REQUIRED
DONE
FAILED
CANCELLED
INTERRUPTED
```

Persist every transition.

Acceptance:

- invalid transitions rejected
- UI reflects durable state, not inferred chat state

### P2.3 Attempt Ledger

Each repair/retry creates a new attempt record.

Enforce:

```text
default max attempts = 3
```

Acceptance:

- fourth attempt blocked by code
- max cap cannot be raised by agent
- Human Inbox receives escalation

### P2.4 Worktree Manager

Implement:

- create task branch/worktree
- manifest
- status
- safe cleanup
- stale reconciliation
- patch/diff capture

Suggested location:

```text
<repo>/.agent-studio/worktrees/
```

or managed external app storage if repository pollution is undesirable.

Acceptance:

- main working tree stays unchanged during isolated attempt
- rejected attempt can be discarded
- approved diff remains recoverable

### P2.5 Lock Manager

Lock:

- file/path globs
- branch/PR logical resource

Features:

- TTL
- owner
- wait
- stale detection

Acceptance:

- overlapping tasks cannot silently mutate same path
- waiting/conflict visible in UI

### P2.6 Machine-Readable Policy

Implement project/global policy parser.

Initial checks:

- protected paths
- human-approval paths
- max files
- Git push/force-push
- attempt limits
- verification requirement

Acceptance:

- DENY cannot be bypassed by agent prompt
- ASK creates approval item
- policy event is audited

### P2.7 Verification Pipeline

Support project commands:

```text
format
lint
build
test
custom verification
```

Normalize evidence.

Acceptance:

- evidence stored separately from chat
- failed deterministic checks prevent normal completion

### P2.8 Independent Verifier

Create verifier agent profile:

- fresh session/context
- read-only edit policy
- diff/evidence input
- structured result

Result:

```text
approve
reject
human_required
```

Acceptance:

- implementer cannot self-approve when verifier is required
- rejection creates new attempt or escalation

### P2.9 Failure Classifier

Implement rule-first classifier.

Categories:

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

Acceptance:

- provider failure does not automatically cause source edit
- context failure routes to compaction
- permission failure routes to Human Inbox

### P2.10 Human Inbox + Pause

Human Inbox:

- approvals
- exhausted attempts
- protected path
- ambiguity
- verifier rejection
- lock conflict

Global and project pause.

Acceptance:

- pause prevents new actions
- state remains recoverable

### Tests

- state machine tests
- attempt-cap tests
- worktree create/reject/cleanup
- lock collision tests
- policy allow/ask/deny
- verifier approval/rejection
- failure routing
- crash/restart while task active

### Exit Criteria

Phase 2 is done when a task can safely move from Goal → TODO → isolated implementation → deterministic tests → independent verifier → retry/escalate/done with complete evidence.
