import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import '@xterm/xterm/css/xterm.css'
import type { TerminalInfo } from '@studio/shared'

/**
 * Bottom dock hosting per-project zsh terminals (spec §42). Terminal
 * processes are project-scoped in main; this component only renders the
 * active project's terminals.
 */
export function TerminalDock(props: { projectId: () => string | undefined }) {
  const [open, setOpen] = createSignal(true)
  const [terminals, setTerminals] = createSignal<TerminalInfo[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const terms = new Map<string, { term: Terminal; fit: FitAddon; container: HTMLDivElement }>()
  let hostRef: HTMLDivElement | undefined
  let projectorRef: HTMLDivElement | undefined

  async function ensureTerminal(): Promise<TerminalInfo> {
    const id = props.projectId()
    if (!id) throw new Error('no active project')
    const { terminal } = await window.studio.terminal.create(id)
    setTerminals((current) => [...current, terminal])
    setActiveId(terminal.id)
    return terminal
  }

  async function openDock(): Promise<void> {
    setOpen(true)
    if (terminals().length === 0) {
      await ensureTerminal()
    }
  }

  onCleanup(() => {
    for (const { term } of terms.values()) term.dispose()
    terms.clear()
  })

  // Attach an xterm instance whenever the active set changes.
  createEffect(() => {
    const id = activeId()
    const list = terminals()
    if (!id || !projectorRef) return
    const info = list.find((entry) => entry.id === id)
    if (!info) return

    let attached = terms.get(id)
    if (!attached) {
      const container = document.createElement('div')
      container.className = 'terminal-container'
      const term = new Terminal({
        fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
        fontSize: 12,
        cursorBlink: true,
        scrollback: 5000,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(container)
      fit.fit()
      term.onData((data) => window.studio.terminal.write(id, data))
      term.attachCustomKeyEventHandler(() => false)
      attached = { term, fit, container }
      terms.set(id, attached)
    }

    projectorRef.replaceChildren(attached.container)
    attached.fit.fit()
    attached.term.focus()
  })

  onMount(() => {
    const unsubscribe = window.studio.terminal.onEvent((event) => {
      if (event.type === 'exit') {
        setTerminals((current) => current.filter((entry) => entry.id !== event.terminalId))
        if (activeId() === event.terminalId) {
          setActiveId(terminals()[0]?.id ?? null)
        }
        terms.get(event.terminalId)?.term.dispose()
        terms.delete(event.terminalId)
        return
      }
      terms.get(event.terminalId)?.term.write(event.data)
    })

    const observer = new ResizeObserver(() => {
      const id = activeId()
      if (!id) return
      const attached = terms.get(id)
      if (!attached) return
      attached.fit.fit()
      void window.studio.terminal.resize(id, attached.term.cols, attached.term.rows)
    })
    if (hostRef) observer.observe(hostRef)

    onCleanup(() => {
      unsubscribe()
      observer.disconnect()
    })
  })

  function closeTerminal(id: string): void {
    void window.studio.terminal.dispose(id)
    setTerminals((current) => current.filter((entry) => entry.id !== id))
    if (activeId() === id) setActiveId(terminals()[0]?.id ?? null)
    terms.get(id)?.term.dispose()
    terms.delete(id)
  }

  return (
    <div class={`terminal-dock ${open() ? 'terminal-dock-open' : ''}`}>
      <div class="terminal-dock-bar">
        <button
          type="button"
          class="terminal-toggle"
          onClick={() => (open() ? setOpen(false) : openDock())}
        >
          Terminal {open() ? '▾' : '▸'}
        </button>
        <Show when={open()}>
          <div class="terminal-tabs">
            <For each={terminals()}>
              {(terminal) => (
                <span
                  class={`terminal-tab ${activeId() === terminal.id ? 'terminal-tab-active' : ''}`}
                >
                  <button type="button" onClick={() => setActiveId(terminal.id)}>
                    {terminal.title}
                  </button>
                  <button
                    type="button"
                    class="terminal-tab-close"
                    aria-label={`Close ${terminal.title}`}
                    onClick={() => closeTerminal(terminal.id)}
                  >
                    ×
                  </button>
                </span>
              )}
            </For>
          </div>
          <button type="button" class="btn-ghost btn-small" onClick={() => ensureTerminal()}>
            +
          </button>
        </Show>
      </div>
      <Show when={open()}>
        <div class="terminal-host" ref={hostRef}>
          <div class="terminal-projector" ref={projectorRef} />
        </div>
      </Show>
    </div>
  )
}
