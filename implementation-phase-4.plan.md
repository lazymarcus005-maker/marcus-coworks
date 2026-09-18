# Implementation Phase 4 Plan
## Privacy, Security, Network, Budgets, and Operational Hardening

**Goal:** Make data flow and operational limits inspectable and enforceable instead of trust-based.

### Scope

- network activity inspector
- outbound policy/allowlist architecture
- secret broker improvements
- audit export
- budget manager
- token/cost/run metrics
- failure/health dashboards
- readiness/doctor
- privacy defaults
- idempotency for external mutations
- notification discipline

### P4.1 Network Visibility

Capture/attribute where technically possible:

- project
- task
- session
- destination
- method
- byte count
- allowed/blocked

Do not claim packet-level certainty unless enforcement architecture actually provides it.

### P4.2 Network Policy

Implement supported enforcement path.

Profiles:

```text
Safe
Developer
Autonomous
Custom
```

Long-term preferred architecture:

```text
OpenCode Worker
   ↓
controlled egress/proxy
   ↓
allowed destinations
```

Acceptance:

- unknown destination can be blocked in hardened mode
- configured LLM traffic remains normal

### P4.3 Secret Broker

Reduce direct secret exposure.

Use Keychain-backed secrets and inject at request boundary where possible.

Acceptance:

- renderer never sees raw secrets
- audit redacts secret values

### P4.4 Budget Manager

Track:

- tokens
- model calls
- attempts
- subagents
- duration
- estimated cost

Threshold actions:

- warn
- stop new subagents
- downgrade to report
- pause
- human approval

Acceptance:

- hard cap cannot be self-raised by model

### P4.5 Audit Export

Export structured run package:

```text
goal
tasks
attempts
diff
test evidence
verifier decisions
policy decisions
activity summary
```

Avoid secrets/full sensitive payloads by default.

### P4.6 Harness Doctor

Check:

- OpenCode
- provider
- Git
- build/test commands
- policy
- verifier
- attempt limit
- budgets
- context metadata
- MCP
- Skills
- Keychain

Acceptance:

- actionable failures shown individually
- no misleading readiness score hiding critical failures

### P4.7 Idempotency

Before external changes:

- check duplicate branch
- check duplicate PR
- check existing task/issue
- use idempotency key where available

### P4.8 Notification Policy

Notify on:

- human action
- completion
- terminal error
- verification reject
- exhausted attempts
- budget/policy event

Do not spam normal internal progress.

### Exit Criteria

Phase 4 is done when the user can inspect and control the major trust boundaries: data egress, credentials, budget, external mutations, policy decisions, and run history.
