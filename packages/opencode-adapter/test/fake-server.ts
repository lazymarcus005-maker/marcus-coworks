import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export type FakeSession = {
  id: string
  directory: string
  messages: { id: string; role: 'user' | 'assistant'; text: string }[]
  aborted: boolean
}

export class FakeOpenCodeServer {
  readonly sessions = new Map<string, FakeSession>()
  readonly children = new Map<string, string[]>()
  private readonly server: Server
  private readonly sseClients = new Set<{
    write: (chunk: string) => void
  }>()
  private counter = 0
  baseUrl = ''

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res))
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address() as AddressInfo
    this.baseUrl = `http://127.0.0.1:${address.port}`
    return this.baseUrl
  }

  async stop(): Promise<void> {
    for (const client of this.sseClients) {
      client.write('data: {"type":"server.disconnected"}\n\n')
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  broadcast(event: unknown): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of this.sseClients) client.write(payload)
  }

  private async handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl)
    const body = await readBody(req)

    if (req.method === 'GET' && url.pathname === '/config') {
      res.end('{}')
      return
    }

    if (req.method === 'POST' && url.pathname === '/session') {
      const id = `ses_fake_${++this.counter}`
      const directory = (JSON.parse(body || '{}') as { directory?: string }).directory ?? ''
      this.sessions.set(id, { id, directory, messages: [], aborted: false })
      respondJson(res, { id, directory })
      return
    }

    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/)
    if (req.method === 'GET' && sessionMatch) {
      const session = this.sessions.get(sessionMatch[1] as string)
      if (!session) {
        res.statusCode = 404
        res.end('{}')
        return
      }
      respondJson(res, { id: session.id })
      return
    }

    const childrenMatch = url.pathname.match(/^\/session\/([^/]+)\/children$/)
    if (req.method === 'GET' && childrenMatch) {
      respondJson(res, this.children.get(childrenMatch[1] as string) ?? [])
      return
    }

    const abortMatch = url.pathname.match(/^\/session\/([^/]+)\/abort$/)
    if (req.method === 'POST' && abortMatch) {
      const session = this.sessions.get(abortMatch[1] as string)
      if (session) session.aborted = true
      res.end('{}')
      return
    }

    const messageMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/)
    if (req.method === 'POST' && messageMatch) {
      const session = this.sessions.get(messageMatch[1] as string)
      if (!session) {
        res.statusCode = 404
        res.end('{}')
        return
      }
      const parts =
        (JSON.parse(body || '{}') as { parts?: { type: string; text?: string }[] }).parts ?? []
      const text = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
      const id = `msg_fake_${++this.counter}`
      session.messages.push({ id, role: 'user', text })
      respondJson(res, {
        info: { id, sessionID: session.id, role: 'assistant', time: { created: Date.now() } },
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/event') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      this.sseClients.add(res)
      req.on('close', () => this.sseClients.delete(res))
      return
    }

    res.statusCode = 404
    res.end('{}')
  }
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += String(chunk)
    })
    req.on('end', () => resolve(data))
  })
}

function respondJson(res: import('node:http').ServerResponse, payload: unknown): void {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}
