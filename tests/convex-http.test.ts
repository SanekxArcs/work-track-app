import assert from 'node:assert/strict'
import test from 'node:test'
import http from '../convex/http.ts'
import { syncPayload } from '../src/main/convex-sync.ts'
import { defaultSettings } from '../src/main/database.ts'
import * as activity from '../convex/activity.ts'
import * as projects from '../convex/projects.ts'

test('Convex routes enforce separate read/write keys and validate before storing', async () => {
  const previousWrite = process.env.WORK_BUDDY_WRITE_KEY
  const previousRead = process.env.WORK_BUDDY_READ_KEY
  let stores = 0
  const data = syncPayload({ schemaVersion: 1, exportedAt: 1000, settings: defaultSettings, projects: [], plannedTasks: [], tasks: [], workdays: [], rests: [] }, 'test-source')
  let blob: Blob | null = null
  const ctx = {
    storage: { store: async (value: Blob) => { stores++; blob = value; return 'file-id' }, get: async () => blob, delete: async () => undefined },
    runMutation: async () => ({ sourceId: 'test-source', syncedAt: 2000 }),
    runQuery: async () => blob ? { storageId: 'file-id', syncedAt: 2000 } : null
  }
  const call = async (method: 'GET' | 'PUT', key?: string, body?: string) => {
    const route = http.lookup('/work-buddy/snapshot', method)!
    const handler = route[0] as unknown as { _handler: (ctx: unknown, request: Request) => Promise<Response> }
    return handler._handler(ctx, new Request('https://test.convex.site/work-buddy/snapshot?sourceId=test-source', { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, ...(body !== undefined ? { body } : {}) }))
  }
  try {
    delete process.env.WORK_BUDDY_WRITE_KEY
    delete process.env.WORK_BUDDY_READ_KEY
    const missing = await call('GET')
    assert.equal(missing.status, 503)
    assert.deepEqual(await missing.json(), { error: 'Configure distinct read and write keys of at least 32 characters', code: 'KEYS_NOT_CONFIGURED' })
    process.env.WORK_BUDDY_WRITE_KEY = 'w'.repeat(32)
    process.env.WORK_BUDDY_READ_KEY = 'r'.repeat(32)
    const anonymous = await call('GET')
    assert.equal(anonymous.status, 401)
    assert.deepEqual(await anonymous.json(), { error: 'Unauthorized', code: 'UNAUTHORIZED' })
    assert.equal((await call('GET', 'w'.repeat(32))).status, 401)
    // Same length and a long shared prefix still fail; the comparison is on digests, not prefixes.
    assert.equal((await call('GET', 'r'.repeat(31) + 'x')).status, 401)
    assert.equal((await call('PUT', 'r'.repeat(32), JSON.stringify(data))).status, 401)
    assert.equal(stores, 0)
    const broken = await call('PUT', 'w'.repeat(32), '{broken')
    assert.equal(broken.status, 400)
    assert.deepEqual(await broken.json(), { error: 'Invalid Work Buddy snapshot', code: 'INVALID_SNAPSHOT' })
    assert.equal(stores, 0)
    const none = await call('GET', 'r'.repeat(32))
    assert.equal(none.status, 404)
    assert.deepEqual(await none.json(), { error: 'No upload for this source yet', code: 'NOT_FOUND' })
    assert.equal((await call('PUT', 'w'.repeat(32), JSON.stringify(data))).status, 200)
    assert.equal(stores, 1)
    const response = await call('GET', 'r'.repeat(32))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    const result = await response.json()
    assert.equal(result.syncedAt, 2000)
    assert.equal(result.data.sourceId, 'test-source')
  } finally {
    if (previousWrite === undefined) delete process.env.WORK_BUDDY_WRITE_KEY
    else process.env.WORK_BUDDY_WRITE_KEY = previousWrite
    if (previousRead === undefined) delete process.env.WORK_BUDDY_READ_KEY
    else process.env.WORK_BUDDY_READ_KEY = previousRead
  }
})

