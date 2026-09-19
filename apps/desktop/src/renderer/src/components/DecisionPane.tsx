import type { JevSettings } from '@studio/shared'
import { createEffect, createSignal, onMount, Show } from 'solid-js'

/** Decision Engine settings (spec §35): OFF by default, Keychain-backed. */
export function DecisionPane() {
  const [settings, setSettings] = createSignal<JevSettings | null>(null)
  const [apiKey, setApiKey] = createSignal('')
  const [status, setStatus] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  onMount(() => {
    void window.studio.decision.jevSettings().then(setSettings)
  })

  async function save(patch: Partial<JevSettings>) {
    if (!settings()) return
    setSettings(await window.studio.decision.saveJev(patch))
    setStatus('Saved.')
  }

  async function saveKey() {
    if (apiKey().trim() === '') return
    setBusy(true)
    try {
      setSettings(await window.studio.decision.setJevKey(apiKey()))
      setApiKey('')
      setStatus('API key stored in the macOS Keychain.')
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    setBusy(true)
    try {
      const result = await window.studio.decision.testJev()
      setStatus(result.ok ? `Connected — ${result.detail}` : `Failed — ${result.detail}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="provider-form">
      <h4>Decision Engine (Jev) — optional, OFF by default</h4>
      <Show when={settings()} fallback={<div class="muted">Loading…</div>}>
        {(s) => (
          <>
            <label class="jev-toggle">
              <input
                type="checkbox"
                checked={s().enabled}
                onChange={(e) => void save({ enabled: e.currentTarget.checked })}
              />
              Enable Decision Engine (advisory only — it can never override policy, attempt caps,
              budgets, or approvals)
            </label>
            <div class="goal-edit-row">
              <label>
                Base URL (OpenRouter-compatible)
                <input
                  value={s().baseUrl}
                  placeholder="https://openrouter.ai/api/v1"
                  onInput={(e) => setSettings({ ...s(), baseUrl: e.currentTarget.value })}
                  onBlur={(e) => void save({ baseUrl: e.currentTarget.value })}
                />
              </label>
              <label>
                Model
                <input
                  value={s().model}
                  placeholder="router/model"
                  onInput={(e) => setSettings({ ...s(), model: e.currentTarget.value })}
                  onBlur={(e) => void save({ model: e.currentTarget.value })}
                />
              </label>
              <label>
                Min confidence
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={s().minConfidence}
                  onInput={(e) =>
                    setSettings({ ...s(), minConfidence: Number(e.currentTarget.value) })
                  }
                  onBlur={(e) => void save({ minConfidence: Number(e.currentTarget.value) })}
                />
              </label>
            </div>
            <label>
              API key {s().apiKeySecretId ? '(stored in Keychain — enter to replace)' : ''}
              <input
                type="password"
                autocomplete="off"
                value={apiKey()}
                onInput={(e) => setApiKey(e.currentTarget.value)}
              />
            </label>
            <div class="form-actions">
              <button
                type="button"
                class="btn-ghost"
                disabled={busy()}
                onClick={() => void saveKey()}
              >
                Store key
              </button>
              <button
                type="button"
                class="btn-ghost"
                disabled={busy()}
                onClick={() => void testConnection()}
              >
                Test Connection
              </button>
            </div>
            <Show when={status()}>{(m) => <div class="muted">{m()}</div>}</Show>
          </>
        )}
      </Show>
    </div>
  )
}
