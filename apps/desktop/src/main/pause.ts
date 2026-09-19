import type { ActivityRepository, SettingsRepository } from '@studio/persistence'

export const PAUSE_STATE_KEY = 'pause/state'

export type PauseState = {
  globalPaused: boolean
  pausedProjects: string[]
}

/**
 * Global pause / kill switch + per-project pause (spec §26).
 *
 * When paused: no new model calls or tool mutations start (chat sends,
 * attempt starts, verifier reviews are gated). Running terminal processes
 * are torn down, locks are reconciled, and state persists across restart.
 * Resuming is always an explicit user action.
 */
export class PauseManager {
  private state: PauseState

  constructor(
    private readonly deps: {
      settings: SettingsRepository
      activity: ActivityRepository
      reconcileLocks?: (projectId: string) => void
      disposeProjectTerminals?: (projectId: string) => void
      now?: () => Date
    },
  ) {
    this.state = deps.settings.getJson<PauseState>(PAUSE_STATE_KEY, {
      globalPaused: false,
      pausedProjects: [],
    })
  }

  private persist(): void {
    this.deps.settings.setJson(PAUSE_STATE_KEY, this.state)
  }

  snapshot(): PauseState {
    return { ...this.state, pausedProjects: [...this.state.pausedProjects] }
  }

  isGloballyPaused(): boolean {
    return this.state.globalPaused
  }

  isProjectPaused(projectId: string): boolean {
    return this.state.globalPaused || this.state.pausedProjects.includes(projectId)
  }

  /** Throws when gated; the message names the pause scope. */
  assertCanAct(projectId: string, action = 'operation'): void {
    if (this.state.globalPaused) {
      throw new Error(`All agents are paused; resume to ${action}`)
    }
    if (this.state.pausedProjects.includes(projectId)) {
      throw new Error(`Project is paused; resume it to ${action}`)
    }
  }

  setGlobal(paused: boolean): void {
    if (this.state.globalPaused === paused) return
    this.state.globalPaused = paused
    this.persist()
    this.deps.activity.record(
      paused ? 'pause.global' : 'resume.global',
      paused ? 'All agents paused (kill switch)' : 'All agents resumed',
    )
    if (paused) {
      this.deps.disposeProjectTerminals?.('*')
    }
  }

  setProject(projectId: string, paused: boolean): void {
    const has = this.state.pausedProjects.includes(projectId)
    if (paused === has) return
    if (paused) {
      this.state.pausedProjects.push(projectId)
    } else {
      this.state.pausedProjects = this.state.pausedProjects.filter((id) => id !== projectId)
    }
    this.persist()
    this.deps.activity.record(
      paused ? 'pause.project' : 'resume.project',
      paused ? `Project ${projectId} paused` : `Project ${projectId} resumed`,
      { projectId },
    )
    if (paused) {
      this.deps.disposeProjectTerminals?.(projectId)
      this.deps.reconcileLocks?.(projectId)
    }
  }
}
