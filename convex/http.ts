import {
  httpActionGeneric,
  httpRouter,
  makeFunctionReference
} from 'convex/server'
import type { GenericId } from 'convex/values'
import {
  validateActivityEnvelope,
  validActivityId,
  validActivityDay
} from '../src/shared/activity'
import { MAX_SYNC_BYTES, validateSnapshot, validKeys } from './validation'

const http = httpRouter()
const publish = makeFunctionReference<
  'mutation',
  { sourceId: string; storageId: GenericId<'_storage'>; exportedAt: number },
  { sourceId: string; syncedAt: number; accepted: boolean; reason?: string }
>('snapshots:publish')
const latest = makeFunctionReference<
  'query',
  { sourceId: string },
  { storageId: GenericId<'_storage'>; syncedAt: number } | null
>('snapshots:latest')
const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
}
/**
 * Machine-readable error codes. The `error`/`detail` strings stay stable for
 * older clients that match on them; new clients should switch on `code`.
 */
type ErrorCode =
  | 'UNAUTHORIZED'
  | 'KEYS_NOT_CONFIGURED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_SNAPSHOT'
  | 'INVALID_SOURCE'
  | 'INVALID_ACTIVITY_DAY'
  | 'OUTSIDE_RETENTION'
  | 'INVALID_DEVICE'
  | 'INVALID_CATALOG'
  | 'LINK_CONFLICT'
  | 'NOT_FOUND'
  | 'RETRY'
  | 'INVALID_LINK'
  | 'INTERNAL'
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers })
}
function fail(
  status: number,
  error: string,
  code: ErrorCode,
  detail?: string
): Response {
  return reply({ error, code, ...(detail ? { detail } : {}) }, status)
}
const bytes = (text: string): number => new TextEncoder().encode(text).length
const isJson = (request: Request): boolean =>
  Boolean(request.headers.get('Content-Type')?.includes('application/json'))
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10)
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  )
}
/** Compares secrets without leaking their length or a matching prefix through timing. */
async function sameSecret(presented: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(presented), digest(expected)])
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0)
  return diff === 0
}
async function authorize(
  request: Request,
  mode: 'read' | 'write'
): Promise<Response | null> {
  const write = process.env.WORK_BUDDY_WRITE_KEY
  const read = process.env.WORK_BUDDY_READ_KEY
  if (!validKeys(write, read))
    return fail(
      503,
      'Configure distinct read and write keys of at least 32 characters',
      'KEYS_NOT_CONFIGURED'
    )
  const expected = `Bearer ${mode === 'write' ? write : read}`
  const presented = request.headers.get('Authorization') ?? ''
  if (!(await sameSecret(presented, expected)))
    return fail(401, 'Unauthorized', 'UNAUTHORIZED')
  return null
}
http.route({
  path: '/work-buddy/snapshot',
  method: 'PUT',
  handler: httpActionGeneric(async (ctx, request) => {
    const denied = await authorize(request, 'write')
    if (denied) return denied
    if (!isJson(request))
      return fail(415, 'Expected application/json', 'UNSUPPORTED_MEDIA_TYPE')
    const raw = await request.text()
    if (bytes(raw) > MAX_SYNC_BYTES)
      return fail(413, 'Snapshot exceeds 10 MB', 'PAYLOAD_TOO_LARGE')
    let snapshot: Record<string, unknown>
    try {
      snapshot = validateSnapshot(JSON.parse(raw))
    } catch {
      return fail(400, 'Invalid Work Buddy snapshot', 'INVALID_SNAPSHOT')
    }
    const storageId = await ctx.storage.store(
      new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
    )
    try {
      const receipt = await ctx.runMutation(publish, {
        sourceId: snapshot.sourceId as string,
        exportedAt: snapshot.exportedAt as number,
        storageId
      })
      return reply(receipt)
    } catch (error) {
      await ctx.storage.delete(storageId)
      throw error
    }
  })
})
http.route({
  path: '/work-buddy/snapshot',
  method: 'GET',
  handler: httpActionGeneric(async (ctx, request) => {
    const denied = await authorize(request, 'read')
    if (denied) return denied
    const sourceId = new URL(request.url).searchParams.get('sourceId')
    if (!sourceId || !/^[a-zA-Z0-9-]{1,80}$/.test(sourceId))
      return fail(400, 'A valid sourceId is required', 'INVALID_SOURCE')
    const record = await ctx.runQuery(latest, { sourceId })
    if (!record)
      return fail(404, 'No upload for this source yet', 'NOT_FOUND')
    const blob = await ctx.storage.get(record.storageId)
    if (!blob)
      return fail(409, 'Snapshot changed; retry the request', 'RETRY')
    return reply({
      syncedAt: record.syncedAt,
      data: JSON.parse(await blob.text())
    })
  })
})
const activityPublish = makeFunctionReference<
  'mutation',
  {
    sourceId: string
    deviceId: string
    day: string
    kind: string
    storageId: GenericId<'_storage'>
    capturedAt: number
    expiresAt: number
    cutoffDay: string
  },
  {
    sourceId: string
    day: string
    syncedAt: number
    accepted: boolean
    reason?: string
  }
