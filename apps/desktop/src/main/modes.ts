import type { ActivityRepository, SettingsRepository } from '@studio/persistence'

export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3'
export type ModelMode = 'auto' | 'fast' | 'quality' | 'manual'

export type ProjectModeSettings = {
  autonomy: AutonomyLevel
  modelMode: ModelMode
}

export const DEFAULT_PROJECT_MODES: ProjectModeSettings = {
  autonomy: 'L2',
  modelMode: 'auto',
}

const MODES_KEY = 'modes/projects'

const LEVEL_ORDER: Record<AutonomyLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 }

/**
 * Autonomy levels and model modes (spec §21 / P3.6).
 *
 * Autonomy is enforced by code, not prompt text: attempts (autonomous
 * implementation runs) and verifier reviews require L2+; L1 permits
 * chat/inspection only; L0 permits nothing automatic. L3 adds nothing the
 * caps/policy/locks don't already bound. New projects default to L2.
 */
export class ModeManager {
  private byProject: Record<string, ProjectModeSettings>

  constructor(
    private readonly deps: { settings: SettingsRepository; activity: ActivityRepository },
  ) {
    this.byProject = deps.settings.getJson<Record<string, ProjectModeSettings>>(MODES_KEY, {})
  }

  forProject(projectId: string): ProjectModeSettings {
    return this.byProject[projectId] ?? { ...DEFAULT_PROJECT_MODES }
  }

  setAutonomy(projectId: string, level: AutonomyLevel): ProjectModeSettings {
    const current = this.forProject(projectId)
    const next = { ...current, autonomy: level }
    this.byProject[projectId] = next
    this.deps.settings.setJson(MODES_KEY, this.byProject)
    this.deps.activity.record('modes.autonomy', `${projectId} autonomy → ${level}`, {
      projectId,
      payload: { from: current.autonomy, to: level },
    })
    return next
  }

  setModelMode(projectId: string, mode: ModelMode): ProjectModeSettings {
    const current = this.forProject(projectId)
    const next = { ...current, modelMode: mode }
    this.byProject[projectId] = next
    this.deps.settings.setJson(MODES_KEY, this.byProject)
    this.deps.activity.record('modes.model', `${projectId} model mode → ${mode}`, {
      projectId,
      payload: { from: current.modelMode, to: mode },
    })
    return next
  }

  /** Mechanical gate: attempts and verifier reviews need L2+. */
  assertCanRunAutonomous(projectId: string, action: string): void {
    const level = this.forProject(projectId).autonomy
    if (LEVEL_ORDER[level] < LEVEL_ORDER.L2) {
      throw new Error(
        `Autonomy ${level} does not allow ${action}; requires L2 Assisted or higher (settings → Autonomy)`,
      )
    }
  }

  isAutonomousAllowed(projectId: string): boolean {
    return LEVEL_ORDER[this.forProject(projectId).autonomy] >= LEVEL_ORDER.L2
  }
}
