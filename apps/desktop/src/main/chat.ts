import type { ActivityRepository, ProjectRepository, SessionRepository } from '@studio/persistence'
import type {
  ChatMessage,
  ChatPushEvent,
  CodingAgentRuntime,
  ProjectWorkspace,
  RuntimeEvent,
} from '@studio/shared'
import { isSubstantialRequest, type TaskManager } from '@studio/task-manager'

export interface ChatServiceDeps {
  runtime: CodingAgentRuntime
  projects: ProjectRepository
  sessions: SessionRepository
  activity: ActivityRepository
  tasks: TaskManager
  /** Push a resolved event to the renderer. */
  onEvent: (event: ChatPushEvent) => void
  now?: () => Date
}

/**
 * Bridges the runtime adapter to projects: resolves sessions to projects,
 * persists session references, updates project status, and forwards
 * renderer-facing events.
 */
export class ChatService {
  private readonly now: () => Date
  private wired = false

  constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Subscribes to runtime events once; safe to call repeatedly. */
  wire(): void {
    if (this.wired) return
    this.wired = true
    this.deps.runtime.subscribe((event) => this.handleRuntimeEvent(event))
  }

  private projectForSession(sessionId: string): string | undefined {
    return this.deps.sessions.forSession(sessionId)?.projectId
  }

  private handleRuntimeEvent(event: RuntimeEvent): void {
    const push = (projectId: string | undefined, resolved: ChatPushEvent): void => {
      this.deps.onEvent(resolved)
      if (projectId) this.touchProject(projectId, resolved)
    }

    switch (event.type) {
      case 'message-started': {
        const projectId = this.projectForSession(event.sessionId)
        push(projectId, {
          type: 'message-started',
          projectId: projectId ?? 'unknown',
          messageId: event.messageId,
          role: event.role,
          model: event.model,
          provider: event.provider,
        })
        return
      }
      case 'message-text': {
        const projectId = this.projectForSession(event.sessionId)
        this.deps.onEvent({
          type: 'message-text',
          projectId: projectId ?? 'unknown',
          messageId: event.messageId,
          text: event.text,
        })
        return
      }
      case 'message-completed': {
        const projectId = this.projectForSession(event.sessionId)
        push(projectId, {
          type: 'message-completed',
          projectId: projectId ?? 'unknown',
          messageId: event.messageId,
          error: event.error,
        })
        return
      }
      case 'session-status': {
        const projectId = this.projectForSession(event.sessionId)
        if (!projectId) return
        push(projectId, {
          type: 'session-status',
          projectId,
          status: event.status,
        })
        return
      }
      case 'todos-updated': {
        const projectId = this.projectForSession(event.sessionId)
        if (!projectId) return
        this.deps.tasks.syncOpenCodeTodos(projectId, event.todos)
        this.deps.onEvent({ type: 'tasks-changed', projectId })
        return
      }
      case 'runtime-error': {
        this.deps.onEvent({ type: 'runtime-error', error: event.error })
        return
      }
    }
  }

  private touchProject(projectId: string, event: ChatPushEvent): void {
    if (event.type === 'session-status') {
      this.deps.projects.updateStatus(
        projectId,
        event.status === 'busy' ? 'running' : 'idle',
        this.now().toISOString(),
      )
      return
    }
    if (event.type === 'message-completed' && event.error) {
      this.deps.projects.updateStatus(projectId, 'error', this.now().toISOString())
    }
  }

  /** Returns the project's live session id, creating or resuming as needed. */
  async ensureSession(project: ProjectWorkspace): Promise<string> {
    this.wire()
    const existing = this.deps.sessions.forProject(project.id)

    if (existing && (await this.deps.runtime.resumeSession(existing.id))) {
      return existing.id
    }

    const session = await this.deps.runtime.createSession(project.path, project.name)
    const at = this.now().toISOString()
    this.deps.sessions.upsertForProject({
      id: session.id,
      projectId: project.id,
      runtime: 'opencode',
      createdAt: at,
      updatedAt: at,
    })
    this.deps.projects.setSession(project.id, session.id, at)
    this.deps.activity.record('chat.session', `Session ${session.id} ready`, {
      projectId: project.id,
      payload: { sessionId: session.id, resumed: Boolean(existing) },
    })
    return session.id
  }

  async send(project: ProjectWorkspace, text: string): Promise<void> {
    const sessionId = await this.ensureSession(project)
    await this.deps.runtime.sendMessage(sessionId, text)

    // Substantial requests create a Goal draft + initial task container
    // before broad implementation begins (spec §12.4).
    if (isSubstantialRequest(text)) {
      const intake = this.deps.tasks.intakeSubstantialRequest(project.id, text)
      if (intake.created) {
        this.deps.onEvent({ type: 'tasks-changed', projectId: project.id })
      }
    }

    this.deps.activity.record('chat.send', 'User message sent', {
      projectId: project.id,
      payload: { sessionId, length: text.length },
    })
  }

  async stop(project: ProjectWorkspace): Promise<void> {
    const existing = this.deps.sessions.forProject(project.id)
    if (!existing) return
    await this.deps.runtime.stopSession(existing.id)
    this.deps.activity.record('chat.stop', 'Run stopped by user', {
      projectId: project.id,
    })
  }

  async history(project: ProjectWorkspace): Promise<ChatMessage[]> {
    const existing = this.deps.sessions.forProject(project.id)
    if (!existing) return []
    try {
      return await this.deps.runtime.listMessages(existing.id)
    } catch {
      return []
    }
  }
}
