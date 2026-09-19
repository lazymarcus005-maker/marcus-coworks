import { For, Show } from 'solid-js'
import type { ProjectsStore } from '../state/projects.js'

const STATUS_DOT: Record<string, string> = {
  idle: 'dot-idle',
  running: 'dot-running',
  waiting: 'dot-waiting',
  testing: 'dot-running',
  verifying: 'dot-running',
  blocked: 'dot-attention',
  error: 'dot-error',
  interrupted: 'dot-attention',
}

export function TabsBar(props: { store: ProjectsStore }) {
  const store = props.store

  return (
    <div class="tabs-bar">
      <div class="tabs-tabs" role="tablist">
        <For each={store.tabs()}>
          {(tab) => {
            const project = () => store.projectById(tab.projectId)
            return (
              <Show when={project()}>
                {(p) => (
                  <div
                    role="tab"
                    tabindex={0}
                    aria-selected={store.activeId() === tab.projectId}
                    class={`tab ${store.activeId() === tab.projectId ? 'tab-active' : ''}`}
                    onClick={() => store.activateTab(tab.projectId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') store.activateTab(tab.projectId)
                    }}
                  >
                    <span class={`dot ${STATUS_DOT[p().status] ?? 'dot-idle'}`} />
                    <span class="tab-name">{p().name}</span>
                    <button
                      type="button"
                      class="tab-close"
                      title="Close tab (project stays registered)"
                      aria-label={`Close ${p().name} tab`}
                      onClick={(event) => {
                        event.stopPropagation()
                        store.closeTab(tab.projectId)
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </Show>
            )
          }}
        </For>
      </div>

      <details class="tabs-add-menu">
        <summary class="tabs-add" title="Add or reopen a project">
          +
        </summary>
        <div class="menu">
          <button type="button" class="menu-item" onClick={() => store.addFromPicker()}>
            Add Project…
          </button>
          <Show when={store.closedProjects().length > 0}>
            <div class="menu-separator" />
            <div class="menu-label">Reopen</div>
            <For each={store.closedProjects()}>
              {(project) => (
                <button
                  type="button"
                  class="menu-item"
                  onClick={(event) => {
                    store.openTab(project.id)
                    event.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                >
                  {project.name}
                </button>
              )}
            </For>
          </Show>
        </div>
      </details>
    </div>
  )
}
