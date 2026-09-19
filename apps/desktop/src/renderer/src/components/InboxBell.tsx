import type { InboxItem } from '@studio/shared'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'

const KIND_LABEL: Record<string, string> = {
  'approval-required': 'Approval required',
  'attempts-exhausted': 'Attempts exhausted',
  'protected-path': 'Protected path',
  'ambiguous-goal': 'Ambiguous goal',
  'verifier-rejected': 'Verifier rejected',
  'lock-conflict': 'Lock conflict',
  'security-sensitive': 'Security sensitive',
  'budget-extension': 'Budget extension',
  'destructive-action': 'Destructive action',
  other: 'Needs attention',
}

export function InboxBell() {
  const [open, setOpen] = createSignal(false)
  const [items, setItems] = createSignal<InboxItem[]>([])

  async function refresh(): Promise<void> {
    const { items: listed } = await window.studio.inbox.list('open')
    setItems(listed)
  }

  createEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3_000)
    onCleanup(() => clearInterval(timer))
  })

  async function decide(item: InboxItem, decision: 'approve' | 'reject' | 'dismiss') {
    await window.studio.inbox.resolve(item.id, decision)
    await refresh()
  }

  return (
    <div class="inbox-bell">
      <button
        type="button"
        class="btn-ghost"
        aria-label={`Human Inbox (${items().length} open)`}
        onClick={() => setOpen(!open())}
      >
        ☰ Inbox{items().length > 0 ? ` (${items().length})` : ''}
      </button>
      <Show when={open()}>
        <div class="menu inbox-popover">
          <div class="menu-label">Human Inbox — needs a decision</div>
          <Show
            when={items().length > 0}
            fallback={
              <div class="inbox-empty muted">
                Nothing waiting. The harness escalates blockers here.
              </div>
            }
          >
            <For each={items()}>
              {(item) => (
                <div class="inbox-item" data-testid="inbox-item">
                  <div class="inbox-item-head">
                    <span class={`badge badge-kind-${item.kind}`}>
                      {KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                    <span class="muted inbox-when">
                      {new Date(item.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div class="inbox-title">{item.title}</div>
                  <Show when={item.detail}>
                    {(detail) => <div class="inbox-detail">{detail()}</div>}
                  </Show>
                  <Show when={item.taskId || item.goalId}>
                    <div class="inbox-links muted">
                      <Show when={item.taskId}>
                        <span title={item.taskId}>task {item.taskId?.slice(0, 8)}</span>
                      </Show>
                      <Show when={item.goalId}>
                        <span title={item.goalId}>goal {item.goalId?.slice(0, 8)}</span>
                      </Show>
                      <Show when={item.evidenceIds.length > 0}>
                        <span title={item.evidenceIds.join(', ')}>
                          {item.evidenceIds.length} evidence
                        </span>
                      </Show>
                    </div>
                  </Show>
                  <div class="inbox-actions">
                    <button
                      type="button"
                      class="btn-primary btn-small"
                      onClick={() => decide(item, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      class="btn-danger btn-small"
                      onClick={() => decide(item, 'reject')}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      class="btn-ghost btn-small"
                      onClick={() => decide(item, 'dismiss')}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