>('activity:publish')
const activityDay = makeFunctionReference<
  'query',
  { deviceId: string; day: string },
  Array<{ storageId: GenericId<'_storage'>; syncedAt: number }>
>('activity:day')
/** Validator messages that are safe to echo to the client as `detail`. */
const activityDetails = [
  'Invalid activity envelope',
  'Invalid activity record',
  'Activity outside labelled day',
  'Invalid activity context',
  'Invalid URL',
  'Only web addresses are supported',
  'Activity day is in the future'
]
http.route({
  path: '/work-buddy/activity',
  method: 'PUT',
  handler: httpActionGeneric(async (ctx, request) => {
    const denied = await authorize(request, 'write')
    if (denied) return denied
    if (!isJson(request))
      return fail(415, 'Expected application/json', 'UNSUPPORTED_MEDIA_TYPE')
    const raw = await request.text()
    if (bytes(raw) > 5 * 1024 * 1024)
      return fail(413, 'Activity day exceeds 5 MB', 'PAYLOAD_TOO_LARGE')
    let data
    try {
      data = validateActivityEnvelope(JSON.parse(raw))
    } catch (error) {
      return fail(
        400,
        'Invalid activity day',
        'INVALID_ACTIVITY_DAY',
        error instanceof Error && activityDetails.includes(error.message)
          ? error.message
          : 'Invalid activity data'
      )
    }
    const now = Date.now()
    // Local calendars can run up to a day ahead of UTC; anything later is bogus.
    if (data.day > utcDay(now + 86400000))
      return fail(
        400,
        'Invalid activity day',
        'INVALID_ACTIVITY_DAY',
        'Activity day is in the future'
      )
    const cutoffDay = utcDay(now - data.retentionDays * 86400000)
    if (data.day < cutoffDay)
      return fail(400, 'Activity is outside retention', 'OUTSIDE_RETENTION')
    const storageId = await ctx.storage.store(
      new Blob([JSON.stringify(data)], { type: 'application/json' })
    )
    try {
      return reply(
        await ctx.runMutation(activityPublish, {
          sourceId: data.sourceId,
          deviceId: data.deviceId,
          day: data.day,
          kind: data.kind,
          storageId,
          capturedAt: data.capturedAt,
          expiresAt:
            Date.parse(data.day + 'T00:00:00Z') +
            (data.retentionDays + 1) * 86400000,
          cutoffDay
        })
      )
    } catch (error) {
      await ctx.storage.delete(storageId)
      throw error
    }
  })
})
http.route({
  path: '/work-buddy/activity',
  method: 'GET',
  handler: httpActionGeneric(async (ctx, request) => {
    const denied = await authorize(request, 'read')
    if (denied) return denied
    const params = new URL(request.url).searchParams,
      deviceId = params.get('deviceId'),
      day = params.get('day')
    if (!validActivityId(deviceId) || !validActivityDay(day))
      return fail(
        400,
        'A valid deviceId and day are required',
        'INVALID_DEVICE'
      )
    const records = await ctx.runQuery(activityDay, { deviceId, day })
    const sources = []
    for (const record of records) {
      const blob = await ctx.storage.get(record.storageId)
      if (!blob) return fail(409, 'Activity changed; retry', 'RETRY')
      const data = JSON.parse(await blob.text())
      if (data.day >= utcDay(Date.now() - data.retentionDays * 86400000))
        sources.push({ syncedAt: record.syncedAt, data })
    }
    return reply({ sources, fetchedAt: Date.now() })
  })
})
const projectsPublish = makeFunctionReference<
  'mutation',
  {
    deviceId: string
    sourceId: string
    kind: string
    capturedAt: number
    projects: Array<{
      id: string
      name: string
      archived: boolean
      color?: string
    }>
  },
  { ok: boolean; accepted: boolean; reason?: string }
>('projects:publish')
const projectsRegistry = makeFunctionReference<'query'>('projects:registry')
const projectsLink = makeFunctionReference<
  'mutation',
  {
    deviceId: string
    browserSourceId: string
    browserProjectId: string
    projectId: string | null
    expectedRevision: number
  },
  { conflict: boolean }
>('projects:link')
const linkConflict = 'Project changed. Refresh projects and try again.'
/** The link mutation throws when either side of the link vanished since the client last refreshed. */
const isLinkConflict = (error: unknown): boolean =>
  error instanceof Error &&
  /(Browser|Work) project no longer exists/.test(error.message)
