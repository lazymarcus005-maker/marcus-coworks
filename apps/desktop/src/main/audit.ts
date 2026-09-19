import { writeFileSync } from 'node:fs'
import type { ActivityRepository, EvidenceRepository, SqliteDb } from '@studio/persistence'
import { type BrowserWindow, dialog, shell } from 'electron'
import type { SecretBroker } from './secret-broker.js'
import type { StudioServices } from './services.js'

export interface AuditExporterDeps {
  services: () => StudioServices
  broker: SecretBroker
  db: SqliteDb
}

/**
 * Audit export (P4.5): one JSON run package per project — goal, tasks,
 * transitions, attempts, verification evidence, verifier/policy decisions,
 * activity, network events — scrubbed of issued secrets, never including
 * raw prompt payloads.
 */
export class AuditExporter {
  constructor(private readonly deps: AuditExporterDeps) {}

  buildPackage(projectId: string): Record<string, unknown> {
    const services = this.deps.services()
    const project = services.projectManager.getProject(projectId)
    const state = services.tasks.stateForProject(projectId)
    const activity = services.projectManager.listActivity(1000)

    const attemptsByTask = Object.fromEntries(
      state.tasks.map((task) => [task.id, services.attempts.history(task.id)]),
    )
    const evidenceByTask = Object.fromEntries(
      state.tasks.map((task) => [task.id, services.verification.historyForTask(task.id)]),
    )
    const transitionsByTask = Object.fromEntries(
      state.tasks.map((task) => [task.id, services.tasks.transitionHistory(task.id)]),
    )

    const raw = {
      exportedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name, path: project.path },
      goal: state.goal,
      tasks: state.tasks,
      transitionsByTask,
      attemptsByTask,
      evidenceByTask,
      activity,
      networkEvents: services.network.listEvents(500),
      notes: [
        'Secrets issued through the broker are redacted.',
        'Full prompt payloads are excluded by design.',
      ],
    }

    return JSON.parse(this.deps.broker.redact(JSON.stringify(raw))) as Record<string, unknown>
  }

  async exportToFile(projectId: string, parent?: BrowserWindow): Promise<string | null> {
    const pkg = this.buildPackage(projectId)
    const options: Electron.SaveDialogOptions = {
      title: 'Export run package',
      defaultPath: `studio-run-${projectId.slice(0, 8)}-${Date.now()}.json`,
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, JSON.stringify(pkg, null, 2), 'utf-8')
    void shell.showItemInFolder(result.filePath)
    return result.filePath
  }
}

export type DoctorCheck = {
  check: string
  ok: boolean
  detail: string
}

/**
 * Harness Doctor (spec §48 / P4.6): actionable, per-check diagnostics —
 * no composite score hiding failures — plus an autonomy recommendation.
 */
