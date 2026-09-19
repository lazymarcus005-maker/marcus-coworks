import type { SchedulerSnapshot } from '@studio/shared'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'

/** Resource controls + visible waiting queue (P3.5). */
export function SchedulerPanel() {
  const [snapshot, setSnapshot] = createSignal<SchedulerSnapshot | null>(null)

  const refresh = async () => {
    setSnapshot(await window.studio.scheduler.snapshot())
  }

  createEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 2_000)
    onCleanup(() => clearInterval(timer))
  })

  async function adjust(resource: 'remote-llm' | 'local-llm' | 'shell', delta: number) {
    const current = snapshot()?.limits[resource] ?? 1
    const next = Math.max(1, current + delta)
    setSnapshot(await window.studio.scheduler.setLimit(resource, next))
  }

  return (
    <div class="agent-tree">
      <div class="tasks-header">
        <h3>Scheduler</h3>
        <Show when={snapshot()}>
          {(s) => <span class="muted">{s().queue.length} waiting</span>}
        </Show>
      </div>
      <Show when={snapshot()} fallback={<div class="muted tasks-empty-goal">Loading…</div>}>
        {(s) => (
          <div class="context-body">
            <For
              each={Object.entries(s().limits) as ['remote-llm' | 'local-llm' | 'shell', number][]}
            >
              {([resource, limit]) => (
                <div class="context-row">
                  <span class="muted">{resource}</span>
                  <span class="context-value">
                    {s().running[resource]}/{limit}
                  </span>
                  <span class="scheduler-adjust">
                    <button
                      type="button"
                      class="btn-ghost btn-small"
                      onClick={() => adjust(resource, -1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      class="btn-ghost btn-small"
                      onClick={() => adjust(resource, 1)}
                    >
                      +
                    </button>
                  </span>
                </div>
              )}
            </For>
            <Show when={s().queue.length > 0}>
              <div class="scheduler-queue">
                <For each={s().queue}>
                  {(entry) => (
                    <div class="context-row">
                      <span class="muted">
                        {entry.label ?? entry.resource} (p{entry.priority})
                      </span>
                      <button
                        type="button"
                        class="btn-ghost btn-small"
                        onClick={() =>
                          void window.studio.scheduler.cancel(entry.ticketId).then(refresh)
                        }
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
