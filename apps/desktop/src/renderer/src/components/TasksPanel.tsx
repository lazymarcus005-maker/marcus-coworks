import type { GoalSummary, HarnessTask, TaskStatus } from '@studio/shared'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '●',
  blocked: '⃠',
  done: '✓',
  cancelled: '×',
}

/** Click cycle for quick status changes; terminal states only via cancel. */
const NEXT_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
}

export function TasksPanel(props: { projectId: () => string | undefined }) {
  const [goal, setGoal] = createSignal<GoalSummary | undefined>(undefined)
  const [tasks, setTasks] = createSignal<HarnessTask[]>([])
  const [newTask, setNewTask] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)

  async function refresh(): Promise<void> {
    const id = props.projectId()
    if (!id) return
    try {
      const state = await window.studio.tasks.state(id)
      if (props.projectId() !== id) return
      setGoal(state.goal)
      setTasks(state.tasks)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  createEffect(() => {
    if (props.projectId()) void refresh()
  })

  // Live updates: the harness pushes tasks-changed when goals/tasks are
  // created or the runtime's TODO list syncs.
  onCleanup(
    window.studio.chat.onEvent((event) => {
      if (event.type === 'tasks-changed' && event.projectId === props.projectId()) {
        void refresh()
      }
    }),
  )

  async function addTask(): Promise<void> {
    const id = props.projectId()
    const title = newTask().trim()
    if (!id || !title) return
    setNewTask('')
    await window.studio.tasks.add(id, title)
    await refresh()
  }

  async function cycleStatus(task: HarnessTask): Promise<void> {
    const next = NEXT_STATUS[task.status]
    if (!next) return
    try {
      await window.studio.tasks.update(task.id, { status: next })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function cancelTask(task: HarnessTask): Promise<void> {
    try {
      await window.studio.tasks.cancel(task.id)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function createGoal(): Promise<void> {
    const id = props.projectId()
    if (!id) return
    await window.studio.tasks.createGoal(id, 'New goal — describe the objective')
    await refresh()
  }

  return (
    <div class="tasks-panel">
      <div class="tasks-header">
        <h3>Goal</h3>
        <Show when={!goal()}>
          <button type="button" class="btn-ghost btn-small" onClick={() => createGoal()}>
            + Goal
          </button>
        </Show>
      </div>
      <Show
        when={goal()}
        fallback={
          <div class="muted tasks-empty-goal">
            No goal yet — substantial requests create one automatically.
          </div>
        }
      >
        {(g) => (
          <div class="goal-card">
            <div class="goal-objective">{g().objective}</div>
            <span class="badge badge-draft">{g().status}</span>
          </div>
        )}
      </Show>

      <div class="tasks-header">
        <h3>Tasks</h3>
        <span class="muted">{tasks().filter((t) => t.status !== 'cancelled').length} open</span>
      </div>
      <ul class="task-list">
        <For each={tasks()}>
          {(task) => (
            <li class={`task-item task-${task.status}`}>
              <button
                type="button"
                class="task-status"
                title={`Status: ${task.status} (click to advance)`}
                onClick={() => cycleStatus(task)}
              >
                {STATUS_ICON[task.status]}
              </button>
              <span class="task-title">{task.title}</span>
              <Show when={task.source === 'opencode'}>
                <span class="badge badge-runtime" title="Synced from the agent's TODO list">
                  agent
                </span>
              </Show>
              <Show when={task.status !== 'cancelled' && task.status !== 'done'}>
                <button
                  type="button"
                  class="task-cancel"
                  title="Cancel task"
                  onClick={() => cancelTask(task)}
                >
                  ×
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <form
        class="task-add"
        onSubmit={(e) => {
          e.preventDefault()
          void addTask()
        }}
      >
        <input
          class="task-add-input"
          placeholder="Add task…"
          value={newTask()}
          onInput={(e) => setNewTask(e.currentTarget.value)}
        />
      </form>
      <Show when={error()}>{(message) => <div class="chat-panel-error">{message()}</div>}</Show>
    </div>
  )
}
