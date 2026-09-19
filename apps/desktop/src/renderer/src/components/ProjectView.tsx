import type { ProjectWorkspace, RemoveProjectOptions } from '@studio/shared'
import { createSignal, Show } from 'solid-js'
import { createChatStore } from '../state/chat.js'
import type { ProjectsStore } from '../state/projects.js'
import { AgentTreePanel } from './AgentTreePanel.js'
import { ChatPanel } from './ChatPanel.js'
import { ContextPanel } from './ContextPanel.js'
import { ExplorerPanel } from './ExplorerPanel.js'
import { ProjectPauseButton } from './PauseControls.js'
import { TasksPanel } from './TasksPanel.js'
import { TerminalDock } from './TerminalDock.js'

export function ProjectView(props: { project: ProjectWorkspace; store: ProjectsStore }) {
  const [editing, setEditing] = createSignal(false)
  const [draftName, setDraftName] = createSignal('')
  const [removing, setRemoving] = createSignal(false)
  const [removeHistory, setRemoveHistory] = createSignal(true)

  const project = () => props.project
  const chat = createChatStore(() => props.project?.id, props.store)

  function startRename() {
    setDraftName(project().name)
    setEditing(true)
  }

  async function commitRename() {
    setEditing(false)
    const next = draftName().trim()
    if (next && next !== project().name) {
      await props.store.rename(project().id, next)
    }
  }

  async function confirmRemove() {
    const options: RemoveProjectOptions = {
      removeHistory: removeHistory(),
      removeCache: false,
      removeCompletedWorktrees: false,
    }
    setRemoving(false)
    await props.store.remove(project().id, options)
  }

  return (
    <div class="project-view">
      <div class="project-header">
        <Show
          when={!editing()}
          fallback={
            <input
              class="project-name-input"
              value={draftName()}
              onInput={(e) => setDraftName(e.currentTarget.value)}
              onBlur={() => commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              autofocus
            />
          }
        >
          <h1 class="project-name" onDblClick={startRename} title="Double-click to rename">
            {project().name}
          </h1>
        </Show>
        <span class="project-path">{project().path}</span>
        <span class="spacer" />
        <span class={`project-status status-${project().status}`}>{project().status}</span>
        <Show
          when={!removing()}
          fallback={
            <span class="remove-popover">
              <label>
                <input
                  type="checkbox"
                  checked={removeHistory()}
                  onChange={(e) => setRemoveHistory(e.currentTarget.checked)}
                />
                Remove Agent Studio history
              </label>
              <span class="remove-warning">Source files are never deleted.</span>
              <button type="button" class="btn-danger" onClick={() => confirmRemove()}>
                Remove Project
              </button>
              <button type="button" class="btn-ghost" onClick={() => setRemoving(false)}>
                Cancel
              </button>
            </span>
          }
        >
          <ProjectPauseButton projectId={() => props.project?.id} />
          <button type="button" class="btn-ghost" onClick={() => setRemoving(true)}>
            Remove…
          </button>
        </Show>
      </div>
      <div class="project-body">
        <div class="explorer-column">
          <ExplorerPanel projectId={() => props.project?.id} />
        </div>
        <div class="main-column">
          <div class="main-rows">
            <div class="chat-column">
              <ChatPanel store={chat} projectId={() => props.project?.id} />
            </div>
            <div class="side-column">
              <TasksPanel projectId={() => props.project?.id} />
            </div>
          </div>
          <TerminalDock projectId={() => props.project?.id} />
        </div>
      </div>
    </div>
  )
}
