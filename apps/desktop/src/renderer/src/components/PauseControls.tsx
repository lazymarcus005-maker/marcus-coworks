import type { PauseState } from '@studio/shared'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'

/**
 * Global kill switch (spec §26): visible, persisted, and blocking — when
 * paused, no new model calls or tool mutations start anywhere.
 */
export function PauseButton() {
  const [state, setState] = createSignal<PauseState>({
    globalPaused: false,
    pausedProjects: [],
  })

  onMount(() => {
    const refresh = () => void window.studio.pause.state().then(setState)
    refresh()
    const timer = setInterval(refresh, 2_000)
    onCleanup(() => clearInterval(timer))
  })

  async function toggle(): Promise<void> {
    setState(await window.studio.pause.setGlobal(!state().globalPaused))
  }

  return (
    <button
      type="button"
      class={state().globalPaused ? 'btn-danger' : 'btn-ghost'}
      data-testid="pause-all"
      onClick={() => toggle()}
    >
      {state().globalPaused ? '▶ Resume All' : '⏸ Pause All Agents'}
    </button>
  )
}

export function ProjectPauseButton(props: { projectId: () => string | undefined }) {
  const [paused, setPaused] = createSignal(false)

  const refresh = () => {
    void window.studio.pause.state().then((state) => {
      const id = props.projectId()
      setPaused(id !== undefined && state.pausedProjects.includes(id))
    })
  }

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, 2_000)
    onCleanup(() => clearInterval(timer))
  })

  async function toggle(): Promise<void> {
    const id = props.projectId()
    if (!id) return
    await window.studio.pause.setProject(id, !paused())
    setPaused(!paused())
  }

  return (
    <Show when={props.projectId()}>
      <button type="button" class={paused() ? 'btn-danger' : 'btn-ghost'} onClick={() => toggle()}>
        {paused() ? '▶ Resume' : '⏸ Pause'}
      </button>
    </Show>
  )
}

/** Renders the paused-projects banner shown while the kill switch is on. */
export function PausedBanner(props: { state: PauseState }) {
  return (
    <Show when={props.state.globalPaused}>
      <div class="paused-banner" role="alert">
        All agents paused — no new model calls or tool mutations.
        <Show when={props.state.pausedProjects.length > 0}>
          {' '}
          <For each={props.state.pausedProjects}>
            {(id) => <span class="badge">{id.slice(0, 8)}</span>}
          </For>
        </Show>
      </div>
    </Show>
  )
}
