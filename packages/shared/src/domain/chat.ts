import type { RuntimeTodo } from './task.js'

/**
 * Chat/agent runtime domain (spec §28).
 * Shared between the adapter, main process, and renderer chat UI.
 */
export type AgentStatus = 'idle' | 'busy' | 'error'

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  sessionId: string
  role: ChatRole
  text: string
  createdAt: number
  model?: string
  provider?: string
  error?: string
  /** Token usage when reported by the runtime. */
  tokens?: { input: number; output: number }
}

export type RuntimeDetection = {
  available: boolean
  binary: string | null
  version?: string
}

/** Events emitted by a coding-agent runtime, keyed by OpenCode session id. */
export type RuntimeEvent =
  | {
      type: 'message-started'
      sessionId: string
      messageId: string
      role: ChatRole
      model?: string
      provider?: string
    }
  | { type: 'message-text'; sessionId: string; messageId: string; text: string }
  | { type: 'message-completed'; sessionId: string; messageId: string; error?: string }
  | { type: 'session-status'; sessionId: string; status: AgentStatus }
  | { type: 'todos-updated'; sessionId: string; todos: RuntimeTodo[] }
  | { type: 'runtime-error'; error: string }

/** Renderer-facing chat event: a runtime event resolved to its project. */
export type ChatPushEvent =
  | {
      type: 'message-started'
      projectId: string
      messageId: string
      role: ChatRole
      model?: string
      provider?: string
    }
  | { type: 'message-text'; projectId: string; messageId: string; text: string }
  | { type: 'message-completed'; projectId: string; messageId: string; error?: string }
  | { type: 'session-status'; projectId: string; status: AgentStatus }
  | { type: 'runtime-error'; error: string }
  /** Durable task state changed for this project (goal/task/TODO sync). */
  | { type: 'tasks-changed'; projectId: string }

/**
 * The stable abstraction the harness codes against (spec §28). OpenCode
 * specifics stay behind the implementing adapter.
 */
export interface CodingAgentRuntime {
  detect(): Promise<RuntimeDetection>
  /** Returns the base URL of a running runtime, starting one if needed. */
  ensureServer(): Promise<string>
  createSession(workDir: string, title?: string): Promise<{ id: string }>
  /** True when the session still exists on the runtime. */
  resumeSession(sessionId: string): Promise<boolean>
  sendMessage(sessionId: string, text: string): Promise<void>
  stopSession(sessionId: string): Promise<void>
  getStatus(sessionId: string): Promise<AgentStatus>
  listMessages(sessionId: string): Promise<ChatMessage[]>
  /** Child (subagent) session ids for a session (OpenCode native delegation). */
  listChildren(sessionId: string): Promise<string[]>
  /** Native compaction: summarize the session (OpenCode owns compaction). */
  summarizeSession(sessionId: string): Promise<void>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  dispose(): Promise<void>
}
