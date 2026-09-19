import type { BudgetLimits, BudgetUsage, DoctorCheck } from '@studio/shared'
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'

function BudgetPaneInner() {
  const [limits, setLimits] = createSignal<BudgetLimits | null>(null)
  const [usage, setUsage] = createSignal<BudgetUsage | null>(null)

  const refresh = async () => {
    setLimits(await window.studio.budgets.limits())
    setUsage(await window.studio.budgets.usage())
  }

  createEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    onCleanup(() => clearInterval(timer))
  })

  async function save(patch: Partial<BudgetLimits>) {
    setLimits(await window.studio.budgets.setLimits(patch))
  }

  return (
    <div class="provider-form">
      <h4>Budgets (hard caps — only you can raise them)</h4>
      <Show when={limits()} fallback={<div class="muted">Loading…</div>}>
        {(l) => (
          <>
            <div class="goal-edit-row">
              <label>
                Daily tokens / project (0 = off)
                <input
                  type="number"
                  min="0"
                  value={l().dailyTokensPerProject}
                  onBlur={(e) =>
                    void save({ dailyTokensPerProject: Number(e.currentTarget.value) })
                  }
                />
              </label>
              <label>
                Daily model calls / project (0 = off)
                <input
                  type="number"
                  min="0"
                  value={l().dailyModelCallsPerProject}
                  onBlur={(e) =>
                    void save({ dailyModelCallsPerProject: Number(e.currentTarget.value) })
                  }
                />
              </label>
            </div>
            <Show when={usage()}>
              {(u) => (
                <div class="muted form-hint">
                  Today:{' '}
                  {Object.entries(u().tokensByProject)
                    .map(([id, tokens]) => `${id.slice(0, 8)}: ${tokens}`)
                    .join(', ') || 'no usage yet'}
                </div>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function DoctorPaneInner() {
  const [checks, setChecks] = createSignal<DoctorCheck[] | null>(null)
  const [recommendation, setRecommendation] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  async function run() {
    setBusy(true)
    try {
      const projects = await window.studio.projects.list()
      const project = projects.projects[0]
      if (!project) {
        setChecks([{ check: 'Project', ok: false, detail: 'No project registered yet' }])
        return
      }
      const result = await window.studio.doctor.run(project.id)
      setChecks(result.checks)
      setRecommendation(result.autonomyRecommendation)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="provider-form">
      <h4>Harness Doctor</h4>
      <button type="button" class="btn-primary" disabled={busy()} onClick={() => void run()}>
        Run diagnostics
      </button>
      <Show when={checks()}>
        {(list) => (
          <ul class="doctor-list">
            <For each={list()}>
              {(check) => (
                <li class={`doctor-check ${check.ok ? 'doctor-ok' : 'doctor-fail'}`}>
                  {check.ok ? '✓' : '!'} {check.check} — {check.detail}
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
      <Show when={recommendation()}>
        {(rec) => <div class="muted">Autonomy recommendation: {rec()}</div>}
      </Show>
    </div>
  )
}

export function OpsPanes() {
  return (
    <>
      <section class="settings-section">
        <h3>Budgets</h3>
        <BudgetPaneInner />
      </section>
      <section class="settings-section">
        <h3>Doctor</h3>
        <DoctorPaneInner />
      </section>
    </>
  )
}
