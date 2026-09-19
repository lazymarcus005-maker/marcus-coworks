import type { ContextUsage } from '@studio/shared'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'

/** Context usage panel + manual Compact Now (spec §27.8). */
export function ContextPanel(props: {
  sessionId: () => string | undefined
  model: () => string | undefined
}) {
  const [usage, setUsage] = createSignal<ContextUsage | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<string | null>(null)

  const refresh = async () => {
    const sessionId = props.sessionId()
    const model = props.model() ?? 'unknown'
    if (!sessionId) return
    try {
      setUsage(await window.studio.context.usage(sessionId, model))
    } catch {
      // Runtime may not be up yet — retry on the next tick.
    }
  }

  createEffect(() => {
    if (props.sessionId()) {
      void refresh()
      const timer = setInterval(() => void refresh(), 5_000)
      onCleanup(() => clearInterval(timer))
    }
  })

  async function compactNow() {
    const sessionId = props.sessionId()
    if (!sessionId) return
    setBusy(true)
    setMessage(null)
    try {
      await window.studio.context.compact(sessionId)
      setMessage('Compacted.')
      await refresh()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const percent = () => {
    const u = usage()
    if (!u || u.profile.contextWindow === 0) return 0
    return Math.min(100, Math.round((u.estimatedActiveTokens / u.profile.contextWindow) * 100))
  }

  return (
    <div class="agent-tree">
      <div class="tasks-header">
        <h3>Context</h3>
        <Show when={usage()}>
          {(u) => (
            <span class="muted">
              {percent()}% · {u().profile.source}
            </span>
          )}
        </Show>
      </div>
      <Show
        when={usage()}
        fallback={<div class="muted tasks-empty-goal">Session context appears when chatting.</div>}
      >
        {(u) => (
          <div class="context-body">
            <div class="context-row">
              <span class="muted">Model</span>
              <span class="context-value">{u().profile.model}</span>
            </div>
            <div class="context-row">
              <span class="muted">Window</span>
              <span class="context-value">{u().profile.contextWindow.toLocaleString()}</span>
            </div>
            <div class="context-row">
              <span class="muted">Est. active</span>
              <span class="context-value">{u().estimatedActiveTokens.toLocaleString()}</span>
            </div>
            <div class="context-row">
              <span class="muted">Reserve</span>
              <span class="context-value">{u().safetyReserve.toLocaleString()}</span>
            </div>
            <div class="context-bar">
              <div class="context-bar-fill" style={`width: ${percent()}%`} />
            </div>
            <Show when={u().lastCompactedAt}>
              {(at) => (
                <div class="context-row">
                  <span class="muted">Last compacted</span>
                  <span class="context-value">{new Date(at()).toLocaleTimeString()}</span>
                </div>
              )}
            </Show>
            <button
              type="button"
              class="btn-ghost btn-small"
              disabled={busy()}
              onClick={() => compactNow()}
            >
              Compact Now
            </button>
            <Show when={message()}>{(m) => <div class="muted">{m()}</div>}</Show>
          </div>
        )}
      </Show>
    </div>
  )
}
