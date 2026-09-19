import type { AgentProfile } from '@studio/shared'
import { createEffect, createSignal, For, Show } from 'solid-js'

/** Agent profile CRUD (spec §32) over OpenCode's native agent config. */
export function AgentsPane(props: { projectPath?: () => string | undefined }) {
  const [profiles, setProfiles] = createSignal<AgentProfile[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal({
    name: '',
    mode: 'subagent' as AgentProfile['mode'],
    model: '',
    description: '',
  })

  const refresh = async () => {
    const path = props.projectPath?.()
    if (!path) return
    const { profiles: listed } = await window.studio.agents.list(path)
    setProfiles(listed)
  }

  createEffect(() => {
    void refresh()
  })

  async function save() {
    const path = props.projectPath?.()
    const d = draft()
    if (!path || d.name.trim() === '') return
    try {
      await window.studio.agents.save(
        {
          name: d.name.trim(),
          mode: d.mode,
          model: d.model.trim() || undefined,
          description: d.description.trim() || undefined,
        },
        path,
      )
      setDraft({ ...draft(), name: '', model: '', description: '' })
      setError(null)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div class="mcp-pane">
      <ul class="provider-list">
        <For each={profiles()}>
          {(profile) => (
            <li class="provider-row">
              <span class="provider-name">{profile.name}</span>
              <span class="badge">{profile.mode}</span>
              <Show when={profile.model}>{(model) => <span class="badge">{model()}</span>}</Show>
              <span class="provider-url">{profile.description ?? ''}</span>
              <span class="spacer" />
              <button
                type="button"
                class="btn-ghost"
                onClick={() =>
                  void window.studio.agents
                    .remove(profile.name, props.projectPath?.() ?? '')
                    .then(refresh)
                }
              >
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
          void save()
        }}
      >
        <h4>Add agent profile</h4>
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
            Mode
            <select
              value={draft().mode}
              onChange={(e) =>
                setDraft({ ...draft(), mode: e.currentTarget.value as AgentProfile['mode'] })
              }
            >
              <option value="primary">primary</option>
              <option value="subagent">subagent</option>
              <option value="all">all</option>
            </select>
          </label>
          <label>
            Model (provider/model)
            <input
              value={draft().model}
              placeholder="openai/gpt-5-mini"
              onInput={(e) => setDraft({ ...draft(), model: e.currentTarget.value })}
            />
          </label>
        </div>
        <label>
          Description
          <input
            value={draft().description}
            onInput={(e) => setDraft({ ...draft(), description: e.currentTarget.value })}
          />
        </label>
        <div class="form-actions">
          <button type="submit" class="btn-primary">
            Save agent
          </button>
        </div>
        <Show when={error()}>
          {(message) => <div class="test-result test-fail">{message()}</div>}
        </Show>
      </form>
    </div>
  )
}
