import type { ConnectionTestResult, LlmProvider, ProviderType } from '@studio/shared'
import { createResource, createSignal, For, Show } from 'solid-js'

type Draft = {
  id?: string
  name: string
  type: ProviderType
  baseUrl: string
  defaultModel: string
  apiKey: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  type: 'openai-compatible',
  baseUrl: '',
  defaultModel: '',
  apiKey: '',
}

import { McpPane } from './McpPane.js'

export function SettingsModal(props: {
  onClose: () => void
  projectPath?: () => string | undefined
}) {
  const [providers, { refetch }] = createResource(
    async () => (await window.studio.providers.list()).providers,
  )
  const [draft, setDraft] = createSignal<Draft>({ ...EMPTY_DRAFT })
  const [testResult, setTestResult] = createSignal<ConnectionTestResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  function editExisting(provider: LlmProvider) {
    setDraft({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel ?? '',
      apiKey: '',
    })
    setTestResult(null)
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const d = draft()
      await window.studio.providers.save(
        {
          id: d.id,
          name: d.name,
          type: d.type,
          baseUrl: d.baseUrl,
          defaultModel: d.defaultModel || undefined,
        },
        d.apiKey || undefined,
      )
      setDraft({ ...EMPTY_DRAFT })
      setTestResult(null)
      await refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    setBusy(true)
    setTestResult(null)
    try {
      const d = draft()
      // Editing a saved provider without retyping the key: let main test
      // with the stored secret so the key never transits the renderer.
      const result =
        d.id && !d.apiKey
          ? await window.studio.providers.testSaved(d.id)
          : await window.studio.providers.test(d.baseUrl, d.apiKey || undefined)
      setTestResult(result)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await window.studio.providers.remove(id)
      await refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="modal-backdrop" onClick={() => props.onClose()}>
      <div class="modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Settings</h2>
          <button type="button" class="btn-ghost" onClick={() => props.onClose()}>
            Close
          </button>
        </div>
        <div class="modal-body">
          <section class="settings-section">
            <h3>MCP Servers</h3>
            <McpPane projectPath={props.projectPath} />
          </section>
          <section class="settings-section">
            <h3>LLM Providers</h3>
            <Show when={(providers() ?? []).length > 0}>
              <ul class="provider-list">
                <For each={providers()}>
                  {(provider) => (
                    <li class="provider-row">
                      <span class="provider-name">{provider.name}</span>
                      <span class="muted">{provider.type}</span>
                      <span class="provider-url">{provider.baseUrl}</span>
                      <Show when={provider.apiKeySecretId}>
                        <span class="badge badge-ok" title="API key stored in macOS Keychain">
                          🔑 Keychain
                        </span>
                      </Show>
                      <Show when={provider.defaultModel}>
                        {(model) => <span class="badge">{model()}</span>}
                      </Show>
                      <span class="spacer" />
                      <button
                        type="button"
                        class="btn-ghost"
                        onClick={() => editExisting(provider)}
                      >
                        Edit
                      </button>
                      <button type="button" class="btn-ghost" onClick={() => remove(provider.id)}>
                        Delete
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <form
              class="provider-form"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <h4>{draft().id ? 'Edit provider' : 'Add provider'}</h4>
              <label>
                Name
                <input
                  required
                  value={draft().name}
                  placeholder="Company LiteLLM"
                  onInput={(e) => setDraft({ ...draft(), name: e.currentTarget.value })}
                />
              </label>
              <label>
                Type
                <select
                  value={draft().type}
                  onChange={(e) =>
                    setDraft({ ...draft(), type: e.currentTarget.value as ProviderType })
                  }
                >
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="litellm">LiteLLM</option>
                  <option value="localhost">localhost</option>
                </select>
              </label>
              <label>
                Base URL
                <input
                  required
                  value={draft().baseUrl}
                  placeholder={
                    draft().type === 'localhost'
                      ? 'http://127.0.0.1:8000/v1'
                      : 'https://llm.example.com/v1'
                  }
                  onInput={(e) => setDraft({ ...draft(), baseUrl: e.currentTarget.value })}
                />
              </label>
              <label>
                Default model
                <input
                  value={draft().defaultModel}
                  placeholder="qwen3.6-35b-a3b"
                  onInput={(e) => setDraft({ ...draft(), defaultModel: e.currentTarget.value })}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={draft().apiKey}
                  placeholder={draft().id ? 'unchanged' : 'sk-…'}
                  autocomplete="off"
                  onInput={(e) => setDraft({ ...draft(), apiKey: e.currentTarget.value })}
                />
              </label>
              <p class="muted form-hint">
                The key is stored in the macOS Keychain; only a secret reference is saved in app
                storage.
              </p>
              <div class="form-actions">
                <button type="submit" class="btn-primary" disabled={busy()}>
                  Save
                </button>
                <button
                  type="button"
                  class="btn-ghost"
                  disabled={busy()}
                  onClick={() => testConnection()}
                >
                  Test Connection
                </button>
                <Show when={draft().id}>
                  <button
                    type="button"
                    class="btn-ghost"
                    onClick={() => setDraft({ ...EMPTY_DRAFT })}
                  >
                    Cancel edit
                  </button>
                </Show>
              </div>
              <Show when={testResult()}>
                {(result) => (
                  <div class={`test-result ${result().ok ? 'test-ok' : 'test-fail'}`}>
                    {result().ok
                      ? `Connected — ${result().models?.length ?? 0} models visible`
                      : `Failed — ${result().error ?? 'unknown error'}`}
                  </div>
                )}
              </Show>
              <Show when={error()}>
                {(message) => <div class="test-result test-fail">{message()}</div>}
              </Show>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
