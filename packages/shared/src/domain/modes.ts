/** Autonomy + model mode settings (spec §21). */
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3'
export type ModelMode = 'auto' | 'fast' | 'quality' | 'manual'

export type ProjectModeSettings = {
  autonomy: AutonomyLevel
  modelMode: ModelMode
}
