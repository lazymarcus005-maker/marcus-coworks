# Installation

## Requirements

- macOS on Apple Silicon (M1–M4)
- Node.js ≥ 22 (for development)
- The [OpenCode CLI](https://opencode.ai) — Agent Studio finds it on
  `PATH`, at `~/.opencode/bin/opencode`, or in Homebrew's prefix
- At least one LLM endpoint: a local OpenAI-compatible server or a
  remote provider (see [providers.md](providers.md))

Full Disk Access is **not** required. Agent Studio touches only its own
user-data directory and the project folders you register.

## Development

```sh
git clone https://github.com/lazymarcus005-maker/marcus-coworks.git
cd marcus-coworks
npm install
npm run dev          # launch the desktop app in dev mode
```

## Production build

```sh
npm run build          # bundle main/preload/renderer
npm run dist           # arm64 .app + .dmg + .zip into apps/desktop/release/
npm run dist:dir       # unsigned .app only (no cert needed)
```

Code signing and notarization activate automatically when these
environment variables are present:

```sh
export CSC_LINK=...                          # Developer ID Application cert
export CSC_KEYCHAIN_PASSWORD=...
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
```

Without them the artifact is ad-hoc signed — fine for local use.

## First run

The app stores everything in `~/Library/Application Support/
OpenCode Agent Studio/` (Electron userData): a SQLite database
(`studio.db`), verification logs, and settings. Deleting that folder
resets Agent Studio entirely; your source repositories are never touched.
