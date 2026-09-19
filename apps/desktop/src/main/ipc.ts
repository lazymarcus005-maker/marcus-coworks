import type { HealthInfo, IpcChannel, IpcContract } from '@studio/shared'
import type { StudioServices } from './services.js'

/**
 * Structural stand-in for electron's ipcMain so registration logic is
 * unit-testable without booting Electron.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
}

export interface MainDependencies {
  health: () => HealthInfo
  /** Native macOS folder picker; resolves null when cancelled. */
  pickFolder: () => Promise<string | null>
  services: StudioServices
}

type Handler = (event: unknown, request: unknown) => unknown

function projectForTask(deps: MainDependencies, taskId: string) {
  for (const project of managerOf(deps).listProjects()) {
    const hasTask = deps.services.tasks
      .stateForProject(project.id)
      .tasks.some((task) => task.id === taskId)
    if (hasTask) return project
  }
  throw new Error('Project for task not found')
}

function managerOf(deps: MainDependencies) {
  return deps.services.projectManager
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: MainDependencies): void {
  const manager = () => deps.services.projectManager

  const tabState = () => ({
    tabs: manager().listTabs(),
    activeProjectId: manager().activeTabId(),
  })

  const handlers: Record<IpcChannel, Handler> = {
    'app/health': () => deps.health(),
    'projects/list': () => ({ projects: manager().listProjects() }),
    'projects/add': (_event, request) => {
      const { path } = request as IpcContract['projects/add']['request']
      return { project: manager().addProject(path) }
    },
    'projects/pick-folder': async () => {
      const path = await deps.pickFolder()
      return path === null ? null : { path }
    },
    'projects/rename': (_event, request) => {
      const { projectId, name } = request as IpcContract['projects/rename']['request']
      return { project: manager().renameProject(projectId, name) }
    },
    'projects/remove': (_event, request) => {
      const { projectId, options } = request as IpcContract['projects/remove']['request']
      manager().removeProject(projectId, options)
      return undefined
    },
    'projects/tabs/state': () => tabState(),
    'projects/tabs/close': (_event, request) => {
      const { projectId } = request as IpcContract['projects/tabs/close']['request']
      manager().closeTab(projectId)
      return tabState()
    },
    'projects/tabs/open': (_event, request) => {
      const { projectId } = request as IpcContract['projects/tabs/open']['request']
      manager().openTab(projectId)
      return tabState()
    },
    'projects/tabs/activate': (_event, request) => {
      const { projectId } = request as IpcContract['projects/tabs/activate']['request']
      manager().setActiveTab(projectId)
      return tabState()
    },
    'activity/list': (_event, request) => {
      const { limit } = request as IpcContract['activity/list']['request']
      return { events: manager().listActivity(limit) }
    },
    'providers/list': () => ({ providers: deps.services.providers.list() }),
    'providers/save': async (_event, request) => {
      const { draft, apiKey } = request as IpcContract['providers/save']['request']
      const provider = await deps.services.providers.save(
        {
          id: draft.id,
          name: draft.name,
          type: draft.type as 'openai-compatible' | 'litellm' | 'localhost',
          baseUrl: draft.baseUrl,
          defaultModel: draft.defaultModel,
        },
        apiKey,
      )
      return { provider }
    },
    'providers/delete': (_event, request) => {
      const { id } = request as IpcContract['providers/delete']['request']
      return deps.services.providers.remove(id)
    },
    'providers/test': (_event, request) => {
      const { baseUrl, apiKey } = request as IpcContract['providers/test']['request']
      return deps.services.providers.testConnection({ baseUrl, apiKey })
    },
    'providers/test-saved': (_event, request) => {
      const { id } = request as IpcContract['providers/test-saved']['request']
      return deps.services.providers.testSaved(id)
    },
    'chat/start': async (_event, request) => {
      const { projectId } = request as IpcContract['chat/start']['request']
      const project = manager().getProject(projectId)
      const sessionId = await deps.services.chat.ensureSession(project)
      return { sessionId }
    },
    'chat/send': async (_event, request) => {
      const { projectId, text } = request as IpcContract['chat/send']['request']
      const project = manager().getProject(projectId)
      await deps.services.chat.send(project, text)
      return undefined
    },
    'chat/stop': async (_event, request) => {
      const { projectId } = request as IpcContract['chat/stop']['request']
      const project = manager().getProject(projectId)
      await deps.services.chat.stop(project)
      return undefined
    },
    'chat/history': async (_event, request) => {
      const { projectId } = request as IpcContract['chat/history']['request']
      const project = manager().getProject(projectId)
      const messages = await deps.services.chat.history(project)
      return { messages }
    },
    'tasks/state': (_event, request) => {
      const { projectId } = request as IpcContract['tasks/state']['request']
      return deps.services.tasks.stateForProject(projectId)
    },
    'tasks/create-goal': (_event, request) => {
      const { projectId, objective } = request as IpcContract['tasks/create-goal']['request']
      return { goal: deps.services.tasks.createGoalDraft(projectId, objective) }
    },
    'goals/update': (_event, request) => {
      const { goalId, patch } = request as IpcContract['goals/update']['request']
      return {
        goal: deps.services.tasks.updateGoalContract(goalId, {
          objective: patch.objective,
          scope: patch.scope,
          nonGoals: patch.nonGoals,
          constraints: patch.constraints,
          doneWhen: patch.doneWhen,
          risk:
            patch.risk === 'low' || patch.risk === 'medium' || patch.risk === 'high'
              ? patch.risk
              : undefined,
          maxAttempts: patch.maxAttempts,
          autonomy: patch.autonomy,
          status:
            patch.status === 'draft' ||
            patch.status === 'ready' ||
            patch.status === 'active' ||
            patch.status === 'done' ||
            patch.status === 'cancelled'
              ? patch.status
              : undefined,
        }),
      }
    },
    'tasks/add': (_event, request) => {
      const { projectId, title, description } = request as IpcContract['tasks/add']['request']
      return { task: deps.services.tasks.addTask(projectId, { title, description }) }
    },
    'tasks/update': (_event, request) => {
      const { taskId, title, description, status } =
        request as IpcContract['tasks/update']['request']
      return { task: deps.services.tasks.updateTask(taskId, { title, description, status }) }
    },
    'tasks/cancel': (_event, request) => {
      const { taskId } = request as IpcContract['tasks/cancel']['request']
      return { task: deps.services.tasks.cancelTask(taskId) }
    },
    'tasks/transition': (_event, request) => {
      const { taskId, to, reason } = request as IpcContract['tasks/transition']['request']
      return { task: deps.services.tasks.applyTransition(taskId, to, reason) }
    },
    'tasks/history': (_event, request) => {
      const { taskId } = request as IpcContract['tasks/history']['request']
      return { transitions: deps.services.tasks.transitionHistory(taskId) }
    },
    'fs/list': (_event, request) => {
      const { projectId, path } = request as IpcContract['fs/list']['request']
      const project = manager().getProject(projectId)
      return { entries: deps.services.explorer(project.path, path ?? '.') }
    },
    'terminal/create': (_event, request) => {
      const { projectId, cols, rows } = request as IpcContract['terminal/create']['request']
      const project = manager().getProject(projectId)
      const terminal = deps.services.terminals.create(project.id, project.path, { cols, rows })
      return { terminal }
    },
    'terminal/write': (_event, request) => {
      const { terminalId, data } = request as IpcContract['terminal/write']['request']
      deps.services.terminals.write(terminalId, data)
      return undefined
    },
    'terminal/resize': (_event, request) => {
      const { terminalId, cols, rows } = request as IpcContract['terminal/resize']['request']
      deps.services.terminals.resize(terminalId, cols, rows)
      return undefined
    },
    'terminal/dispose': (_event, request) => {
      const { terminalId } = request as IpcContract['terminal/dispose']['request']
      deps.services.terminals.dispose(terminalId)
      return undefined
    },
    'terminal/list': (_event, request) => {
      const { projectId } = request as IpcContract['terminal/list']['request']
      return { terminals: deps.services.terminals.list(projectId) }
    },
    'worktrees/list': (_event, request) => {
      const { projectId } = request as IpcContract['worktrees/list']['request']
      return { worktrees: deps.services.worktrees.listForProject(projectId) }
    },
    'worktrees/create': async (_event, request) => {
      const { taskId, attempt } = request as IpcContract['worktrees/create']['request']
      const task = deps.services.tasks.stateForProject
      void task
      const project = projectForTask(deps, taskId)
      const worktree = await deps.services.worktrees.createForAttempt(project, taskId, attempt)
      return { worktree }
    },
    'worktrees/status': (_event, request) => {
      const { worktreeId, status } = request as IpcContract['worktrees/status']['request']
      return { worktree: deps.services.worktrees.setStatus(worktreeId, status) }
    },
    'worktrees/diff': async (_event, request) => {
      const { worktreeId } = request as IpcContract['worktrees/diff']['request']
      const record = deps.services.worktrees.get(worktreeId)
      if (!record) throw new Error('Worktree not found')
      const project = projectForTask(deps, record.taskId)
      return { diff: await deps.services.worktrees.captureDiff(record, project.path) }
    },
    'worktrees/discard': async (_event, request) => {
      const { worktreeId, force } = request as IpcContract['worktrees/discard']['request']
      const record = deps.services.worktrees.get(worktreeId)
      if (!record) throw new Error('Worktree not found')
      const project = projectForTask(deps, record.taskId)
      await deps.services.worktrees.discard(worktreeId, project.path, { force })
      return undefined
    },
    'locks/list': (_event, request) => {
      const { projectId } = request as IpcContract['locks/list']['request']
      // Escalated waits (deadline exceeded) surface in the Human Inbox.
      for (const lock of deps.services.locks.reconcile(projectId)) {
        if (lock.escalatedAt) {
          deps.services.inbox.escalate({
            projectId,
            taskId: lock.ownerTaskId,
            kind: 'lock-conflict',
            title: `Path lock conflict: ${lock.patterns.join(', ')}`,
            detail: 'A waiting lock exceeded its wait deadline while another task holds the scope.',
            evidenceIds: [lock.id],
          })
        }
      }
      return { locks: deps.services.locks.listForProject(projectId) }
    },
    'locks/acquire': (_event, request) => {
      const { projectId, ownerTaskId, patterns } =
        request as IpcContract['locks/acquire']['request']
      return { result: deps.services.locks.acquire({ projectId, ownerTaskId, patterns }) }
    },
    'locks/release': (_event, request) => {
      const { lockId } = request as IpcContract['locks/release']['request']
      deps.services.locks.release(lockId)
      return undefined
    },
    'inbox/list': (_event, request) => {
      const { status } = request as IpcContract['inbox/list']['request']
      return {
        items:
          status === 'resolved'
            ? deps.services.inbox.listResolved()
            : deps.services.inbox.listOpen(),
      }
    },
    'inbox/resolve': async (_event, request) => {
      const { itemId, decision, note, resumeTask } =
        request as IpcContract['inbox/resolve']['request']
      const { item } = await deps.services.inbox.resolve({ itemId, decision, note, resumeTask })
      return { item }
    },
    'verification/run': async (_event, request) => {
      const { projectId, commands, taskId, worktreeId, attempt } =
        request as IpcContract['verification/run']['request']
      const project = manager().getProject(projectId)
      return deps.services.verification.runPipeline(project, commands, {
        taskId,
        worktreeId,
        attempt,
      })
    },
    'verification/history': (_event, request) => {
      const { projectId, taskId } = request as IpcContract['verification/history']['request']
      return {
        evidence: taskId
          ? deps.services.verification.historyForTask(taskId)
          : deps.services.verification.historyForProject(projectId),
      }
    },
    'skills/list': (_event, request) => {
      const { projectPath } = request as IpcContract['skills/list']['request']
      return { skills: deps.services.skills.list(projectPath) }
    },
    'skills/create': (_event, request) => {
      const { input, projectPath } = request as IpcContract['skills/create']['request']
      return { skill: deps.services.skills.create(input, projectPath) }
    },
    'skills/read': (_event, request) => {
      const { name, scope, projectPath } = request as IpcContract['skills/read']['request']
      return { content: deps.services.skills.read(name, scope, projectPath) }
    },
    'skills/write': (_event, request) => {
      const { name, scope, content, projectPath } =
        request as IpcContract['skills/write']['request']
      deps.services.skills.write(name, scope, content, projectPath)
      return undefined
    },
    'skills/import': (_event, request) => {
      const { sourceDir, scope, projectPath } = request as IpcContract['skills/import']['request']
      return { skill: deps.services.skills.import(sourceDir, scope, projectPath) }
    },
    'skills/install-git': (_event, request) => {
      const { gitUrl, scope, projectPath } = request as IpcContract['skills/install-git']['request']
      return { skills: deps.services.skills.installFromGit(gitUrl, scope, projectPath) }
    },
    'skills/set-enabled': (_event, request) => {
      const { name, scope, enabled, projectPath } =
        request as IpcContract['skills/set-enabled']['request']
      deps.services.skills.setEnabled(name, scope, enabled, projectPath)
      return undefined
    },
    'mcp/list': (_event, request) => {
      const { projectPath } = request as IpcContract['mcp/list']['request']
      return { servers: deps.services.mcp.list(projectPath) }
    },
    'mcp/save': (_event, request) => {
      const { config, projectPath } = request as IpcContract['mcp/save']['request']
      return { config: deps.services.mcp.save(config, projectPath) }
    },
    'mcp/remove': (_event, request) => {
      const { name, scope, projectPath } = request as IpcContract['mcp/remove']['request']
      deps.services.mcp.remove(name, scope, projectPath)
      return undefined
    },
    'mcp/set-enabled': (_event, request) => {
      const { name, scope, enabled, projectPath } =
        request as IpcContract['mcp/set-enabled']['request']
      deps.services.mcp.setEnabled(name, scope, enabled, projectPath)
      return undefined
    },
    'mcp/test': (_event, request) => {
      const { name } = request as IpcContract['mcp/test']['request']
      return deps.services.mcp.test(name)
    },
    'pause/state': () => deps.services.pause.snapshot(),
    'pause/set-global': (_event, request) => {
      const { paused } = request as IpcContract['pause/set-global']['request']
      deps.services.pause.setGlobal(paused)
      return deps.services.pause.snapshot()
    },
    'pause/set-project': (_event, request) => {
      const { projectId, paused } = request as IpcContract['pause/set-project']['request']
      deps.services.pause.setProject(projectId, paused)
      return deps.services.pause.snapshot()
    },
    'attempts/start': async (_event, request) => {
      const { projectId, taskId, agentId, model } =
        request as IpcContract['attempts/start']['request']
      const project = manager().getProject(projectId)
      return deps.services.attempts.startAttempt({
        projectId,
        projectPath: project.path,
        taskId,
        agentId,
        model,
      })
    },
    'attempts/end': (_event, request) => {
      const { attemptId, outcome, failureClass, summary, evidenceIds } =
        request as IpcContract['attempts/end']['request']
      return {
        record: deps.services.attempts.endAttempt(attemptId, {
          outcome,
          failureClass,
          summary,
          evidenceIds,
        }),
      }
    },
    'attempts/history': (_event, request) => {
      const { taskId } = request as IpcContract['attempts/history']['request']
      return { attempts: deps.services.attempts.history(taskId) }
    },
    'attempts/retry-or-escalate': async (_event, request) => {
      const { projectId, taskId, rejectionReason } =
        request as IpcContract['attempts/retry-or-escalate']['request']
      const project = manager().getProject(projectId)
      return deps.services.attempts.retryOrEscalate({
        projectId,
        projectPath: project.path,
        taskId,
        rejectionReason,
      })
    },
    'verifier/review': async (_event, request) => {
      const { projectId, taskId, worktreeId, implementerSessionId } =
        request as IpcContract['verifier/review']['request']
      const project = manager().getProject(projectId)
      const decision = await deps.services.verifier.reviewAttempt({
        projectId,
        projectPath: project.path,
        taskId,
        worktreeId,
        implementerSessionId,
      })
      await deps.services.verifier.applyDecision(taskId, decision)
      return { decision }
    },
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
}
