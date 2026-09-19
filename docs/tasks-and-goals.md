# Tasks, TODO & the goal contract

## Task/TODO panel

The right-hand panel shows the durable task store. Tasks carry one of the
run states (`created → planning → ready → running → testing → verifying →
done/rejected/human_required`, plus `failed`, `cancelled`, `interrupted`,
and the quick statuses `pending`/`in_progress`/`blocked`/`waiting`).
Every transition is persisted to the `task_transitions` audit table with
a reason.

- Click a task's status icon to advance it.
- Add tasks with the input at the bottom; cancel with `×`.
- Tasks with an **agent** badge were synced from OpenCode's native TODO
  list — one task system, not two.

## Goal contract

Substantial requests create a Goal draft. Expand it to see and edit:

- **Objective**, **Scope** (globs), **Non-goals**, **Constraints**
- **Definition of Done** — the criteria a reviewer will check
- **Risk**, **Max attempts** (1–10), **Autonomy**

Structural fields lock once the goal is **ready**; mark it ready, then
**Start goal** to activate. Completing a goal-linked task records which
DoD criteria remain unverified.

## Attempt ledger

Every retry creates an attempt record (model, worktree, outcome, failure
class, evidence). The cap comes from the goal contract clamped by policy
(default 3). At the cap the task flips to **HUMAN_REQUIRED** and lands in
the Human Inbox with the full history linked.
