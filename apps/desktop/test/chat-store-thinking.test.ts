import { describe, expect, it, vi } from 'vitest'
import { createChatStore } from '../src/renderer/src/state/chat.js'

type Listener = (event: any) => void
let listener: Listener | null = null
let releaseSend: (() => void) | null = null

vi.stubGlobal('window', {
  studio: {
    chat: {
      onEvent: (l: Listener) => {
        listener = l
        return () => undefined
      },
      history: vi.fn(async () => ({ messages: [] })),
      send: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseSend = resolve
          }),
      ),
      stop: vi.fn(async () => undefined),
      start: vi.fn(async () => ({ sessionId: 's' })),
    },
    projects: {
      tabState: vi.fn(async () => ({ tabs: [], activeProjectId: null })),
    },
  },
})

/**
 * State-level assertions for the thinking-indicator inputs. The memo
 * itself is verified in-app (Solid memos need a reactive root; node-env
 * memos do not recompute — documented limitation of this test env).
 */
describe('chat store thinking indicator inputs', () => {
  it('optimistic user entry + pending IPC set the busy state', async () => {
    const store = createChatStore(() => 'p1', {
      refresh: vi.fn(),
    } as never)
    void store.send('What is 2+2?')
    await Promise.resolve()

    expect(store.busy()).toBe(true)
    expect(store.entries().some((e) => e.role === 'user' && e.text === 'What is 2+2?')).toBe(true)

    // assistant started with empty text — the thinking window
    listener?.({ type: 'message-started', projectId: 'p1', messageId: 'm1', role: 'assistant' })
    const entries = store.entries()
    expect(entries[entries.length - 1]?.role).toBe('assistant')

    // first assistant text ends the thinking window inputs
    listener?.({ type: 'message-text', projectId: 'p1', messageId: 'm1', text: '4' })
    const last = store.entries()[store.entries().length - 1]
    expect(last?.text).toBe('4')

    releaseSend?.()
  })
})
