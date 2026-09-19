import type { IpcChannel, IpcContract, StudioApi } from '@studio/shared'
import { CHAT_EVENT_CHANNEL, TERMINAL_EVENT_CHANNEL } from '@studio/shared'
import { contextBridge, ipcRenderer } from 'electron'

async function invoke<C extends IpcChannel>(
  channel: C,
  request: IpcContract[C]['request'],
): Promise<IpcContract[C]['response']> {
  return ipcRenderer.invoke(channel, request)
}

const api: StudioApi = {
  app: {
    health: () => invoke('app/health', undefined),
  },
  projects: {
    list: () => invoke('projects/list', undefined),
    add: (path) => invoke('projects/add', { path }),
    pickFolder: () => invoke('projects/pick-folder', undefined),
    rename: (projectId, name) => invoke('projects/rename', { projectId, name }),
    remove: (projectId, options) => invoke('projects/remove', { projectId, options }),
    tabState: () => invoke('projects/tabs/state', undefined),
    closeTab: (projectId) => invoke('projects/tabs/close', { projectId }),
    openTab: (projectId) => invoke('projects/tabs/open', { projectId }),
    activateTab: (projectId) => invoke('projects/tabs/activate', { projectId }),
  },
  activity: {
    list: (limit) => invoke('activity/list', { limit }),
  },
  providers: {
    list: () => invoke('providers/list', undefined),
    save: (draft, apiKey) => invoke('providers/save', { draft, apiKey }),
    remove: (id) => invoke('providers/delete', { id }),
    test: (baseUrl, apiKey) => invoke('providers/test', { baseUrl, apiKey }),
    testSaved: (id) => invoke('providers/test-saved', { id }),
  },
  chat: {
    start: (projectId) => invoke('chat/start', { projectId }),
    send: (projectId, text) => invoke('chat/send', { projectId, text }),
    stop: (projectId) => invoke('chat/stop', { projectId }),
    history: (projectId) => invoke('chat/history', { projectId }),
    onEvent: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) =>
        listener(payload)
      ipcRenderer.on(CHAT_EVENT_CHANNEL, handler)
      return () => ipcRenderer.removeListener(CHAT_EVENT_CHANNEL, handler)
    },
  },
  tasks: {
    state: (projectId) => invoke('tasks/state', { projectId }),
    createGoal: (projectId, objective) => invoke('tasks/create-goal', { projectId, objective }),
    updateGoal: (goalId, patch) => invoke('goals/update', { goalId, patch }),
    add: (projectId, title, description) => invoke('tasks/add', { projectId, title, description }),
    update: (taskId, fields) => invoke('tasks/update', { taskId, ...fields }),
    cancel: (taskId) => invoke('tasks/cancel', { taskId }),
    transition: (taskId, to, reason) => invoke('tasks/transition', { taskId, to, reason }),
    history: (taskId) => invoke('tasks/history', { taskId }),
  },
  fs: {
    list: (projectId, path) => invoke('fs/list', { projectId, path }),
  },
  terminal: {
    create: (projectId, size) =>
      invoke('terminal/create', {
        projectId,
        cols: size?.cols,
        rows: size?.rows,
      }),
    write: (terminalId, data) => invoke('terminal/write', { terminalId, data }),
    resize: (terminalId, cols, rows) => invoke('terminal/resize', { terminalId, cols, rows }),
    dispose: (terminalId) => invoke('terminal/dispose', { terminalId }),
    list: (projectId) => invoke('terminal/list', { projectId }),
    onEvent: (listener) => {
      const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) =>
        listener(payload)
      ipcRenderer.on(TERMINAL_EVENT_CHANNEL, handler)
      return () => ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, handler)
    },
  },
  worktrees: {
    list: (projectId) => invoke('worktrees/list', { projectId }),
    create: (taskId, attempt) => invoke('worktrees/create', { taskId, attempt }),
    setStatus: (worktreeId, status) => invoke('worktrees/status', { worktreeId, status }),
    diff: (worktreeId) => invoke('worktrees/diff', { worktreeId }),
    discard: (worktreeId, force) => invoke('worktrees/discard', { worktreeId, force }),
  },
  locks: {
    list: (projectId) => invoke('locks/list', { projectId }),
    acquire: (projectId, ownerTaskId, patterns) =>
      invoke('locks/acquire', { projectId, ownerTaskId, patterns }),
    release: (lockId) => invoke('locks/release', { lockId }),
  },
  inbox: {
    list: (status) => invoke('inbox/list', { status }),
    resolve: (itemId, decision, note, resumeTask) =>
      invoke('inbox/resolve', { itemId, decision, note, resumeTask }),
  },
  verification: {
    run: (projectId, commands, context) =>
      invoke('verification/run', {
        projectId,
        commands,
        taskId: context?.taskId,
        worktreeId: context?.worktreeId,
        attempt: context?.attempt,
      }),
    history: (projectId, taskId) => invoke('verification/history', { projectId, taskId }),
  },
  verifier: {
    review: (projectId, taskId, worktreeId, implementerSessionId) =>
      invoke('verifier/review', { projectId, taskId, worktreeId, implementerSessionId }),
  },
  agents: {
    list: (projectPath) => invoke('agents/list', { projectPath }),
    save: (profile, projectPath) => invoke('agents/save', { profile, projectPath }),
    remove: (name, projectPath) => invoke('agents/remove', { name, projectPath }),
    tree: (sessionId) => invoke('agents/tree', { sessionId }),
  },
  skills: {
    list: (projectPath) => invoke('skills/list', { projectPath }),
    create: (input, projectPath) => invoke('skills/create', { input, projectPath }),
    read: (name, scope, projectPath) => invoke('skills/read', { name, scope, projectPath }),
    write: (name, scope, content, projectPath) =>
      invoke('skills/write', { name, scope, content, projectPath }),
    import: (sourceDir, scope, projectPath) =>
      invoke('skills/import', { sourceDir, scope, projectPath }),
    installFromGit: (gitUrl, scope, projectPath) =>
      invoke('skills/install-git', { gitUrl, scope, projectPath }),
    setEnabled: (name, scope, enabled, projectPath) =>
      invoke('skills/set-enabled', { name, scope, enabled, projectPath }),
  },
  mcp: {
    list: (projectPath) => invoke('mcp/list', { projectPath }),
    save: (config, projectPath) => invoke('mcp/save', { config, projectPath }),
    remove: (name, scope, projectPath) => invoke('mcp/remove', { name, scope, projectPath }),
    setEnabled: (name, scope, enabled, projectPath) =>
      invoke('mcp/set-enabled', { name, scope, enabled, projectPath }),
    test: (name) => invoke('mcp/test', { name }),
  },
  pause: {
    state: () => invoke('pause/state', undefined),
    setGlobal: (paused) => invoke('pause/set-global', { paused }),
    setProject: (projectId, paused) => invoke('pause/set-project', { projectId, paused }),
  },
  attempts: {
    start: (projectId, taskId, agentId, model) =>
      invoke('attempts/start', { projectId, taskId, agentId, model }),
    end: (attemptId, input) => invoke('attempts/end', { attemptId, ...input }),
    history: (taskId) => invoke('attempts/history', { taskId }),
    retryOrEscalate: (projectId, taskId, rejectionReason) =>
      invoke('attempts/retry-or-escalate', { projectId, taskId, rejectionReason }),
  },
}

contextBridge.exposeInMainWorld('studio', api)
