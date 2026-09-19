import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActivityRepository, EvidenceRepository } from '@studio/persistence'
import type { VerificationCommand, VerificationEvidence, VerificationRun } from '@studio/shared'

export type ShellRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string; durationMs: number }>

/** Runs commands through zsh -c with a wall-clock timeout. */
export function shellRunner(): ShellRunner {
  return (command, cwd, timeoutMs) =>
    new Promise((resolve) => {
      const startedAt = Date.now()
      const child = execFile(
        '/bin/zsh',
        ['-c', command],
        { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            durationMs: Date.now() - startedAt,
          })
        },
      )
      child.on('error', () => {
        /* handled via the error passed to the callback */
      })
    })
}

export interface VerificationManagerDeps {
  evidence: EvidenceRepository
  activity: ActivityRepository
  run?: ShellRunner
  /** Optional shell-slot gate (scheduler). */
  acquireShellSlot?: () => Promise<string>
  releaseShellSlot?: (ticketId: string) => void
  now?: () => Date
  newId?: () => string
  outputDir?: string
}

/** Extracts pass/fail counts from common test output formats. */
export function parseCounts(output: string): { passed?: number; failed?: number } {
  const patterns: [RegExp, 'passed' | 'failed'][] = [
    [/passed:\s*(\d+)/i, 'passed'],
    [/failed:\s*(\d+)/i, 'failed'],
    [/(\d+)\s+(?:tests?|specs?)\s+passed/i, 'passed'],
    [/(\d+)\s+passed/i, 'passed'],
    [/(\d+)\s+failing/i, 'failed'],
    [/(\d+)\s+failed/i, 'failed'],
  ]
  const result: { passed?: number; failed?: number } = {}
  for (const [regex, key] of patterns) {
    const match = output.match(regex)
    if (match?.[1] !== undefined && result[key] === undefined) {
      result[key] = Number(match[1])
    }
  }
  return result
}

/** First few meaningful lines for the evidence summary. */
export function summarize(output: string, lines = 6): string {
  const meaningful = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
  return meaningful.slice(0, lines).join('\n').slice(0, 2000)
}

/**
 * Deterministic verification pipeline (spec §16 / P2.7): runs format →
 * lint → build → test → custom commands, stores normalized evidence for
 * each, and reports whether all required checks passed. Model claims are
 * never accepted — only exit codes.
 */
export class VerificationManager {
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly runCommand: ShellRunner
  private readonly outputDir?: string

  constructor(private readonly deps: VerificationManagerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
    this.runCommand = deps.run ?? shellRunner()
    this.outputDir = deps.outputDir
  }

  async runPipeline(
    project: { id: string; path: string },
    commands: VerificationCommand[],
    context: { taskId?: string; worktreeId?: string; attempt?: number; timeoutMs?: number } = {},
  ): Promise<VerificationRun> {
    const evidence: VerificationEvidence[] = []
    let allRequiredPassed = true

    for (const command of commands) {
      const result = await this.runOne(project, command, context)
      evidence.push(result)
      if (command.required && result.exitCode !== 0) {
        allRequiredPassed = false
        // Required checks stop the pipeline early: later steps build on
        // earlier ones (lint → build → test).
        break
      }
    }

    this.deps.activity.record(
      'verification.run',
      allRequiredPassed ? 'Verification passed' : 'Verification failed',
      {
        projectId: project.id,
        payload: {
          taskId: context.taskId,
          checks: evidence.map((entry) => ({
            kind: entry.kind,
            exitCode: entry.exitCode,
            required:
              commands.find((command) => command.command === entry.command)?.required ?? true,
          })),
        },
      },
    )

    return { allRequiredPassed, evidence }
  }

  historyForTask(taskId: string): VerificationEvidence[] {
    return this.deps.evidence.listForTask(taskId)
  }

  historyForProject(projectId: string): VerificationEvidence[] {
    return this.deps.evidence.listForProject(projectId)
  }

  private async runOne(
    project: { id: string; path: string },
    command: VerificationCommand,
    context: { taskId?: string; worktreeId?: string; attempt?: number; timeoutMs?: number },
  ): Promise<VerificationEvidence> {
    const startedAt = this.now().toISOString()
    const ticket = (await this.deps.acquireShellSlot?.()) ?? 'unlimited'
    let outcome
    try {
      outcome = await this.runCommand(
        command.command,
        project.path,
        context.timeoutMs ?? 10 * 60 * 1000,
      )
    } finally {
      this.deps.releaseShellSlot?.(ticket)
    }
    const finishedAt = this.now().toISOString()

    const output = `${outcome.stdout}\n${outcome.stderr}`
    const counts = parseCounts(output)
    const summary = summarize(output)

    let outputPath: string | undefined
    if (this.outputDir && (output.trim() !== '' || outcome.code !== 0)) {
      try {
        mkdirSync(this.outputDir, { recursive: true })
        const file = join(this.outputDir, `${Date.now()}-${command.kind}.log`)
        writeFileSync(file, `$ ${command.command}\n${output}`, 'utf-8')
        outputPath = file
      } catch {
        outputPath = undefined
      }
    }

    const evidence: VerificationEvidence = {
      id: this.newId(),
      projectId: project.id,
      taskId: context.taskId,
      worktreeId: context.worktreeId,
      attempt: context.attempt,
      kind: command.kind,
      command: command.command,
      exitCode: outcome.code,
      passed: counts.passed,
      failed: counts.failed,
      durationMs: outcome.durationMs,
      summary,
      outputPath,
      startedAt,
      finishedAt,
    }
    this.deps.evidence.insert(evidence)
    return evidence
  }
}
