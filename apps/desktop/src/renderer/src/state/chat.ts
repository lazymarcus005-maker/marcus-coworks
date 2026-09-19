import type { ChatMessage } from '@studio/shared'
import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { ProjectsStore } from './projects.js'

export type ChatEntry = {
  id: string
  role: 'user' | 'assistant'
  text: string
  model?: string
  error?: string
}

/**
 * Live chat state for the active project: streaming entries keyed by
 * message id, plus session status driven by pushed events.
 */
export function createChatStore(projectId: () => string | undefined, projects: ProjectsStore) {
  const [entries, setEntries] = createSignal<ChatEntry[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let loadedFor: string | undefined

  function upsert(next: ChatEntry): void {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.id === next.id)
      if (index === -1) return [...current, next]
      const copy = [...current]
      copy[index] = { ...copy[index], ...next }
      return copy
    })
  }

  // Load history when the active project changes.
  createEffect(async () => {
    const id = projectId()
    if (!id || id === loadedFor) return
    loadedFor = id
    setEntries([])
    setBusy(false)
    const { messages } = await window.studio.chat.history(id)
    if (projectId() !== id) return
    setEntries(
      messages.map((message: ChatMessage) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        model: message.model,
        error: message.error,
      })),
    )
  })

  // Live updates from main.
  onCleanup(
    window.studio.chat.onEvent((event) => {
      if ('projectId' in event && event.projectId !== projectId()) return
      switch (event.type) {
        case 'message-started': {
          // Server echo of our own optimistic user message: replace it.
          if (event.role === 'user') {
            setEntries((current) => {
              const localIndex = current.findIndex(
                (entry) => entry.id.startsWith('local-') && entry.text === '',
              )
              if (localIndex === -1) return current
              const copy = [...current]
              copy[localIndex] = { ...copy[localIndex]!, id: event.messageId }
              return copy
            })
            return
          }
          upsert({ id: event.messageId, role: event.role, text: '', model: event.model })
          return
        }
        case 'message-text':
          upsert({ id: event.messageId, role: 'assistant', text: event.text })
          return
        case 'message-completed':
          // Merge WITHOUT touching text — the streamed text must survive.
          setEntries((current) => {
            const index = current.findIndex((entry) => entry.id === event.messageId)
            if (index === -1) return current
            const copy = [...current]
            copy[index] = { ...copy[index]!, error: event.error }
            return copy
          })
          return
        case 'session-status':
          setBusy(event.status === 'busy')
          if (event.status === 'busy') setError(null)
          projects.refresh()
          return
        case 'runtime-error':
          setError(event.error)
          return
      }
    }),
  )

  async function send(text: string): Promise<void> {
    const id = projectId()
    if (!id || text.trim() === '' || busy()) return
    setError(null)
    upsert({ id: `local-${crypto.randomUUID()}`, role: 'user', text })
    setBusy(true)
    try {
      await window.studio.chat.send(id, text)
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function stop(): Promise<void> {
    const id = projectId()
    if (!id) return
    await window.studio.chat.stop(id)
    setBusy(false)
  }

  return { entries, busy, error, send, stop }
}

export type ChatStore = ReturnType<typeof createChatStore>
