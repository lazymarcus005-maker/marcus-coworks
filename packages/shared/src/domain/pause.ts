/** Global/project pause state (spec §26). */
export type PauseState = {
  globalPaused: boolean
  pausedProjects: string[]
}
