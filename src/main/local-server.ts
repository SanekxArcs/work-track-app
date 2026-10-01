import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export const WORK_BUDDY_LOCAL_PORT = 49837

export interface ExtensionServerStatus {
  running: boolean
  port: number
  connections: number
  error: string | null
}

export type RemoteAction = (method: string, args: unknown[]) => Promise<unknown> | unknown

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 1_048_576) throw new Error('Request body is too large')
    chunks.push(value)
  }
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keysMatch(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
}

/**
 * Private, loopback-only bridge for the companion browser extension. SQLite
 * stays inside the desktop process; no browser process ever touches its file.
 */
export class WorkBuddyLocalServer {
  private server: Server | null = null
  private readonly streams = new Set<ServerResponse>()
  private readonly clients = new Map<string, number>()
  private clientExpiryTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(status: ExtensionServerStatus) => void>()
  private lastError: string | null = null

  constructor(
    private readonly accessKey: string,
    private readonly invoke: RemoteAction,
    private readonly onDataChanged: () => void
  ) {}

  getStatus(): ExtensionServerStatus {
    const oldestActiveAt = Date.now() - 45_000
    for (const [id, lastSeenAt] of this.clients) if (lastSeenAt < oldestActiveAt) this.clients.delete(id)
    return {
      running: this.server?.listening === true,
      port: WORK_BUDDY_LOCAL_PORT,
      connections: this.clients.size,
      error: this.lastError
    }
  }

  onStatusChange(listener: (status: ExtensionServerStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitStatus(): void {
    const status = this.getStatus()
    for (const listener of this.listeners) listener(status)
  }

  private setCors(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin
    // The bridge is intentionally available only to extension origins. It is
    // bound to 127.0.0.1 as a second boundary and every data request is keyed.
    if (origin?.startsWith('chrome-extension://')) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Work-Buddy-Key')
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
  }

  private isAuthorized(request: IncomingMessage, url: URL): boolean {
    return keysMatch(request.headers['x-work-buddy-key'] as string | undefined, this.accessKey)
      || keysMatch(url.searchParams.get('key') ?? undefined, this.accessKey)
  }

  private touchClient(request: IncomingMessage): void {
    const client = request.headers['x-work-buddy-client']
    if (typeof client !== 'string' || client.length === 0 || client.length > 256) return
    const isNew = !this.clients.has(client)
    this.clients.set(client, Date.now())
    if (this.clientExpiryTimer) clearTimeout(this.clientExpiryTimer)
    this.clientExpiryTimer = setTimeout(() => {
      this.clientExpiryTimer = null
      this.getStatus()
      this.emitStatus()
    }, 46_000)
    if (isNew) this.emitStatus()
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.setCors(request, response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', `http://127.0.0.1:${WORK_BUDDY_LOCAL_PORT}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true, ...this.getStatus() })
      return
    }

    if (!this.isAuthorized(request, url)) {
      writeJson(response, 401, { error: 'Pair this extension with Work Buddy first.' })
      return
    }
    this.touchClient(request)

    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      response.write('event: ready\ndata: {}\n\n')
      this.streams.add(response)
      this.emitStatus()
      const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25_000)
      request.on('close', () => {
        clearInterval(keepAlive)
        this.streams.delete(response)
        this.emitStatus()
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api') {
      try {
        const payload = await readJson(request)
        if (!isRecord(payload) || typeof payload.method !== 'string' || !Array.isArray(payload.args)) {
          writeJson(response, 400, { error: 'Expected method and args.' })
          return
        }
        const result = await this.invoke(payload.method, payload.args)
        if (!['getAppVersion', 'getSnapshot', 'getHistory', 'getDaySnapshot', 'getOvertimeOverview', 'getCustomSoundData', 'getProjectStats'].includes(payload.method)) {
          this.onDataChanged()
        }
        writeJson(response, 200, { result })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected server error'
        writeJson(response, 400, { error: message })
      }
      return
    }

    writeJson(response, 404, { error: 'Not found' })
  }

  async start(): Promise<void> {
    if (this.server?.listening) return
    this.server = createServer((request, response) => void this.handle(request, response))
    this.server.on('error', (error) => {
      this.lastError = error.message
      this.emitStatus()
    })
    await new Promise<void>((resolve, reject) => {
      const server = this.server
      if (!server) return reject(new Error('Local server is unavailable'))
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        this.lastError = null
        this.emitStatus()
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(WORK_BUDDY_LOCAL_PORT, '127.0.0.1')
    })
  }

  notifyChanged(): void {
    for (const stream of this.streams) stream.write('event: changed\ndata: {}\n\n')
  }

  async stop(): Promise<void> {
    if (this.clientExpiryTimer) clearTimeout(this.clientExpiryTimer)
    this.clientExpiryTimer = null
    for (const stream of this.streams) stream.end()
    this.streams.clear()
    if (!this.server) return
    const server = this.server
    this.server = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.emitStatus()
  }
}
