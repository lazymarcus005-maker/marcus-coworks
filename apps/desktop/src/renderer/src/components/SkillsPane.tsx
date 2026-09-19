import type { SkillInfo, SkillScope } from '@studio/shared'
import { createEffect, createSignal, For, Show } from 'solid-js'

/** Skills management pane (spec §31) over OpenCode-native SKILL.md folders. */
export function SkillsPane(props: { projectPath?: () => string | undefined }) {
  const [skills, setSkills] = createSignal<SkillInfo[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal<{
    name: string
    scope: SkillScope
    content: string
  } | null>(null)
  const [draft, setDraft] = createSignal({
    name: '',
    description: '',
    scope: 'project' as SkillScope,
    gitUrl: '',
  })

  const refresh = async () => {
    const { skills: listed } = await window.studio.skills.list(props.projectPath?.())
    setSkills(listed)
  }

  createEffect(() => {
    void refresh()
  })

  async function act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      setError(null)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function edit(skill: SkillInfo) {
    const { content } = await window.studio.skills.read(
      skill.name,
      skill.scope,
      skill.scope === 'project' ? props.projectPath?.() : undefined,
    )
    setEditing({ name: skill.name, scope: skill.scope, content })
  }

  return (
    <div class="mcp-pane">
      <ul class="provider-list">
        <For each={skills()}>
          {(skill) => (
            <li class="provider-row">
              <span class="provider-name">{skill.name}</span>
              <span class="badge">{skill.scope}</span>
              <button
                type="button"
                class={`badge ${skill.enabled ? 'badge-ok' : ''}`}
                onClick={() =>
                  act(() =>
                    window.studio.skills.setEnabled(
                      skill.name,
                      skill.scope,
                      !skill.enabled,
                      skill.scope === 'project' ? props.projectPath?.() : undefined,
                    ),
                  )
                }
              >
                {skill.enabled ? 'enabled' : 'disabled'}
              </button>
              <span class="provider-url">{skill.description ?? ''}</span>
              <span class="spacer" />
              <button type="button" class="btn-ghost" onClick={() => edit(skill)}>
                Edit
              </button>
            </li>
          )}
        </For>
      </ul>

      <Show
        when={!editing()}
        fallback={
          <div class="provider-form">
            <h4>
              Editing {editing()?.name} ({editing()?.scope})
            </h4>
            <textarea
              class="skill-editor"
              rows={14}
              value={editing()?.content ?? ''}
              onInput={(e) =>
                setEditing((current) =>
                  current ? { ...current, content: e.currentTarget.value } : current,
                )
              }
            />
            <div class="form-actions">
              <button
                type="button"
                class="btn-primary"
                onClick={() =>
                  act(async () => {
                    const current = editing()
                    if (!current) return
                    await window.studio.skills.write(
                      current.name,
                      current.scope,
                      current.content,
                      current.scope === 'project' ? props.projectPath?.() : undefined,
                    )
                    setEditing(null)
                  })
                }
              >
                Save
              </button>
              <button type="button" class="btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        }
      >
        <form
          class="provider-form"
          onSubmit={(e) => {
            e.preventDefault()
            void act(async () => {
              const d = draft()
              if (d.gitUrl.trim() !== '') {
                await window.studio.skills.installFromGit(
                  d.gitUrl.trim(),
                  d.scope,
                  d.scope === 'project' ? props.projectPath?.() : undefined,
                )
                return
              }
              await window.studio.skills.create(
                {
                  name: d.name.trim(),
                  scope: d.scope,
                  description: d.description.trim() || 'No description',
                },
                d.scope === 'project' ? props.projectPath?.() : undefined,
              )
            })
          }}
        >
          <h4>Create skill (or install from Git)</h4>
          <div class="goal-edit-row">
            <label>
              Name
              <input
                value={draft().name}
                onInput={(e) => setDraft({ ...draft(), name: e.currentTarget.value })}
              />
            </label>
            <label>
              Scope
              <select
                value={draft().scope}
                onChange={(e) =>
                  setDraft({ ...draft(), scope: e.currentTarget.value as SkillScope })
                }
              >
                <option value="project">project</option>
                <option value="global">global</option>
              </select>
            </label>
            <label>
              Git URL (optional)
              <input
                value={draft().gitUrl}
                placeholder="https://git.example/skills.git"
                onInput={(e) => setDraft({ ...draft(), gitUrl: e.currentTarget.value })}
              />
            </label>
          </div>
          <label>
            Description
            <input
              value={draft().description}
              placeholder="When this skill applies"
              onInput={(e) => setDraft({ ...draft(), description: e.currentTarget.value })}
            />
          </label>
          <div class="form-actions">
            <button type="submit" class="btn-primary">
              {draft().gitUrl.trim() !== '' ? 'Install from Git' : 'Create skill'}
            </button>
          </div>
          <Show when={error()}>
            {(message) => <div class="test-result test-fail">{message()}</div>}
          </Show>
        </form>
      </Show>
    </div>
  )
}
