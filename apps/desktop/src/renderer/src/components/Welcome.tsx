import { createResource, Show } from 'solid-js'
import type { ProjectsStore } from '../state/projects.js'

export function Welcome(props: { store: ProjectsStore }) {
  const [health] = createResource(() => window.studio.app.health())

  return (
    <div class="welcome">
      <h1>OpenCode Agent Studio</h1>
      <p>Register a repository to start a coworking session.</p>
      <button type="button" class="btn-primary" onClick={() => props.store.addFromPicker()}>
        Add Project…
      </button>
      <Show when={health()}>
        {(info) => (
          <p class="muted welcome-health">
            Electron {info().electronVersion} · Node {info().nodeVersion} · {info().platform}/
            {info().arch}
          </p>
        )}
      </Show>
    </div>
  )
}
