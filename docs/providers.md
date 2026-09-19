# LLM providers

Open the settings (⚙) → **LLM Providers**.

## Provider types

| Type | Use for |
|---|---|
| `openai-compatible` | Any OpenAI-compatible endpoint (vLLM, LiteLLM, a company gateway) |
| `litellm` | A LiteLLM proxy |
| `localhost` | Local servers (oMLX, LM Studio, llama.cpp) — base URL must be `127.0.0.1`/`localhost` |

## Fields

- **Base URL** — e.g. `http://127.0.0.1:8000/v1` or
  `https://llm.company.local/v1`
- **Default model** — model id the endpoint reports
- **API key** — stored in the **macOS Keychain**; only a `secret://…`
  reference is written to app storage. The renderer never sees key
  material; connectivity tests with a stored key run entirely in the
  main process.

**Test Connection** hits the endpoint's `/models` route and lists what it
sees.

## How OpenCode uses them

Provider credentials for the agent runtime itself are managed by
OpenCode's own auth (`opencode auth login` in a terminal). Agent Studio's
provider config drives its own provider-side features (connectivity,
routing advice); both read the same endpoints.

## Local models

A localhost endpoint is a first-class citizen. Concurrency for local
requests defaults to **1** (Scheduler panel) so a single local model
serves multiple projects serially while remote projects proceed in
parallel.
