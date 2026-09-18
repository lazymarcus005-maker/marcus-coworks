# Implementation Phase 5 Plan
## macOS Production Release + Evaluation + Advanced Isolation

**Goal:** Prepare Agent Studio for sustained daily use and production-quality macOS distribution.

### Scope

- signed/notarized macOS release
- updater
- crash recovery
- advanced per-project worker isolation
- sandbox/container option
- eval harness
- workflow templates
- performance profiling
- migration/backup
- production documentation

### P5.1 macOS Release

Produce:

- arm64 `.app`
- `.dmg`
- code signing
- Hardened Runtime
- notarization
- update feed

Acceptance:

- clean installation on supported Apple Silicon Mac
- upgrade preserves all user/project state

### P5.2 Recovery

Test crashes during:

- LLM call
- shell process
- worktree task
- verification
- compaction
- app shutdown

Acceptance:

- tasks become INTERRUPTED rather than incorrectly RUNNING
- stale locks/worktrees are reconciled

### P5.3 Advanced Isolation

Optional hardened runtime:

```text
Project
 ↓
sandboxed worker
 ↓
OpenCode
```

Possible implementation:

- container/Colima/Docker path
- macOS-compatible process/file restrictions
- controlled egress

Do not pretend Git worktrees are a security sandbox.

### P5.4 Evaluation Harness

Create internal task suite.

Measure:

```text
task success
tests passed
verifier acceptance
regression rate
attempts
tokens
duration
cost
human interventions
```

Include:

- bug fix
- feature
- refactor slice
- CI repair
- MCP task
- multi-project concurrency
- context compaction
- failure recovery

### P5.5 Workflow Templates

Ship:

- Bug Fix
- Feature
- Refactor Slice
- Review
- CI Repair
- Documentation

Templates configure Goal/Task/Verifier/Policy defaults.

### P5.6 Performance

Profile:

- Electron memory
- event volume
- SQLite
- file watcher
- OpenCode processes
- PTY
- large repos
- 5+ project tabs
- local LLM scheduling

### P5.7 Backup and Migration

Support:

- DB backup
- schema migration
- settings export excluding secrets
- worktree reconciliation

### P5.8 Documentation

Ship:

- installation
- first project
- provider config
- local LLM
- MCP
- Skills
- agent/subagent
- Task/TODO
- policy
- verifier
- privacy
- troubleshooting

### Exit Criteria

Phase 5 is done when Agent Studio is installable, upgradable, recoverable, evaluated, and suitable for sustained macOS daily development use.
