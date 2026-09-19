import type { StudioServices } from './services.js'

const IN_FLIGHT_STATUSES = [
  'created',
  'planning',
  'ready',
  'running',
  'testing',
  'verifying',
  'retry',
] as const

/**
 * Startup recovery (spec §45 / P5.2 groundwork): after a crash or unclean
 * exit, tasks that were mid-flight become INTERRUPTED — never falsely
 * RUNNING — and stale worktrees and locks are reconciled.
 */
export async function recoverOnStartup(services: StudioServices): Promise<{
  interruptedTasks: string[]
  staledWorktrees: string[]
}> {
  const interruptedTasks: string[] = []
  const staledWorktrees: string[] = []

  for (const project of services.projectManager.listProjects()) {
    for (const task of services.tasks.stateForProject(project.id).tasks) {
      if (IN_FLIGHT_STATUSES.includes(task.status as (typeof IN_FLIGHT_STATUSES)[number])) {
        try {
          services.tasks.applyTransition(
            task.id,
            'interrupted',
            'app restarted while the task was in flight',
          )
          interruptedTasks.push(task.id)
        } catch {
          // Already terminal — nothing to recover.
        }
      }
    }

    try {
      const staled = await services.worktrees.reconcile(project.path)
      staledWorktrees.push(...staled.map((record) => record.id))
    } catch {
      // Project may not be a git repo; reconciliation is best-effort here.
    }

    try {
      services.locks.reconcile(project.id)
    } catch {
      // Lock reconciliation is best-effort at startup.
    }
  }

  return { interruptedTasks, staledWorktrees }
}
