import type { McpConnectionStatus, McpScope, McpServerConfig } from '@studio/shared'
import { createEffect, createSignal, For, Show } from 'solid-js'

/**
 * MCP management pane (spec §30): OpenCode-native server entries across
 * global and project scopes with enable/disable and connection tests.
 */
export function McpPane(props: { projectPath?: () => string | undefined }) {
  const [servers, setServers] = createSignal<McpServerConfig[]>([])
  const [testing, setTesting] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<Record<string, McpConnectionStatus>>({})
  const [error, setError] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal({
    name: '',
    type: 'local' as 'local' | 'remote',
    scope: 'project' as McpScope,
    command: '',
    url: '',
  })

  const refresh = async () => {
    const { servers: listed } = await window.studio.mcp.list(props.projectPath?.())
    setServers(listed)
  }

  createEffect(() => {
    void refresh()
  })

  async function add() {
    const d = draft()
    if (d.name.trim() === '') return
    try {
      await window.studio.mcp.save(
        {
          name: d.name.trim(),
          type: d.type,
          scope: d.scope,
          enabled: true,
          command: d.type === 'local' ? d.command.split(/\s+/).filter(Boolean) : undefined,
          url: d.type === 'remote' ? d.url.trim() || undefined : undefined,
        },
        d.scope === 'project' ? props.projectPath?.() : undefined,
      )
      setDraft({ ...draft(), name: '', command: '', url: '' })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function toggle(server: McpServerConfig) {
    await window.studio.mcp.setEnabled(
      server.name,
      server.scope,
      !server.enabled,
      server.scope === 'project' ? props.projectPath?.() : undefined,
    )
    await refresh()
  }

  async function remove(server: McpServerConfig) {
    await window.studio.mcp.remove(
      server.name,
      server.scope,
      server.scope === 'project' ? props.projectPath?.() : undefined,
    )
    await refresh()
  }

  async function test(server: McpServerConfig) {
    setTesting(server.name)
    try {
      const result = await window.studio.mcp.test(server.name)
      setStatus({ ...status(), [server.name]: result })
    } finally {
      setTesting(null)
    }
  }

  return (
    <div class="mcp-pane">
      <ul class="provider-list">
        <For each={servers()}>
          {(server) => (
            <li class="provider-row">
              <span class="provider-name">{server.name}</span>
              <span class="muted">{server.type}</span>
              <span class="badge">{server.scope}</span>
              <button
                type="button"
                class={`badge ${server.enabled ? 'badge-ok' : ''}`}
                onClick={() => toggle(server)}
                title="Toggle enabled"
              >
                {server.enabled ? 'enabled' : 'disabled'}
              </button>
              <span class="provider-url">{server.url ?? (server.command ?? []).join(' ')}</span>
              <span class="spacer" />
              <Show when={status()[server.name]}>
                {(result) => (
                  <span class={`badge ${result().ok ? 'badge-ok' : 'badge-status-active'}`}>
                    {result().ok ? '● connected' : `● ${result().detail}`}
                  </span>
                )}
              </Show>
              <button
                type="button"
                class="btn-ghost"
                disabled={testing() === server.name}
                onClick={() => test(server)}
              >
                Test
              </button>
              <button type="button" class="btn-ghost" onClick={() => remove(server)}>
                Delete
              </button>
            </li>
          )}
        </For>
      </ul>

      <form
        class="provider-form"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <h4>Add MCP server</h4>
        <div class="goal-edit-row">
          <label>
            Name
            <input
              required
              value={draft().name}
              onInput={(e) => setDraft({ ...draft(), name: e.currentTarget.value })}
            />
          </label>
          <label>
            Type
            <select
              value={draft().type}
              onChange={(e) =>
                setDraft({ ...draft(), type: e.currentTarget.value as 'local' | 'remote' })
              }
            >
              <option value="local">local</option>
              <option value="remote">remote</option>
            </select>
          </label>
          <label>
            Scope
            <select
              value={draft().scope}
              onChange={(e) => setDraft({ ...draft(), scope: e.currentTarget.value as McpScope })}
            >
              <option value="project">project</option>
              <option value="global">global</option>
            </select>
          </label>
        </div>
        <Show
          when={draft().type === 'local'}
          fallback={
            <label>
              URL
              <input
                value={draft().url}
                placeholder="https://mcp.example/sse"
                onInput={(e) => setDraft({ ...draft(), url: e.currentTarget.value })}
              />
            </label>
          }
        >
          <label>
            Command
            <input
              value={draft().command}
              placeholder="uvx docling-mcp"
              onInput={(e) => setDraft({ ...draft(), command: e.currentTarget.value })}
            />
          </label>
        </Show>
        <div class="form-actions">
          <button type="submit" class="btn-primary">
            Add server
          </button>
        </div>
        <Show when={error()}>
          {(message) => <div class="test-result test-fail">{message()}</div>}
        </Show>
      </form>
    </div>
  )
}
