import type { GoalContract, HarnessTask, TaskStatus } from '@studio/shared'
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

type GoalDraft = {
  objective: string
  scope: string
  nonGoals: string
  constraints: string
  doneWhen: string
  risk: GoalContract['risk']
  maxAttempts: number
  autonomy: string
}

function toDraft(goal: GoalContract): GoalDraft {
  return {
    objective: goal.objective,
    scope: goal.scope.join('\n'),
    nonGoals: goal.nonGoals.join('\n'),
    constraints: goal.constraints.join('\n'),
    doneWhen: goal.doneWhen.join('\n'),
    risk: goal.risk,
    maxAttempts: goal.maxAttempts,
    autonomy: goal.autonomy ?? '',
  }
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function TasksPanel(props: { projectId: () => string | undefined }) {
  const [goal, setGoal] = createSignal<GoalContract | undefined>(undefined)
  const [tasks, setTasks] = createSignal<HarnessTask[]>([])
  const [newTask, setNewTask] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [expanded, setExpanded] = createSignal(false)
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal<GoalDraft | null>(null)

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
    setExpanded(true)
  }

  function startEdit(): void {
    const current = goal()
    if (!current) return
    setDraft(toDraft(current))
    setEditing(true)
  }

  async function saveGoal(status?: GoalContract['status']): Promise<void> {
    const current = goal()
    const d = draft()
    if (!current || !d) return
    try {
      await window.studio.tasks.updateGoal(current.id, {
        objective: d.objective,
        scope: lines(d.scope),
        nonGoals: lines(d.nonGoals),
        constraints: lines(d.constraints),
        doneWhen: lines(d.doneWhen),
        risk: d.risk,
        maxAttempts: d.maxAttempts,
        autonomy: d.autonomy || undefined,
        status,
      })
      setEditing(false)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function setGoalStatus(status: GoalContract['status']): Promise<void> {
    const current = goal()
    if (!current) return
    try {
      await window.studio.tasks.updateGoal(current.id, { status })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div class="tasks-panel">
      <div class="tasks-header">
        <h3>Goal</h3>
        <Show when={goal()}>
          <button
            type="button"
            class="btn-ghost btn-small"
            onClick={() => setExpanded(!expanded())}
          >
            {expanded() ? 'Collapse' : 'Expand'}
          </button>
        </Show>
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
          <div class={`goal-card goal-${g().status}`}>
            <Show
              when={!editing()}
              fallback={
                <div class="goal-edit">
                  <label>
                    Objective
                    <textarea
                      rows={2}
                      value={draft()?.objective ?? ''}
                      onInput={(e) => setDraft({ ...draft()!, objective: e.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Scope (one glob per line)
                    <textarea
                      rows={2}
                      placeholder="src/Auth/**&#10;tests/Auth/**"
                      value={draft()?.scope ?? ''}
                      onInput={(e) => setDraft({ ...draft()!, scope: e.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Non-goals (one per line)
                    <textarea
                      rows={2}
                      value={draft()?.nonGoals ?? ''}
                      onInput={(e) => setDraft({ ...draft()!, nonGoals: e.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Constraints (one per line)
                    <textarea
                      rows={2}
                      value={draft()?.constraints ?? ''}
                      onInput={(e) => setDraft({ ...draft()!, constraints: e.currentTarget.value })}
                    />
                  </label>
                  <label>
                    Definition of Done (one criterion per line)
                    <textarea
                      rows={3}
                      placeholder="build passes&#10;unit tests pass&#10;no unrelated files modified"
                      value={draft()?.doneWhen ?? ''}
                      onInput={(e) => setDraft({ ...draft()!, doneWhen: e.currentTarget.value })}
                    />
                  </label>
                  <div class="goal-edit-row">
                    <label>
                      Risk
                      <select
                        value={draft()?.risk ?? 'medium'}
                        onChange={(e) =>
                          setDraft({
                            ...draft()!,
                            risk: e.currentTarget.value as GoalContract['risk'],
                          })
                        }
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </label>
                    <label>
                      Max attempts
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={draft()?.maxAttempts ?? 3}
                        onInput={(e) =>
                          setDraft({ ...draft()!, maxAttempts: Number(e.currentTarget.value) })
                        }
                      />
                    </label>
                    <label>
                      Autonomy
                      <input
                        placeholder="L2 Assisted"
                        value={draft()?.autonomy ?? ''}
                        onInput={(e) => setDraft({ ...draft()!, autonomy: e.currentTarget.value })}
                      />
                    </label>
                  </div>
                  <div class="form-actions">
                    <button type="button" class="btn-primary" onClick={() => saveGoal()}>
                      Save
                    </button>
                    <button type="button" class="btn-ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              }
            >
              <div class="goal-objective">{g().objective}</div>
              <div class="goal-badges">
                <span class={`badge badge-draft badge-status-${g().status}`}>{g().status}</span>
                <span class="badge">risk: {g().risk}</span>
                <span class="badge">max attempts: {g().maxAttempts}</span>
                <Show when={g().autonomy}>
                  {(autonomy) => <span class="badge">{autonomy()}</span>}
                </Show>
              </div>
              <Show when={expanded()}>
                <Show when={g().scope.length > 0}>
                  <div class="goal-section">
                    <span class="goal-section-title">Scope</span>
                    <ul>
                      <For each={g().scope}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <Show when={g().nonGoals.length > 0}>
                  <div class="goal-section">
                    <span class="goal-section-title">Non-goals</span>
                    <ul>
                      <For each={g().nonGoals}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <Show when={g().constraints.length > 0}>
                  <div class="goal-section">
                    <span class="goal-section-title">Constraints</span>
                    <ul>
                      <For each={g().constraints}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <div class="goal-section">
                  <span class="goal-section-title">Definition of Done</span>
                  <Show
                    when={g().doneWhen.length > 0}
                    fallback={<span class="muted">No criteria defined yet</span>}
                  >
                    <ul>
                      <For each={g().doneWhen}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </Show>
                </div>
              </Show>
              <div class="goal-actions">
                <Show when={g().status === 'draft'}>
                  <button type="button" class="btn-ghost btn-small" onClick={() => startEdit()}>
                    Edit contract
                  </button>
                  <button
                    type="button"
                    class="btn-primary btn-small"
                    onClick={() => setGoalStatus('ready')}
                  >
                    Mark ready
                  </button>
                </Show>
                <Show when={g().status === 'ready'}>
                  <button
                    type="button"
                    class="btn-primary btn-small"
                    onClick={() => setGoalStatus('active')}
                  >
                    Start goal
                  </button>
                </Show>
                <Show when={g().status === 'active'}>
                  <button
                    type="button"
                    class="btn-ghost btn-small"
                    onClick={() => setGoalStatus('done')}
                  >
                    Mark done
                  </button>
                </Show>
              </div>
            </Show>
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
