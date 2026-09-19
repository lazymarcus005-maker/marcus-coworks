import { execFile } from 'node:child_process'
import type { ActivityRepository, SettingsRepository } from '@studio/persistence'

export type SandboxMode = 'off' | 'container'

export type SandboxDetection = {
  mode: SandboxMode
  available: boolean
  runtime: 'docker' | 'colima' | null
  detail: string
}

export interface IsolationManagerDeps {
  settings: SettingsRepository
  activity: ActivityRepository
  probe?: () => Promise<{ runtime: 'docker' | 'colima' | null; detail: string }>
}

function probeRuntime(): Promise<{ runtime: 'docker' | 'colima' | null; detail: string }> {
  const probe = (command: string, args: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      execFile(command, args, (error) => resolve(error === null))
    })
  return (async () => {
    if (await probe('docker', ['info']))
      return { runtime: 'docker', detail: 'docker daemon reachable' }
    if (await probe('colima', ['status'])) return { runtime: 'colima', detail: 'colima running' }
    return { runtime: null, detail: 'no container runtime found (docker/colima)' }
  })()
}

/**
 * Advanced isolation option (spec P5.3): an OPTIONAL sandboxed worker per
 * project via a container runtime. Git worktrees are code isolation, NOT
 * a security sandbox — this is the layer that can honestly add one, when
 * a container runtime is available.
 */
export class IsolationManager {
  constructor(private readonly deps: IsolationManagerDeps) {}

  async detect(): Promise<SandboxDetection> {
    const probe = this.deps.probe ?? probeRuntime
    const result = await probe()
    return {
      mode: this.preference() === 'container' ? 'container' : 'off',
      available: result.runtime !== null,
      runtime: result.runtime,
      detail: result.detail,
    }
  }

  preference(): SandboxMode {
    return this.deps.settings.getJson<SandboxMode>('isolation/mode', 'off')
  }

  setPreference(mode: SandboxMode): SandboxMode {
    this.deps.settings.setJson('isolation/mode', mode)
    this.deps.activity.record('isolation.mode', `Sandbox mode → ${mode}`)
    return mode
  }

  /**
   * Builds the containerized `opencode serve` command for a project:
   * the project directory is mounted read-write at /workspace and only
   * the API port is published. Returns null when sandboxing is off or
   * unavailable.
   */
  async workerServeCommand(projectPath: string, port: number): Promise<string | null> {
    if (this.preference() !== 'container') return null
    const detection = await this.detect()
    if (!detection.available) return null
    const runtime = detection.runtime === 'colima' ? 'docker' : detection.runtime
    return (
      `${runtime} run --rm -p 127.0.0.1:${port}:${port} ` +
      `-v ${projectPath}:/workspace -w /workspace ` +
      `ghcr.io/opencode-ai/opencode:latest serve --hostname 0.0.0.0 --port ${port}`
    )
  }
}
