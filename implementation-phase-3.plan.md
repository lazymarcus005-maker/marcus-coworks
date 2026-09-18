# Implementation Phase 3 Plan
## Agent Ecosystem + Context + Decision Routing

**Goal:** Add full MCP/Skills/subagent management, model-aware long-session handling, richer scheduling, and optional Jev routing.

### Scope

- MCP Manager
- Skills Manager
- Agent/subagent manager
- Agent tree
- model per agent
- context usage/compaction UI
- context checkpoint enrichment with harness state
- scheduler/resource controls
- autonomy levels
- model modes
- Decision Engine abstraction
- Jev optional provider

### P3.1 MCP Manager

Support:

- global/project scope
- local/remote MCP
- enabled state
- auth state
- permissions
- connection test

Acceptance:

- project A MCP config does not affect project B override
- disabled MCP unavailable to agent
- connection failure visible

### P3.2 Skills Manager

Support OpenCode-compatible Skills.

Operations:

- discover
- import
- create
- edit
- install from Git
- enable/disable
- agent permissions

Acceptance:

- no proprietary format required
- OpenCode can load installed Skill normally

### P3.3 Agent/Subagent Manager

Support:

- primary
- explorer
- implementer
- tester
- verifier
- custom agents

Per-agent:

- model
- permissions
- MCP
- Skills
- write access
- delegation targets

Acceptance:

- subagent model may differ from parent
- delegation tree visible

### P3.4 Context Manager

Use OpenCode compaction as base.

Add:

- model profile
- input/context/output metadata
- context usage panel
- manual Compact Now
- model switch recalculation
- compaction audit
- project/task state injected into compaction where supported

Acceptance:

- long session compacts before overflow
- Goal/TODO/attempt/DoD survive compaction
- smaller model switch safely rebuilds context

### P3.5 Scheduler

Control:

```text
max active project agents
max subagents/project
max remote requests
max local requests
max shell jobs
priority
cancel
```

Acceptance:

- local LLM concurrency 1 can coexist with multiple project tasks
- waiting queue visible

### P3.6 Autonomy + Model Mode

Autonomy:

```text
L0 Manual
L1 Report
L2 Assisted
L3 Autonomous
```

Model:

```text
Auto
Fast
Quality
Manual
```

Acceptance:

- autonomy changes allowed actions, not merely prompt text

### P3.7 Decision Engine

Create generic interface.

Providers:

- Disabled
- Jev
- rule-based placeholder
- future structured LLM

Hard policy remains outside Decision Engine.

### P3.8 Jev

Settings:

- enable toggle
- custom OpenRouter-compatible Base URL
- API key
- model
- confidence threshold

Potential decisions:

- complexity
- model route
- verifier requirement
- delegation
- escalation suggestion

Acceptance:

- OFF by default
- failure falls back safely
- cannot override policy/attempt/budget hard limits

### Tests

- MCP project isolation
- Skill discovery
- subagent model routing
- compaction preservation
- context model switch
- scheduler queue
- Jev on/off/failure fallback

### Exit Criteria

Phase 3 is done when Agent Studio fully exposes the OpenCode ecosystem and can sustain long multi-agent/multi-project work with controlled context and optional model routing.
