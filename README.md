# Marcus Coworks — OpenCode Agent Studio

A macOS-first, Apple-Silicon-first desktop coding-agent workspace that wraps
[OpenCode](https://opencode.ai) with a Cowork-style multi-project harness:
Goal Contracts, durable Task/TODO state, maker/verifier workflows, per-task
Git worktree isolation, attempt tracking, policy gates, budgets, and a human
escalation inbox.

## Status

Pre-implementation. Work is tracked in the
[issue tracker](https://github.com/lazymarcus005-maker/marcus-coworks/issues)
as tracer-bullet tickets organized into five phases.

## Authoritative documents

Read in this order before contributing:

1. [`spec.md`](./spec.md) — full product & technical specification (authoritative)
2. [`implementation-phase-1.plan.md`](./implementation-phase-1.plan.md) — Foundation + Multi-Project Cowork UI
3. [`implementation-phase-2.plan.md`](./implementation-phase-2.plan.md) — Harness Execution + Task/TODO + Verification
4. [`implementation-phase-3.plan.md`](./implementation-phase-3.plan.md) — Agent Ecosystem + Context + Decision Routing
5. [`implementation-phase-4.plan.md`](./implementation-phase-4.plan.md) — Privacy + Security + Operational Hardening
6. [`implementation-phase-5.plan.md`](./implementation-phase-5.plan.md) — macOS Production + Evaluation + Isolation

[`handoff.md`](./handoff.md) describes the operating discipline for agents
implementing this repository (inspection-first, verify every milestone,
evidence required).

If a phase plan conflicts with `spec.md`, follow `spec.md` unless the
repository contains a newer explicit decision.
