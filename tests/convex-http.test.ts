import assert from 'node:assert/strict'
import test from 'node:test'
import http from '../convex/http.ts'
import { syncPayload } from '../src/main/convex-sync.ts'
import { defaultSettings } from '../src/main/database.ts'

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
    assert.equal((await call('GET')).status, 503)
    process.env.WORK_BUDDY_WRITE_KEY = 'w'.repeat(32)
    process.env.WORK_BUDDY_READ_KEY = 'r'.repeat(32)
    assert.equal((await call('GET')).status, 401)
    assert.equal((await call('GET', 'w'.repeat(32))).status, 401)
    assert.equal((await call('PUT', 'r'.repeat(32), JSON.stringify(data))).status, 401)
    assert.equal(stores, 0)
    assert.equal((await call('PUT', 'w'.repeat(32), '{broken')).status, 400)
    assert.equal(stores, 0)
    assert.equal((await call('GET', 'r'.repeat(32))).status, 404)
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