test('project catalog allows limited label access to browser write key while activity still requires read key',async()=>{
 const oldW=process.env.WORK_BUDDY_WRITE_KEY,oldR=process.env.WORK_BUDDY_READ_KEY
 process.env.WORK_BUDDY_WRITE_KEY='w'.repeat(32);process.env.WORK_BUDDY_READ_KEY='r'.repeat(32)
 let mutation:unknown
 const ctx={runQuery:async()=>({workProjects:[],browserProjects:[],links:[]}),runMutation:async(_:unknown,args:unknown)=>{mutation=args;return {conflict:false}}}
 const call=async(path:string,method:'GET'|'PUT',key:string,body?:unknown)=>{const handler=http.lookup(path,method)![0] as unknown as {_handler:(ctx:unknown,request:Request)=>Promise<Response>};return handler._handler(ctx,new Request('https://test.convex.site'+path+'?deviceId=pc&day=2026-10-22',{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}))}
 try{
 assert.equal((await call('/work-buddy/projects','GET','w'.repeat(32))).status,200)
 assert.equal((await call('/work-buddy/activity','GET','w'.repeat(32))).status,401)
 assert.equal((await call('/work-buddy/projects','PUT','r'.repeat(32),{})).status,401)
 assert.equal((await call('/work-buddy/projects','PUT','w'.repeat(32),{deviceId:'pc',sourceId:'browser',kind:'browser',capturedAt:Date.now(),projects:[{id:'folder',name:'Client',archived:false,secret:'must be stripped'}]})).status,200)
 assert.equal(JSON.stringify(mutation).includes('secret'),false)
 const invalidLink=await call('/work-buddy/project-link','PUT','w'.repeat(32),{deviceId:'pc',browserSourceId:'browser',browserProjectId:'folder',projectId:null,expectedRevision:-1})
 assert.equal(invalidLink.status,400)
 assert.deepEqual(await invalidLink.json(),{error:'Project changed. Refresh projects and try again.',code:'INVALID_LINK'})
 }finally{if(oldW===undefined)delete process.env.WORK_BUDDY_WRITE_KEY;else process.env.WORK_BUDDY_WRITE_KEY=oldW;if(oldR===undefined)delete process.env.WORK_BUDDY_READ_KEY;else process.env.WORK_BUDDY_READ_KEY=oldR}
})

type Row = Record<string, unknown> & { _table: string; _id: string }
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
const handlerOf = (fn: unknown): Handler['_handler'] => (fn as Handler)._handler

/**
 * A tiny in-memory stand-in for Convex's database and file storage so the real
 * mutations and queries run end to end against the HTTP routes.
 */
function fakeConvex() {
  const rows: Row[] = []
  const files = new Map<string, Blob>()
  let next = 0
  const query = (table: string) => ({
    withIndex: (_name: string, build: (q: unknown) => unknown) => {
      const filters: Array<(row: Row) => boolean> = []
      const q = {
        eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return q },
        lt: (field: string, value: unknown) => { filters.push((row) => (row[field] as number | string) < (value as number | string)); return q }
      }
      build(q)
      const matches = () => rows.filter((row) => row._table === table && filters.every((f) => f(row)))
      return {
        unique: async () => { const found = matches(); if (found.length > 1) throw new Error('not unique'); return found[0] ?? null },
        take: async (n: number) => matches().slice(0, n),
        collect: async () => matches()
      }
    }
  })
  const db = {
    query,
    insert: async (table: string, doc: Record<string, unknown>) => { const _id = `row-${next++}`; rows.push({ ...doc, _table: table, _id }); return _id },
    patch: async (_id: string, patch: Record<string, unknown>) => { Object.assign(rows.find((row) => row._id === _id)!, patch) },
    replace: async (_id: string, doc: Record<string, unknown>) => { const i = rows.findIndex((row) => row._id === _id); rows[i] = { ...doc, _table: rows[i]._table, _id } },
    delete: async (_id: string) => { rows.splice(rows.findIndex((row) => row._id === _id), 1) }
  }
  const storage = {
    store: async (blob: Blob) => { const id = `file-${next++}`; files.set(id, blob); return id },
    get: async (id: string) => files.get(id) ?? null,
    delete: async (id: string) => { files.delete(id) }
  }
  const inner = { db, storage, scheduler: { runAfter: async () => undefined } }
  const functions: Record<string, unknown> = {
    'activity:publish': activity.publish, 'activity:day': activity.day,
    'projects:publish': projects.publish, 'projects:registry': projects.registry, 'projects:link': projects.link
  }
  const run = async (ref: unknown, args: unknown) => {
    const name = (ref as Record<symbol, unknown>)[Symbol.for('functionName')] as string
    const fn = functions[name]
    if (!fn) throw new Error(`No fake for ${name}`)
    return handlerOf(fn)(inner, args)
  }
  return { ctx: { storage, runMutation: run, runQuery: run }, rows, files }
}

function withKeys(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const oldW = process.env.WORK_BUDDY_WRITE_KEY, oldR = process.env.WORK_BUDDY_READ_KEY
    process.env.WORK_BUDDY_WRITE_KEY = 'w'.repeat(32)
    process.env.WORK_BUDDY_READ_KEY = 'r'.repeat(32)
    try { await fn() } finally {
      if (oldW === undefined) delete process.env.WORK_BUDDY_WRITE_KEY; else process.env.WORK_BUDDY_WRITE_KEY = oldW
      if (oldR === undefined) delete process.env.WORK_BUDDY_READ_KEY; else process.env.WORK_BUDDY_READ_KEY = oldR
    }
  }
}

