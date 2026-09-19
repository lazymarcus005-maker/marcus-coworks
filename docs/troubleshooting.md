# Troubleshooting

## "OpenCode binary not found"

Install the CLI (`curl -fsSL https://opencode.ai/install | bash`) or
ensure `opencode` is on `PATH` / at `~/.opencode/bin/opencode`. Check
Settings → Doctor.

## Chat send fails with "Blocked by policy"

The policy engine denied the message (e.g. it references a protected path
like `.env`). This is by design — see [policy.md](policy.md). Adjust the
project's `agent-studio.policy.json` if the block is wrong.

## Chat send fails with "Approval required"

A policy rule marked the action ASK. Open the **Human Inbox** (header)
and approve or reject the item.

## Task stuck in HUMAN_REQUIRED

All attempts were used (default 3) or the verifier escalated. Review the
attempt history and evidence, then resolve the inbox item — an approval
resumes the task into `running`.

## Terminal shows nothing / PTY errors

npm can strip the exec bit from node-pty's `spawn-helper`. Run
`npm install` again (the postinstall script fixes it), or
`chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`.

## A task shows INTERRUPTED after a crash

That is correct behavior — the app crashed while the task was in flight.
Re-run the task; stale locks and worktrees were reconciled automatically
at startup.

## Provider test fails but the endpoint works elsewhere

Check the base URL ends before `/chat/completions` (e.g. `…/v1`), the
profile type matches (`localhost` must target 127.0.0.1), and the Network
profile isn't blocking the host (Settings → Network).

## Reset everything

Quit the app and delete
`~/Library/Application Support/OpenCode Agent Studio/`. Source
repositories are never touched.
