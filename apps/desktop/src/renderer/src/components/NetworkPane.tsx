import type { NetworkEvent, NetworkProfileName } from '@studio/shared'
import { createEffect, createSignal, For, Show } from 'solid-js'

/** Network activity inspector + profile selector (P4.1–4.2). */
export function NetworkPane() {
  const [events, setEvents] = createSignal<NetworkEvent[]>([])
  const [profile, setProfile] = createSignal<NetworkProfileName>('developer')
  const [allowlist, setAllowlist] = createSignal('')

  const refresh = async () => {
    const [{ events: listed }, policy] = await Promise.all([
      window.studio.network.list(100),
      window.studio.network.policy(),
    ])
    setEvents(listed)
    setProfile(policy.profile)
    setAllowlist(policy.customAllowlist.join('\n'))
  }

  createEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3_000)
    onCleanup(() => clearInterval(timer))
  })

  async function changeProfile(next: NetworkProfileName) {
    setProfile(next)
    const policy = await window.studio.network.setPolicy({ profile: next })
    setProfile(policy.profile)
  }

  async function saveAllowlist() {
    await window.studio.network.setPolicy({
      customAllowlist: allowlist()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    })
    await refresh()
  }

  return (
    <div class="mcp-pane">
      <div class="goal-edit-row">
        <label>
          Profile
          <select
            value={profile()}
            onChange={(e) => void changeProfile(e.currentTarget.value as NetworkProfileName)}
          >
            <option value="safe">Safe (allowlist-only: LLM + localhost)</option>
            <option value="developer">Developer (warn on unknown)</option>
            <option value="autonomous">Autonomous (allow all, record)</option>
            <option value="custom">Custom (explicit allowlist)</option>
          </select>
        </label>
      </div>
      <Show when={profile() === 'custom'}>
        <label>
          Custom allowlist (one host per line)
          <textarea
            class="skill-editor"
            rows={3}
            value={allowlist()}
            onInput={(e) => setAllowlist(e.currentTarget.value)}
          />
        </label>
        <button type="button" class="btn-ghost btn-small" onClick={() => void saveAllowlist()}>
          Save allowlist
        </button>
      </Show>
      <p class="muted form-hint">
        Scope: HTTP traffic Agent Studio itself initiates (provider and decision-engine calls).
        OpenCode's own process egress needs the worker-proxy architecture (advanced isolation).
      </p>
      <ul class="provider-list">
        <For each={events()}>
          {(event) => (
            <li class="provider-row">
              <span class={`badge ${event.allowed ? 'badge-ok' : 'badge-kind-attempts-exhausted'}`}>
                {event.allowed ? 'ALLOWED' : 'BLOCKED'}
              </span>
              <span class="provider-url">{event.destination}</span>
              <span class="badge">{event.category}</span>
              <span class="badge">{event.method}</span>
              <Show when={event.bytes}>{(bytes) => <span class="badge">{bytes()} B</span>}</Show>
              <span class="spacer" />
              <span class="muted">{new Date(event.createdAt).toLocaleTimeString()}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