const route = (ctx: unknown) => async (path: string, method: 'GET' | 'PUT', key: string, body?: string, contentType: string | null = 'application/json') => {
  const handler = http.lookup(path.split('?')[0], method)![0] as unknown as { _handler: (ctx: unknown, request: Request) => Promise<Response> }
  const headers: Record<string, string> = { Authorization: 'Bearer ' + key }
  if (contentType) headers['Content-Type'] = contentType
  return handler._handler(ctx, new Request('https://test.convex.site' + path, { method, headers, ...(body !== undefined ? { body } : {}) }))
}
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10)
const WRITE = 'w'.repeat(32), READ = 'r'.repeat(32)

test('activity upload round trip validates, stores, reports stale uploads and serves the day back', withKeys(async () => {
  const fake = fakeConvex()
  const call = route(fake.ctx)
  const now = Date.now()
  const day = utcDay(now)
  const envelope = {
    schemaVersion: 1, sourceId: 'pc-source', deviceId: 'pc', day, kind: 'desktop', capturedAt: now, retentionDays: 30,
    tzOffsetMinutes: 120, timezone: 'Europe/Bratislava',
    records: [{ id: 'r1', sourceId: 'pc-source', deviceId: 'pc', kind: 'desktop', state: 'active', start: now - 3600000, end: now - 1800000, app: 'code.exe', title: 'http.ts' }]
  }

  const wrongType = await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify(envelope), 'text/plain')
  assert.equal(wrongType.status, 415)
  assert.deepEqual(await wrongType.json(), { error: 'Expected application/json', code: 'UNSUPPORTED_MEDIA_TYPE' })

  const huge = await call('/work-buddy/activity', 'PUT', WRITE, '{"pad":"' + 'x'.repeat(5 * 1024 * 1024) + '"}')
  assert.equal(huge.status, 413)
  assert.deepEqual(await huge.json(), { error: 'Activity day exceeds 5 MB', code: 'PAYLOAD_TOO_LARGE' })

  const malformed = await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify({ ...envelope, tzOffsetMinutes: 900 }))
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: 'Invalid activity day', code: 'INVALID_ACTIVITY_DAY', detail: 'Invalid activity envelope' })

  const future = await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify({ ...envelope, day: utcDay(now + 3 * 86400000), records: [] }))
  assert.equal(future.status, 400)
  assert.deepEqual(await future.json(), { error: 'Invalid activity day', code: 'INVALID_ACTIVITY_DAY', detail: 'Activity day is in the future' })
  // Tomorrow in UTC is still a legitimate local day.
  assert.equal((await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify({ ...envelope, day: utcDay(now + 86400000), records: [] }))).status, 200)

  const old = await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify({ ...envelope, day: '2020-01-01', records: [] }))
  assert.equal(old.status, 400)
  assert.deepEqual(await old.json(), { error: 'Activity is outside retention', code: 'OUTSIDE_RETENTION' })
  assert.equal(fake.files.size, 1)

  const accepted = await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify(envelope))
  assert.equal(accepted.status, 200)
  const receipt = await accepted.json()
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.sourceId, 'pc-source')
  assert.equal(receipt.day, day)
  assert.equal(typeof receipt.syncedAt, 'number')
  assert.equal(fake.files.size, 2)

  const stale = await call('/work-buddy/activity', 'PUT', WRITE, JSON.stringify({ ...envelope, capturedAt: now - 60000, records: [] }))
  assert.equal(stale.status, 200)
  assert.deepEqual(await stale.json(), { sourceId: 'pc-source', day, syncedAt: receipt.syncedAt, accepted: false, reason: 'stale' })
  assert.equal(fake.files.size, 2, 'the stale blob is discarded')

  assert.equal((await call(`/work-buddy/activity?deviceId=pc&day=${day}`, 'GET', WRITE)).status, 401)
  const badDay = await call('/work-buddy/activity?deviceId=pc&day=2026-02-30', 'GET', READ)
  assert.equal(badDay.status, 400)
  assert.deepEqual(await badDay.json(), { error: 'A valid deviceId and day are required', code: 'INVALID_DEVICE' })
  const fetched = await call(`/work-buddy/activity?deviceId=pc&day=${day}`, 'GET', READ)
  assert.equal(fetched.status, 200)
  const body = await fetched.json()
  assert.equal(body.sources.length, 1)
  assert.equal(body.sources[0].syncedAt, receipt.syncedAt)
  assert.equal(body.sources[0].data.records.length, 1, 'the stale empty upload did not replace the stored day')
  assert.equal(body.sources[0].data.tzOffsetMinutes, 120)
  assert.equal(body.sources[0].data.timezone, 'Europe/Bratislava')
  assert.equal(typeof body.fetchedAt, 'number')
}))

