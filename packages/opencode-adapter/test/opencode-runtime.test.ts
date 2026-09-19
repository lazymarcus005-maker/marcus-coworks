import type { RuntimeEvent } from '@studio/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OpenCodeRuntime } from '../src/opencode-runtime.js'
import { FakeOpenCodeServer } from './fake-server.js'

let server: FakeOpenCodeServer
let runtime: OpenCodeRuntime
const events: RuntimeEvent[] = []

beforeAll(async () => {
  server = new FakeOpenCodeServer()
  await server.start()
  runtime = new OpenCodeRuntime({ baseUrl: server.baseUrl })
  runtime.subscribe((event) => events.push(event))
})

afterAll(async () => {
  await runtime.dispose()
  await server.stop()
})

describe('OpenCodeRuntime against a fake server', () => {
  it('detects availability when a base URL is provided', async () => {
    const detection = await runtime.detect()
    expect(detection.available).toBe(true)
  })

  it('createSession posts the working directory and returns the id', async () => {
    const { id } = await runtime.createSession('/tmp/project-a')
    expect(id).toMatch(/^ses_fake_\d+$/)
    expect(server.sessions.get(id)?.directory).toBe('/tmp/project-a')
  })

  it('holds independent sessions per project', async () => {
    const a = await runtime.createSession('/tmp/project-a')
    const b = await runtime.createSession('/tmp/project-b')
    expect(a.id).not.toBe(b.id)

    await runtime.sendMessage(a.id, 'hello from A')
    await runtime.sendMessage(b.id, 'hello from B')

    const messagesA = server.sessions.get(a.id)?.messages ?? []
    const messagesB = server.sessions.get(b.id)?.messages ?? []
    expect(messagesA).toHaveLength(1)
    expect(messagesB).toHaveLength(1)
    expect(messagesA[0]?.text).toBe('hello from A')
    expect(messagesB[0]?.text).toBe('hello from B')
  })

  it('stopSession aborts only the target session', async () => {
    const a = await runtime.createSession('/tmp/project-a')
    const b = await runtime.createSession('/tmp/project-b')
    await runtime.stopSession(a.id)
    expect(server.sessions.get(a.id)?.aborted).toBe(true)
    expect(server.sessions.get(b.id)?.aborted).toBe(false)
  })

  it('resumeSession is true for existing, false for missing sessions', async () => {
    const session = await runtime.createSession('/tmp/project-a')
    expect(await runtime.resumeSession(session.id)).toBe(true)
    expect(await runtime.resumeSession('ses_missing')).toBe(false)
  })

  it('maps SSE events to runtime events', async () => {
    const session = await runtime.createSession('/tmp/events')

    server.broadcast({
      type: 'busy',
      properties: { sessionID: session.id },
    })
    server.broadcast({
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg_1',
          sessionID: session.id,
          role: 'assistant',
          time: { created: 1 },
          modelID: 'qwen',
          providerID: 'omlx',
        },
      },
    })
    server.broadcast({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'text',
          text: 'Streaming answer',
          id: 'prt_1',
          sessionID: session.id,
          messageID: 'msg_1',
        },
      },
    })
    server.broadcast({
      type: 'message.updated',
      properties: {
        info: {
          id: 'msg_1',
          sessionID: session.id,
          role: 'assistant',
          time: { created: 1, completed: 2 },
        },
      },
    })
    server.broadcast({
      type: 'idle',
      properties: { sessionID: session.id },
    })

    await waitFor(() =>
      events.some((event) => event.type === 'message-completed' && event.messageId === 'msg_1'),
    )

    const started = events.find(
      (event) => event.type === 'message-started' && event.messageId === 'msg_1',
    )
    expect(started).toMatchObject({ role: 'assistant', model: 'qwen', provider: 'omlx' })

    const text = events.find(
      (event) => event.type === 'message-text' && event.messageId === 'msg_1',
    )
    expect(text).toMatchObject({ text: 'Streaming answer' })

    const statuses = events
      .filter((event) => event.type === 'session-status' && event.sessionId === session.id)
      .map((event) => (event.type === 'session-status' ? event.status : ''))
    expect(statuses).toEqual(['busy', 'idle'])
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (!predicate()) throw new Error('condition not reached in time')
}
