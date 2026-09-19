import type { FileEntry } from '@studio/shared'
import { createEffect, createSignal, For, Show } from 'solid-js'

export function ExplorerPanel(props: { projectId: () => string | undefined }) {
  const [entries, setEntries] = createSignal<FileEntry[]>([])
  const [path, setPath] = createSignal('.')
  const [error, setError] = createSignal<string | null>(null)

  async function refresh(target = path()): Promise<void> {
    const id = props.projectId()
    if (!id) return
    try {
      const result = await window.studio.fs.list(id, target)
      if (props.projectId() !== id) return
      setEntries(result.entries)
      setPath(target)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  createEffect(() => {
    if (props.projectId()) void refresh('.')
  })

  const breadcrumbs = () => {
    const current = path()
    if (current === '.' || current === '') return []
    return current.split('/')
  }

  function navigate(dir: string): void {
    if (dir === '..') {
      const parts = path().split('/')
      parts.pop()
      void refresh(parts.length === 0 ? '.' : parts.join('/'))
      return
    }
    void refresh(`${path() === '.' ? '' : `${path()}/`}${dir}`)
  }

  return (
    <div class="explorer-panel">
      <div class="explorer-header">
        <span class="explorer-title">Explorer</span>
        <Show when={path() !== '.'}>
          <button type="button" class="btn-ghost btn-small" onClick={() => navigate('..')}>
            ↑
          </button>
        </Show>
      </div>
      <div class="explorer-crumbs">
        <button type="button" class="crumb" onClick={() => refresh('.')}>
          root
        </button>
        <For each={breadcrumbs()}>{(part) => <span class="crumb-sep">/ {part}</span>}</For>
      </div>
      <ul class="explorer-list">
        <For each={entries()}>
          {(entry) => (
            <li>
              <button
                type="button"
                class={`explorer-item ${entry.kind === 'dir' ? 'explorer-dir' : ''}`}
                onClick={() => entry.kind === 'dir' && navigate(entry.name)}
                title={entry.path}
              >
                <span class="explorer-icon">{entry.kind === 'dir' ? '▸' : '◦'}</span>
                <span class="explorer-name">{entry.name}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={error()}>{(message) => <div class="chat-panel-error">{message()}</div>}</Show>
    </div>
  )
}