test('project catalog and link routes report stale catalogs and vanished projects as conflicts', withKeys(async () => {
  const fake = fakeConvex()
  const call = route(fake.ctx)
  const now = Date.now()
  const catalog = (kind: string, sourceId: string, capturedAt: number, projects: unknown[]) =>
    call('/work-buddy/projects', 'PUT', WRITE, JSON.stringify({ deviceId: 'pc', sourceId, kind, capturedAt, projects }))

  const wrongType = await call('/work-buddy/projects', 'PUT', WRITE, '{}', null)
  assert.equal(wrongType.status, 415)
  assert.deepEqual(await wrongType.json(), { error: 'Expected application/json', code: 'UNSUPPORTED_MEDIA_TYPE' })
  const tooBig = await call('/work-buddy/projects', 'PUT', WRITE, '{"pad":"' + 'é'.repeat(1000001) + '"}')
  assert.equal(tooBig.status, 413, 'size is measured in bytes, not characters')
  assert.deepEqual(await tooBig.json(), { error: 'Catalog too large', code: 'PAYLOAD_TOO_LARGE' })
  const invalid = await call('/work-buddy/projects', 'PUT', WRITE, JSON.stringify({ deviceId: 'pc', sourceId: 'browser', kind: 'browser', capturedAt: now, projects: [{ id: 'a', name: '   ', archived: false }] }))
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { error: 'Invalid project catalog', code: 'INVALID_CATALOG' })

  const link = (browserProjectId: string, projectId: string | null, expectedRevision: number) =>
    call('/work-buddy/project-link', 'PUT', WRITE, JSON.stringify({ deviceId: 'pc', browserSourceId: 'browser', browserProjectId, projectId, expectedRevision }))

  // Nothing published yet: the mutation throws because the browser project is unknown.
  const vanished = await link('folder', null, 0)
  assert.equal(vanished.status, 409)
  assert.deepEqual(await vanished.json(), { error: 'Project changed. Refresh projects and try again.', code: 'LINK_CONFLICT' })

  assert.deepEqual(await (await catalog('browser', 'browser', now, [{ id: 'folder', name: 'Client', archived: false }])).json(), { ok: true, accepted: true })
  assert.deepEqual(await (await catalog('desktop', 'pc-source', now, [{ id: 'p1', name: 'Work', archived: false }, { id: 'p2', name: 'Old', archived: true }])).json(), { ok: true, accepted: true })
  const stale = await catalog('browser', 'browser', now - 1000, [])
  assert.equal(stale.status, 200)
  assert.deepEqual(await stale.json(), { ok: true, accepted: false, reason: 'stale' })

  const badDevice = await call('/work-buddy/projects?deviceId=bad%20id', 'GET', WRITE)
  assert.equal(badDevice.status, 400)
  assert.deepEqual(await badDevice.json(), { error: 'Invalid device', code: 'INVALID_DEVICE' })
  const registry = await (await call('/work-buddy/projects?deviceId=pc', 'GET', WRITE)).json()
  assert.equal(registry.browserProjects.length, 1, 'the stale empty catalog was ignored')
  assert.equal(registry.workProjects.length, 2)

  const archived = await link('folder', 'p2', 0)
  assert.equal(archived.status, 409)
  assert.equal((await archived.json()).code, 'LINK_CONFLICT')

  const linked = await link('folder', 'p1', 0)
  assert.equal(linked.status, 200)
  assert.deepEqual(await linked.json(), { conflict: false, accepted: true })

  const outdated = await link('folder', null, 0)
  assert.equal(outdated.status, 409)
  assert.deepEqual(await outdated.json(), { conflict: true, error: 'Project changed. Refresh projects and try again.', code: 'LINK_CONFLICT' })
  assert.equal((await link('folder', null, 1)).status, 200)

  // Unexpected mutation failures are not disguised as client errors.
  const failing = route({ ...fake.ctx, runMutation: async () => { throw new Error('database unavailable') } })
  await assert.rejects(failing('/work-buddy/project-link', 'PUT', WRITE, JSON.stringify({ deviceId: 'pc', browserSourceId: 'browser', browserProjectId: 'folder', projectId: null, expectedRevision: 2 })), /database unavailable/)
  await assert.rejects(failing('/work-buddy/projects', 'PUT', WRITE, JSON.stringify({ deviceId: 'pc', sourceId: 'browser', kind: 'browser', capturedAt: now, projects: [] })), /database unavailable/)
}))
