# Verification & the independent verifier

## Deterministic pipeline

After implementation, Agent Studio runs the configured verification
commands (format → lint → build → test → custom). Each run stores
**evidence**: command, exit code, parsed pass/fail counts, duration, a
bounded summary, and a reference to the full output log (kept in app
storage, never in chat).

A failing **required** check stops the pipeline and mechanically blocks
completion — the task cannot reach `done` until a passing run is recorded
(the `completionGate`). A model claiming "tests should pass" changes
nothing.

Shell runs go through the Scheduler's `shell` pool (default concurrency
4).

## Independent verifier

When review is required, the verifier:

1. opens a **fresh OpenCode session** (never the implementer's session —
   enforced by identity),
2. receives the worktree diff, the goal's Definition of Done, and the
   deterministic evidence,
3. replies with a structured decision: `approve`, `reject`, or
   `human_required` with reasons and failed criteria.

Guarantees:

- Unparseable replies fail safe to `human_required` — never approve.
- The verifier is read-only: if it modifies the worktree, the review is
  invalidated and escalated as security-sensitive.
- Approval alone cannot complete a task without deterministic evidence.
- Rejection drives the retry loop; at the attempt cap everything lands in
  the Human Inbox.

Failure classification (rule-first, twelve categories) decides recovery:
flaky tests are retried, provider failures back off, context failures
compact, permission failures escalate — source edits are never the
default response to non-implementation failures.
