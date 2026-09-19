import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeEvent } from '@studio/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findOpenCodeBinary, OpenCodeRuntime } from '../src/opencode-runtime.js'

/**
 * Live integration against the real opencode binary. Skipped when the
 * binary is not installed or has no configured provider.
 */
const binary = await findOpenCodeBinary()
const runtime = binary ? new OpenCodeRuntime({ binaryPath: binary }) : undefined
const events: RuntimeEvent[] = []
let dir: string

describe.skipIf(!binary || !runtime)('OpenCodeRuntime live', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'studio-live-'))
    runtime?.subscribe((event) => events.push(event))
  })

  afterAll(async () => {
    await runtime?.dispose()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('detects the binary with a version', async () => {
    const detection = await runtime?.detect()
    expect(detection?.available).toBe(true)
    expect(detection?.version).toBeTruthy()
  })

  it('starts the server, creates a session, streams a reply, and aborts cleanly', {
    timeout: 180_000,
  }, async () => {
    const base = (await runtime?.ensureServer()) as string
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const session = (await runtime?.createSession(dir, 'adapter-live-test')) as { id: string }
    expect(session.id).toMatch(/^ses_/)

    await runtime?.sendMessage(session.id, 'Reply with exactly: OK')

    // Transport proof: the assistant message must reach a terminal state.
    // (The configured provider may be a local endpoint that is down; that is
    // environmental, not an adapter failure — record it and continue.)
    await waitFor(
      () =>
        events.some(
          (event) => event.type === 'message-completed' && event.sessionId === session.id,
        ),
      90_000,
    )

    const completed = events.find(
      (event) => event.type === 'message-completed' && event.sessionId === session.id,
    )
    const providerError = completed?.type === 'message-completed' ? completed.error : undefined
    if (providerError) {
      console.warn('live provider error (non-fatal for adapter):', providerError)
    }

    const history = (await runtime?.listMessages(session.id)) ?? []
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0]?.role).toBe('user')

    if (!providerError) {
      const text = events
        .filter((event) => event.type === 'message-text' && event.sessionId === session.id)
        .map((event) => (event as { text: string }).text)
        .join('')
      expect(text).toContain('OK')
    }

    expect(await runtime?.resumeSession(session.id)).toBe(true)
  })
})

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!predicate()) throw new Error(`condition not reached within ${timeoutMs}ms`)
}