http.route({
  path: '/work-buddy/projects',
  method: 'GET',
  handler: httpActionGeneric(async (ctx, request) => {
    // Catalogs contain labels only. The browser write credential cannot read activity or snapshots.
    const denied = await authorize(request, 'read')
    if (denied && (await authorize(request, 'write'))) return denied
    const deviceId = new URL(request.url).searchParams.get('deviceId')
    if (!validActivityId(deviceId))
      return fail(400, 'Invalid device', 'INVALID_DEVICE')
    return reply(await ctx.runQuery(projectsRegistry, { deviceId }))
  })
})
http.route({
  path: '/work-buddy/projects',
  method: 'PUT',
  handler: httpActionGeneric(async (ctx, request) => {
    const denied = await authorize(request, 'write')
    if (denied) return denied
    if (!isJson(request))
      return fail(415, 'Expected application/json', 'UNSUPPORTED_MEDIA_TYPE')
    const text = await request.text()
    if (bytes(text) > 2000000)
      return fail(413, 'Catalog too large', 'PAYLOAD_TOO_LARGE')
    let catalog: {
      deviceId: string
      sourceId: string
      kind: string
      capturedAt: number
      projects: Array<{
        id: string
        name: string
        archived: boolean
        color?: string
      }>
    }
    try {
      const raw = JSON.parse(text)
      if (
        !validActivityId(raw.deviceId) ||
        !validActivityId(raw.sourceId) ||
        !['desktop', 'browser'].includes(raw.kind) ||
        !Number.isSafeInteger(raw.capturedAt) ||
        raw.capturedAt > Date.now() + 60000 ||
        !Array.isArray(raw.projects) ||
        raw.projects.length > 5000
      )
        throw new Error('Invalid catalog')
      const projects = raw.projects.map(
        (p: {
          id: string
          name: string
          archived: boolean
          color?: string
        }) => {
          if (
            !p ||
            typeof p.id !== 'string' ||
            !p.id ||
            p.id.length > 160 ||
            typeof p.name !== 'string' ||
            !p.name.trim() ||
            p.name.length > 1000 ||
            typeof p.archived !== 'boolean' ||
            (p.color !== undefined &&
              (typeof p.color !== 'string' || p.color.length > 100))
          )
            throw new Error('Invalid project')
          return {
            id: p.id,
            name: p.name,
            archived: p.archived,
            ...(p.color ? { color: p.color } : {})
          }
        }
      )
      if (
        new Set(projects.map((p: { id: string }) => p.id)).size !==
        projects.length
      )
        throw new Error('Duplicate project')
      catalog = {
        deviceId: raw.deviceId,
        sourceId: raw.sourceId,
        kind: raw.kind,
        capturedAt: raw.capturedAt,
        projects
      }
    } catch {
      return fail(400, 'Invalid project catalog', 'INVALID_CATALOG')
    }
    // Mutation failures are server faults and must surface as 500, not 400.
    return reply(await ctx.runMutation(projectsPublish, catalog))
  })
})
http.route({
  path: '/work-buddy/project-link',
  method: 'PUT',
  handler: httpActionGeneric(async (ctx, request) => {
    const denied = await authorize(request, 'write')
    if (denied) return denied
    const text = await request.text()
    if (bytes(text) > 4096)
      return fail(413, 'Link too large', 'PAYLOAD_TOO_LARGE')
    let link: {
      deviceId: string
      browserSourceId: string
      browserProjectId: string
      projectId: string | null
      expectedRevision: number
    }
    try {
      const r = JSON.parse(text)
      if (
        !validActivityId(r.deviceId) ||
        !validActivityId(r.browserSourceId) ||
        typeof r.browserProjectId !== 'string' ||
        !r.browserProjectId ||
        r.browserProjectId.length > 160 ||
        !(
          r.projectId === null ||
          (typeof r.projectId === 'string' && r.projectId.length <= 160)
        ) ||
        !Number.isSafeInteger(r.expectedRevision) ||
        r.expectedRevision < 0
      )
        throw new Error('Invalid link')
      link = {
        deviceId: r.deviceId,
        browserSourceId: r.browserSourceId,
        browserProjectId: r.browserProjectId,
        projectId: r.projectId,
        expectedRevision: r.expectedRevision
      }
    } catch {
      return fail(400, linkConflict, 'INVALID_LINK')
    }
    let result
    try {
      result = await ctx.runMutation(projectsLink, link)
    } catch (error) {
      if (isLinkConflict(error))
        return fail(409, linkConflict, 'LINK_CONFLICT')
      throw error
    }
    if (result.conflict)
      return reply(
        { ...result, error: linkConflict, code: 'LINK_CONFLICT' },
        409
      )
    return reply({ ...result, accepted: true })
  })
})
export default http
