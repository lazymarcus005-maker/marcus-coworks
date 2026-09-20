import { type Accessor, createSignal, For, onMount, Show } from 'solid-js'
import type { ChatStore } from '../state/chat.js'

export function ChatPanel(props: { store: ChatStore; projectId: Accessor<string | undefined> }) {
  const [draft, setDraft] = createSignal('')
  let listRef: HTMLDivElement | undefined

  onMount(() => {
    const observer = new MutationObserver(() => {
      listRef?.scrollTo({ top: listRef.scrollHeight })
    })
    if (listRef) {
      observer.observe(listRef, { childList: true, subtree: true, characterData: true })
    }
    return () => observer.disconnect()
  })

  function submit() {
    const text = draft().trim()
    if (!text) return
    setDraft('')
    void props.store.send(text)
  }

  return (
    <div class="chat-panel">
      <div class="chat-list" ref={listRef}>
        <For each={props.store.entries()}>
          {(entry, index) => {
            const entries = props.store.entries
            const isStreaming =
              props.store.busy() &&
              entry.role === 'assistant' &&
              entry.text.trim() !== '' &&
              index() === entries().length - 1
            return (
              <div class={`chat-message chat-${entry.role}`}>
                <div class="chat-bubble">
                  <Show when={entry.model}>{(model) => <div class="chat-model">{model()}</div>}</Show>
                  <div class={`chat-text ${isStreaming ? 'chat-text-streaming' : ''}`}>{entry.text}</div>
                  <Show when={entry.error}>{(error) => <div class="chat-error">{error()}</div>}</Show>
                </div>
              </div>
            )
          }}
        </For>
        <Show when={props.store.thinking()}>
          <div class="chat-message chat-assistant">
            <div class="chat-bubble chat-thinking" data-testid="chat-thinking">
              <span class="chat-thinking-label">Thinking</span>
              <span class="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        </Show>
        <Show when={props.store.entries().length === 0}>
          <div class="chat-empty muted">
            Ask the agent to do something in this project. Substantial requests will create a task
            plan.
          </div>
        </Show>
      </div>
      <Show when={props.store.error()}>
        {(error) => (
          <div class="chat-panel-error" role="alert">
            {error()}
          </div>
        )}
      </Show>
      <div class="chat-input-row">
        <textarea
          class="chat-input"
          placeholder="Message the agent…"
          value={draft()}
          rows={2}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Show
          when={props.store.busy()}
          fallback={
            <button
              type="button"
              class="btn-primary"
              onClick={() => submit()}
              disabled={draft().trim() === ''}
            >
              Send
            </button>
          }
        >
          <button type="button" class="btn-danger" onClick={() => props.store.stop()}>
            Stop
          </button>
        </Show>
      </div>
    </div>
  )
}