export async function runDoctor(
  services: StudioServices,
  projectId: string,
): Promise<{
  checks: DoctorCheck[]
  autonomyRecommendation: string
}> {
  const checks: DoctorCheck[] = []
  const project = services.projectManager.getProject(projectId)
  const { execFileSync } = await import('node:child_process')

  // OpenCode availability.
  try {
    const detection = await services.runtime.detect()
    checks.push({
      check: 'OpenCode available',
      ok: detection.available,
      detail: detection.available
        ? `version ${detection.version ?? 'unknown'}`
        : 'binary not found',
    })
  } catch (cause) {
    checks.push({ check: 'OpenCode available', ok: false, detail: String(cause) })
  }

  // LLM provider configured + reachable.
  const providers = services.providers.list()
  checks.push({
    check: 'LLM provider configured',
    ok: providers.length > 0,
    detail: providers.length === 0 ? 'no providers configured' : `${providers.length} configured`,
  })
  if (providers[0] !== undefined) {
    const probe = await services.providers.testSaved(providers[0].id)
    checks.push({
      check: 'LLM provider reachable',
      ok: probe.ok,
      detail: probe.ok ? `${providers[0].name} responded` : (probe.error ?? 'unreachable'),
    })
  }

  // Git repository + worktree support.
  try {
    execFileSync('git', ['-C', project.path, 'rev-parse', '--is-inside-work-tree'], {
      stdio: 'ignore',
    })
    checks.push({ check: 'Git repository', ok: true, detail: project.path })
    execFileSync('git', ['-C', project.path, 'worktree', 'list'], { stdio: 'ignore' })
    checks.push({ check: 'Worktree support', ok: true, detail: 'git worktree available' })
  } catch {
    checks.push({
      check: 'Git repository',
      ok: false,
      detail: `${project.path} is not a git repository`,
    })
  }

  // Build/test commands known (heuristic: package.json or Makefile present).
  const hasCommands = ['package.json', 'Makefile', 'pyproject.toml', 'Cargo.toml', '*.csproj'].some(
    (name) => {
      try {
        execFileSync('sh', ['-c', `ls ${project.path}/${name} 2>/dev/null | grep -q .`], {
          stdio: 'ignore',
        })
        return true
      } catch {
        return false
      }
    },
  )
  checks.push({
    check: 'Build/test commands discoverable',
    ok: hasCommands,
    detail: hasCommands
      ? 'project manifest found'
      : 'no known manifest — configure verification commands',
  })

  // Policy loaded.
  const policy = services.policy(project.path)
  checks.push({
    check: 'Policy loaded',
    ok: true,
    detail: `source: ${policy.source}, protected paths: ${policy.policy.protectedPaths.length}`,
  })

  // Attempt limits + verification requirements.
  checks.push({
    check: 'Attempt limit',
    ok: true,
    detail: `policy max ${policy.policy.changeLimits.maxAttempts}, goal contracts default 3`,
  })
  checks.push({
    check: 'Verification required',
    ok: policy.policy.verification.testsRequired,
    detail: policy.policy.verification.testsRequired
      ? 'tests required before done'
      : 'tests NOT required (risky)',
  })

  // Budgets configured.
  const budgets = services.budgets.getLimits()
  checks.push({
    check: 'Budgets configured',
    ok: budgets.dailyTokensPerProject > 0,
    detail:
      budgets.dailyTokensPerProject > 0
        ? `${budgets.dailyTokensPerProject} tokens/day/project`
        : 'no token budget set',
  })

  // Keychain probe.
  try {
    const probeId = 'secret://doctor-probe'
    await services.secrets.set(probeId, `probe-${Date.now()}`)
    const read = await services.secrets.get(probeId)
    await services.secrets.delete(probeId)
    checks.push({
      check: 'Keychain',
      ok: read !== null,
      detail: read !== null ? 'read/write ok' : 'probe read failed',
    })
  } catch (cause) {
    checks.push({ check: 'Keychain', ok: false, detail: String(cause) })
  }

  // MCP + Skills parseable.
  try {
    const servers = services.mcp.list(project.path)
    checks.push({
      check: 'MCP config',
      ok: true,
      detail: `${servers.length} servers (${servers.filter((s) => s.enabled).length} enabled)`,
    })
  } catch (cause) {
    checks.push({ check: 'MCP config', ok: false, detail: String(cause) })
  }
  try {
    const skills = services.skills.list(project.path)
    checks.push({
      check: 'Skills',
      ok: true,
      detail: `${skills.length} skills (${skills.filter((s) => s.enabled).length} enabled)`,
    })
  } catch (cause) {
    checks.push({ check: 'Skills', ok: false, detail: String(cause) })
  }

  // Independent verifier configured.
  checks.push({
    check: 'Independent verifier',
    ok: true,
    detail: 'built into the harness (fresh session per review)',
  })

  const criticalFailures = checks.filter(
    (check) => !check.ok && /OpenCode|provider|Git|Keychain/.test(check.check),
  )
  const autonomyRecommendation = criticalFailures.length > 0 ? 'L1 Report' : 'L2 Assisted'

  return { checks, autonomyRecommendation }
}
