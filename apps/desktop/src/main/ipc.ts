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
    'tasks/update-goal': (_event, request) => {
      const { goalId, objective } = request as IpcContract['tasks/update-goal']['request']
      return { goal: deps.services.tasks.updateGoalObjective(goalId, objective) }
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
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler)
  }
}
