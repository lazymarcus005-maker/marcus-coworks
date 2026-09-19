import { createResource, createSignal, onMount, Show } from 'solid-js'
import { InboxBell } from './components/InboxBell.js'
import { PauseButton } from './components/PauseControls.js'
import { ProjectView } from './components/ProjectView.js'
import { SettingsModal } from './components/SettingsModal.js'
import { TabsBar } from './components/TabsBar.js'
import { Welcome } from './components/Welcome.js'
import { createProjectsStore } from './state/projects.js'

export default function App() {
  const store = createProjectsStore()
  const [ready] = createResource(() => store.refresh())
  const [settingsOpen, setSettingsOpen] = createSignal(false)

  onMount(() => {
    const timer = setInterval(() => store.refresh(), 5_000)
    return () => clearInterval(timer)
  })

  return (
    <div class="app">
      <header class="app-header">
        <div class="app-title">OpenCode Agent Studio</div>
        <Show when={store.error()}>
          {(message) => (
            <div class="app-error" role="alert">
              {message()}
            </div>
          )}
        </Show>
        <span class="spacer" />
        <PauseButton />
        <InboxBell />
        <button
          type="button"
          class="btn-ghost"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </header>
      <TabsBar store={store} />
      <main class="app-main">
        <Show
          when={!ready.loading}
          fallback={<div class="muted loading">Restoring workspace…</div>}
        >
          <Show when={store.activeProject()} fallback={<Welcome store={store} />}>
            {(project) => <ProjectView project={project()} store={store} />}
          </Show>
        </Show>
      </main>
      <Show when={settingsOpen()}>
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      </Show>
    </div>
  )
}
