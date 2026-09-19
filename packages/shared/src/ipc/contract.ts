import type { HealthInfo } from '../domain/app.js'
import type { ChatMessage, ChatPushEvent } from '../domain/chat.js'
import type { FileEntry, TerminalInfo } from '../domain/fs.js'
import type { InboxDecision, InboxItem, InboxItemStatus } from '../domain/inbox.js'
import type { AcquireResult, ScopeLock } from '../domain/lock.js'
import type {
  ActivityEvent,
  ProjectTab,
  ProjectWorkspace,
  RemoveProjectOptions,
} from '../domain/project.js'
import type { ConnectionTestResult, LlmProvider } from '../domain/provider.js'
import type { GoalContract, HarnessTask, TaskStatus, TaskTransition } from '../domain/task.js'
import type {
  VerificationCommand,
  VerificationEvidence,
  VerificationRun,
} from '../domain/verification.js'
import type { WorktreeDiff, WorktreeRecord, WorktreeStatus } from '../domain/worktree.js'

/**
 * The single source of truth for the renderer <-> main IPC surface.
 *
 * Every channel declares its request and response types here. The preload
 * builds its exposed API from this contract, and the main process registers
 * handlers against it, so both ends are type-checked against the same map.
 */
export interface IpcContract {
  'app/health': { request: undefined; response: HealthInfo }
  'projects/list': { request: undefined; response: { projects: ProjectWorkspace[] } }
  'projects/add': { request: { path: string }; response: { project: ProjectWorkspace } }
  'projects/pick-folder': { request: undefined; response: { path: string } | null }
  'projects/rename': {
    request: { projectId: string; name: string }
    response: { project: ProjectWorkspace }
  }
  'projects/remove': {
    request: { projectId: string; options: RemoveProjectOptions }
    response: undefined
  }
  'projects/tabs/state': {
    request: undefined
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'projects/tabs/close': {
    request: { projectId: string }
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'projects/tabs/open': {
    request: { projectId: string }
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'projects/tabs/activate': {
    request: { projectId: string }
    response: { tabs: ProjectTab[]; activeProjectId: string | null }
  }
  'activity/list': {
    request: { limit?: number }
    response: { events: ActivityEvent[] }
  }
  'providers/list': { request: undefined; response: { providers: LlmProvider[] } }
  'providers/save': {
    /** The API key transits IPC once on save; it is never returned back. */
    request: {
      draft: { id?: string; name: string; type: string; baseUrl: string; defaultModel?: string }
      apiKey?: string
    }
    response: { provider: LlmProvider }
  }
  'providers/delete': { request: { id: string }; response: undefined }
  'providers/test': {
    request: { baseUrl: string; apiKey?: string }
    response: ConnectionTestResult
  }
  /** Tests a saved provider using its Keychain secret without exposing it. */
  'providers/test-saved': { request: { id: string }; response: ConnectionTestResult }
  'chat/start': { request: { projectId: string }; response: { sessionId: string } }
  'chat/send': { request: { projectId: string; text: string }; response: undefined }
  'chat/stop': { request: { projectId: string }; response: undefined }
  'chat/history': {
    request: { projectId: string }
    response: { messages: ChatMessage[] }
  }
  'tasks/state': {
    request: { projectId: string }
    response: { goal?: GoalContract; tasks: HarnessTask[] }
  }
  'tasks/create-goal': {
    request: { projectId: string; objective: string }
    response: { goal: GoalContract }
  }
  'goals/update': {
    request: {
      goalId: string
      patch: {
        objective?: string
        scope?: string[]
        nonGoals?: string[]
        constraints?: string[]
        doneWhen?: string[]
        risk?: string
        maxAttempts?: number
        autonomy?: string
        status?: string
      }
    }
    response: { goal: GoalContract }
  }
  'tasks/add': {
    request: { projectId: string; title: string; description?: string }
    response: { task: HarnessTask }
  }
  'tasks/update': {
    request: { taskId: string; title?: string; description?: string; status?: TaskStatus }
    response: { task: HarnessTask }
  }
  'tasks/cancel': { request: { taskId: string }; response: { task: HarnessTask } }
  'tasks/transition': {
    request: { taskId: string; to: TaskStatus; reason?: string }
    response: { task: HarnessTask }
  }
  'tasks/history': {
    request: { taskId: string }
    response: { transitions: TaskTransition[] }
  }
  'fs/list': { request: { projectId: string; path?: string }; response: { entries: FileEntry[] } }
  'terminal/create': {
    request: { projectId: string; cols?: number; rows?: number }
    response: { terminal: TerminalInfo }
  }
  'terminal/write': { request: { terminalId: string; data: string }; response: undefined }
  'terminal/resize': {
    request: { terminalId: string; cols: number; rows: number }
    response: undefined
  }
  'terminal/dispose': { request: { terminalId: string }; response: undefined }
  'terminal/list': { request: { projectId: string }; response: { terminals: TerminalInfo[] } }
  'worktrees/list': { request: { projectId: string }; response: { worktrees: WorktreeRecord[] } }
  'worktrees/create': {
    request: { taskId: string; attempt: number }
    response: { worktree: WorktreeRecord }
  }
  'worktrees/status': {
    request: { worktreeId: string; status: WorktreeStatus }
    response: { worktree: WorktreeRecord }
  }
  'worktrees/diff': { request: { worktreeId: string }; response: { diff: WorktreeDiff } }
  'worktrees/discard': { request: { worktreeId: string; force?: boolean }; response: undefined }
  'locks/list': { request: { projectId: string }; response: { locks: ScopeLock[] } }
  'locks/acquire': {
    request: { projectId: string; ownerTaskId: string; patterns: string[] }
    response: { result: AcquireResult }
  }
  'locks/release': { request: { lockId: string }; response: undefined }
  'inbox/list': {
    request: { status?: InboxItemStatus }
    response: { items: InboxItem[] }
  }
  'inbox/resolve': {
    request: { itemId: string; decision: InboxDecision; note?: string; resumeTask?: boolean }
    response: { item: InboxItem }
  }
  'verification/run': {
    request: {
      projectId: string
      commands: VerificationCommand[]
      taskId?: string
      worktreeId?: string
      attempt?: number
    }
    response: VerificationRun
  }
  'verification/history': {
    request: { taskId?: string; projectId: string }
    response: { evidence: VerificationEvidence[] }
  }
  'verifier/review': {
    request: {
      projectId: string
      taskId: string
      worktreeId: string
      implementerSessionId?: string
    }
    response: { decision: import('../domain/verifier.js').VerifierDecision }
  }
}

/** Main → renderer push channel for live chat events. */
export const CHAT_EVENT_CHANNEL = 'studio:chat/event'

/** Main → renderer push channel for terminal output/exit events. */
export const TERMINAL_EVENT_CHANNEL = 'studio:terminal/event'

export type IpcChannel = keyof IpcContract

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/** Tab state returned by every tab mutation so the renderer stays stateless. */
export type TabStateResponse = IpcContract['projects/tabs/state']['response']

/**
 * The narrow application API exposed to the renderer via contextBridge.
 * Renderer code never touches fs/shell/Keychain — only this object.
 */
export interface StudioApi {
  app: {
    health(): Promise<HealthInfo>
  }
  projects: {
    list(): Promise<{ projects: ProjectWorkspace[] }>
    add(path: string): Promise<{ project: ProjectWorkspace }>
    pickFolder(): Promise<{ path: string } | null>
    rename(projectId: string, name: string): Promise<{ project: ProjectWorkspace }>
    remove(projectId: string, options: RemoveProjectOptions): Promise<void>
    tabState(): Promise<TabStateResponse>
    closeTab(projectId: string): Promise<TabStateResponse>
    openTab(projectId: string): Promise<TabStateResponse>
    activateTab(projectId: string): Promise<TabStateResponse>
  }
  activity: {
    list(limit?: number): Promise<{ events: ActivityEvent[] }>
  }
  providers: {
    list(): Promise<{ providers: LlmProvider[] }>
    save(
      draft: { id?: string; name: string; type: string; baseUrl: string; defaultModel?: string },
      apiKey?: string,
    ): Promise<{ provider: LlmProvider }>
    remove(id: string): Promise<void>
    test(baseUrl: string, apiKey?: string): Promise<ConnectionTestResult>
    testSaved(id: string): Promise<ConnectionTestResult>
  }
  chat: {
    start(projectId: string): Promise<{ sessionId: string }>
    send(projectId: string, text: string): Promise<void>
    stop(projectId: string): Promise<void>
    history(projectId: string): Promise<{ messages: ChatMessage[] }>
    /** Subscribes to pushed chat events; returns an unsubscribe function. */
    onEvent(listener: (event: ChatPushEvent) => void): () => void
  }
  tasks: {
    state(projectId: string): Promise<{ goal?: GoalContract; tasks: HarnessTask[] }>
    createGoal(projectId: string, objective: string): Promise<{ goal: GoalContract }>
    updateGoal(
      goalId: string,
      patch: {
        objective?: string
        scope?: string[]
        nonGoals?: string[]
        constraints?: string[]
        doneWhen?: string[]
        risk?: string
        maxAttempts?: number
        autonomy?: string
        status?: string
      },
    ): Promise<{ goal: GoalContract }>
    add(projectId: string, title: string, description?: string): Promise<{ task: HarnessTask }>
    update(
      taskId: string,
      fields: { title?: string; description?: string; status?: TaskStatus },
    ): Promise<{ task: HarnessTask }>
    cancel(taskId: string): Promise<{ task: HarnessTask }>
    transition(taskId: string, to: TaskStatus, reason?: string): Promise<{ task: HarnessTask }>
    history(taskId: string): Promise<{ transitions: TaskTransition[] }>
  }
  fs: {
    list(projectId: string, path?: string): Promise<{ entries: FileEntry[] }>
  }
  terminal: {
    create(
      projectId: string,
      size?: { cols?: number; rows?: number },
    ): Promise<{ terminal: TerminalInfo }>
    write(terminalId: string, data: string): Promise<void>
    resize(terminalId: string, cols: number, rows: number): Promise<void>
    dispose(terminalId: string): Promise<void>
    list(projectId: string): Promise<{ terminals: TerminalInfo[] }>
    onEvent(
      listener: (
        event:
          | { type: 'data'; projectId: string; terminalId: string; data: string }
          | { type: 'exit'; projectId: string; terminalId: string },
      ) => void,
    ): () => void
  }
  worktrees: {
    list(projectId: string): Promise<{ worktrees: WorktreeRecord[] }>
    create(taskId: string, attempt: number): Promise<{ worktree: WorktreeRecord }>
    setStatus(worktreeId: string, status: WorktreeStatus): Promise<{ worktree: WorktreeRecord }>
    diff(worktreeId: string): Promise<{ diff: WorktreeDiff }>
    discard(worktreeId: string, force?: boolean): Promise<void>
  }
  locks: {
    list(projectId: string): Promise<{ locks: ScopeLock[] }>
    acquire(
      projectId: string,
      ownerTaskId: string,
      patterns: string[],
    ): Promise<{ result: AcquireResult }>
    release(lockId: string): Promise<void>
  }
  inbox: {
    list(status?: InboxItemStatus): Promise<{ items: InboxItem[] }>
    resolve(
      itemId: string,
      decision: InboxDecision,
      note?: string,
      resumeTask?: boolean,
    ): Promise<{ item: InboxItem }>
  }
  verification: {
    run(
      projectId: string,
      commands: VerificationCommand[],
      context?: { taskId?: string; worktreeId?: string; attempt?: number },
    ): Promise<VerificationRun>
    history(projectId: string, taskId?: string): Promise<{ evidence: VerificationEvidence[] }>
  }
  verifier: {
    review(
      projectId: string,
      taskId: string,
      worktreeId: string,
      implementerSessionId?: string,
    ): Promise<{ decision: import('../domain/verifier.js').VerifierDecision }>
  }
}

export function ipcChannels(): IpcChannel[] {
  return [
    'app/health',
    'projects/list',
    'projects/add',
    'projects/pick-folder',
    'projects/rename',
    'projects/remove',
    'projects/tabs/state',
    'projects/tabs/close',
    'projects/tabs/open',
    'projects/tabs/activate',
    'activity/list',
    'providers/list',
    'providers/save',
    'providers/delete',
    'providers/test',
    'providers/test-saved',
    'chat/start',
    'chat/send',
    'chat/stop',
    'chat/history',
    'tasks/state',
    'tasks/create-goal',
    'goals/update',
    'tasks/add',
    'tasks/update',
    'tasks/cancel',
    'tasks/transition',
    'tasks/history',
    'fs/list',
    'terminal/create',
    'terminal/write',
    'terminal/resize',
    'terminal/dispose',
    'terminal/list',
    'worktrees/list',
    'worktrees/create',
    'worktrees/status',
    'worktrees/diff',
    'worktrees/discard',
    'locks/list',
    'locks/acquire',
    'locks/release',
    'inbox/list',
    'inbox/resolve',
    'verification/run',
    'verification/history',
    'verifier/review',
  ]
}
