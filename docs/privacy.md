# Privacy & data flow

## The one expected flow

```
project context → your configured LLM endpoint
```

Sending code context to the LLM provider you configured is the product.
That is the trust boundary you control.

## What Agent Studio promises

- **No hidden telemetry.** Agent Studio makes no calls to any service
  except the endpoints you configure (provider tests, connectivity,
  decision-engine advice). Every outbound attempt is recorded in the
  Network pane — including blocked ones.
- **No secret leakage.** API keys live in the macOS Keychain. Only
  `secret://…` references cross to the renderer; audit records are
  scrubbed of issued values by the secret broker.
- **No unrelated uploads.** Nothing is sent to "phone home" services,
  crash reporters, or analytics.

## Network policy

Settings → **Network** profiles control app-initiated egress:

- **Safe** — only LLM + localhost destinations allowed; everything else
  blocked before a connection is attempted
- **Developer** — allow known categories, permit-and-record unknown
- **Autonomous** — allow all, record everything
- **Custom** — your explicit allowlist

Honest scope: the gate covers HTTP traffic **Agent Studio itself
initiates** (provider tests, decision-engine calls). OpenCode runs its
own processes; restricting those requires the container-worker option
(Settings → Isolation, optional) — and even then, **Git worktrees are
code isolation, not a security sandbox.**
