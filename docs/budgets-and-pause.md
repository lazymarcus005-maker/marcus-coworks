# Budgets & the kill switch

## Budgets (⚙ → Budgets)

Set **daily token budgets** and **daily model-call budgets** per project.
Usage is recorded from runtime-reported token counters and model calls;
counters reset each day.

Thresholds:

| Usage | Action |
|---|---|
| > 80% of token budget | warn (audited) |
| > 100% of token budget | the project **auto-pauses** |
| > model-call budget | autonomy downgrades to **L1 Report** |

Caps are hard: only you can raise them, through this settings pane. No
agent, model, or decision-engine output can change a budget.

## Kill switch

The header **⏸ Pause All Agents** button (plus per-project **⏸ Pause**):

- blocks new model calls (chat sends) and new attempts immediately
- tears down the project's terminal processes
- reconciles locks
- persists — after a restart everything stays paused until **you** resume

Resume is always explicit: **▶ Resume All** or per-project **▶ Resume**.

## Autonomy levels

Per-project (header dropdown), enforced by code:

- **L0 Manual** — nothing automatic
- **L1 Report** — inspect and plan only (this is what budget downgrade
  selects)
- **L2 Assisted** — attempts, verification, verifier (default)
- **L3 Autonomous** — same gates as L2 plus fewer confirmations; still
  bounded by policy, caps, budgets, locks, and the kill switch
