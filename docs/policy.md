# Policy gates

Policy is machine-readable and enforced by code — never by prompt text.

## Where

- **Project**: `agent-studio.policy.json` in the repository root
- **Default**: built-in safe defaults when no file exists (malformed
  files fall back to defaults too)

## Example

```json
{
  "version": 1,
  "protectedPaths": ["**/.env", "**/secrets/**"],
  "humanApprovalPaths": ["**/auth/**", "**/payments/**"],
  "changeLimits": { "maxFiles": 15, "maxAttempts": 3 },
  "git": { "commit": "ALLOW", "push": "ASK", "forcePush": "DENY", "deleteBranch": "ASK" },
  "verification": { "buildRequired": true, "testsRequired": true, "independentVerifier": true }
}
```

## Evaluation

Every gated action is evaluated to **ALLOW / ASK / DENY** before it
executes:

- **DENY** is absolute. Chat sends touching protected paths are blocked
  before reaching OpenCode; the denial is audited (`policy.denied`).
- **ASK** blocks the action and creates an approval item in the Human
  Inbox.
- Attempt caps and change limits are enforced before path rules.

Every decision is audited (`policy.check`). The engine is a pure function
— no model participates, and no model output can flip a DENY.
