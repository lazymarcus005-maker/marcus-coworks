import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TerminalService } from '../src/main/terminal.js'

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
}

async function collectUntilPtyIdle(
  output: () => string,
  predicate: (text: string) => boolean,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(output())) return output()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`terminal output condition not reached: ${output().slice(-300)}`)
}

describe('TerminalService', () => {
  const dirA = mkdtempSync(join(tmpdir(), 'studio-term-a-'))
  const dirB = mkdtempSync(join(tmpdir(), 'studio-term-b-'))
  const output = new Map<string, string>()
  const service = new TerminalService({
    onEvent: (event) => {
      if (event.type === 'data') {
        output.set(event.terminalId, (output.get(event.terminalId) ?? '') + event.data)
      }
    },
  })

  afterAll(() => {
    service.disposeAll()
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  })

  it('spawns a zsh terminal whose cwd is the project root', async () => {
    const terminal = service.create('proj-a', dirA)
    expect(terminal.cwd).toBe(dirA)
    expect(terminal.title).toBe('zsh 1')

    service.write(terminal.id, 'pwd\r')
    const text = stripAnsi(
      await collectUntilPtyIdle(
        () => output.get(terminal.id) ?? '',
        (value) => value.includes(dirA),
      ),
    )
    expect(text).toContain(dirA)
  }, 20_000)

  it('terminals of different projects never share a working directory', async () => {
    const terminalA2 = service.create('proj-a', dirA)
    const terminalB = service.create('proj-b', dirB)

    service.write(terminalA2.id, 'pwd\r')
    service.write(terminalB.id, 'pwd\r')

    const outA = await collectUntilPtyIdle(
      () => output.get(terminalA2.id) ?? '',
      (value) => stripAnsi(value).includes(dirA),
    )
    const outB = await collectUntilPtyIdle(
      () => output.get(terminalB.id) ?? '',
      (value) => stripAnsi(value).includes(dirB),
    )

    expect(stripAnsi(outA)).toContain(dirA)
    expect(stripAnsi(outA)).not.toContain(dirB)
    expect(stripAnsi(outB)).toContain(dirB)
    expect(stripAnsi(outB)).not.toContain(dirA)
  }, 20_000)

  it('supports multiple terminals per project and lists them', () => {
    expect(service.list('proj-a')).toHaveLength(2)
    expect(service.list('proj-b')).toHaveLength(1)
  })

  it('disposeProject kills only that project’s terminals', () => {
    service.disposeProject('proj-a')
    expect(service.list('proj-a')).toHaveLength(0)
    expect(service.list('proj-b')).toHaveLength(1)
    service.disposeAll()
    expect(service.list('proj-b')).toHaveLength(0)
  })
})
