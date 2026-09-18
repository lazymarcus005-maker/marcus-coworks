/**
 * Health payload returned by the `app/health` IPC call.
 * Doubles as the proof that the renderer -> preload -> main round-trip works.
 */
export type HealthInfo = {
  appName: string
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
  nodeVersion: string
  timestamp: string
}
