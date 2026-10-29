import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityStore } from '../src/main/activity-store.ts'
import { ActivityService } from '../src/main/activity.ts'
import { WorkBuddyLocalServer } from '../src/main/local-server.ts'
import type { ActivityEnvelope, ActivityRecord } from '../src/shared/activity.ts'
import { localDateKey } from '../src/shared/local-date.ts'

const base = Date.now() - 3600000,
  day = localDateKey(base)
const record = (id: string, start: number, end: number, extra: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id,
  sourceId: 'browser',
  deviceId: 'pc',
  kind: 'browser',
  state: 'active',
  app: 'chrome.exe',
  title: 'Docs',
  url: 'https://docs.test/page?token=secret',
  domain: 'docs.test',
  start: base + start,
  end: base + end,
  ...extra
})
const envelope = (records: ActivityRecord[], extra: Partial<ActivityEnvelope> = {}): ActivityEnvelope => ({
  schemaVersion: 1,
  sourceId: 'browser',
  deviceId: 'pc',
  day,
  kind: 'browser',
  capturedAt: Date.now(),
  retentionDays: 30,
  records,
  ...extra
})
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'work-buddy-local-delivery-'))
  const store = new ActivityStore(join(directory, 'activity.sqlite'), 'pc')
  const calls: string[] = []
  const request: typeof fetch = async (url, options) => {
    calls.push(`${options?.method ?? 'GET'} ${url}`)
    const env = options?.body ? JSON.parse(options.body as string) : {}
    return new Response(
      JSON.stringify(
        options?.method === 'PUT'
          ? { sourceId: env.sourceId, day: env.day, syncedAt: Date.now(), accepted: true }
          : { sources: [] }
      )
    )
  }
  const service = new ActivityService(
    store,
    { encrypt: (v) => `encrypted:${v}`, decrypt: (v) => v.slice(10) },
    () => 0,
    request,
    { start() {}, stop() {} }
  )
  service.start()
  return {
    store,
    service,
    calls,
    cleanup: () => {
      service.stop()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
test('locally delivered browser activity is validated, cached per source and read back without the cloud', () => {
  const h = harness()
  try {
    const receipt = h.service.deliver(envelope([record('visit:1', 0, 60000)]))
    assert.equal(receipt.day, day)
    assert.equal(receipt.records, 1)
    const data = h.service.day(day)
    assert.equal(data.records.length, 1)
    assert.equal(data.records[0].url, 'https://docs.test/page', 'query strings are stripped like cloud reads')
    assert.equal(data.localReceivedAt, receipt.receivedAt)
    assert.equal(data.cloudFetchedAt, null)
    h.store.saveRecap(day, { summary: 'Recap', generatedAt: Date.now(), through: base, evidence: [] })
    h.service.deliver(envelope([record('visit:1', 0, 60000), record('visit:2', 60000, 120000)]))
    assert.equal(h.service.day(day).records.length, 2)
    assert.ok(h.store.recap(day), 'adding records keeps the saved recap')
    h.service.deliver(envelope([record('visit:2', 60000, 120000)]))
    assert.equal(h.service.day(day).records.length, 1)
    assert.equal(h.store.recap(day), undefined, 'removed evidence invalidates the recap')
    assert.throws(() => h.service.deliver(envelope([], { deviceId: 'other' })), /Paired PC ID differs/)
    assert.throws(() => h.service.deliver(envelope([], { kind: 'desktop' })))
    assert.throws(() => h.service.deliver(envelope([], { sourceId: h.store.sourceId })))
    assert.throws(() => h.service.deliver({ ...envelope([]), schemaVersion: 2 }))
    assert.deepEqual(h.service.pairing(), { deviceId: 'pc', sourceId: h.store.sourceId })
  } finally {
    h.cleanup()
  }
})
test('without cloud reads a refresh never downloads and backups wait for the configured cadence', async () => {
  const h = harness()
  try {
    h.service.configure(
      { ...h.store.config(), enabled: true, cloudEnabled: true, siteUrl: 'https://test.convex.site' },
      'w'.repeat(32),
      'r'.repeat(32)
    )
    assert.equal(h.store.config().cloudReads, false)
    assert.equal(h.store.config().uploadMinutes, 60)
    h.service.deliver(envelope([record('visit:1', 0, 60000)]))
    const before = h.calls.length
    const data = await h.service.refresh(day)
    assert.equal(h.calls.length, before, 'refresh stays local')
    assert.equal(data.records.length, 1)
    h.service.observe({ app: 'Code.exe', title: '', at: base }, base)
    h.service.observe({ app: 'Code.exe', title: '', at: base + 2000 }, base + 2000)
    await h.service.sync()
    assert.ok(h.calls.some((c) => c.startsWith('PUT https://test.convex.site/work-buddy/activity')))
    assert.ok(!h.calls.some((c) => c.includes('GET https://test.convex.site/work-buddy/activity')))
    h.service.configure({ ...h.store.config(), cloudReads: true })
    await h.service.refresh(day)
    assert.ok(h.calls.some((c) => c.includes('GET https://test.convex.site/work-buddy/activity')))
    assert.throws(() => h.service.configure({ ...h.store.config(), uploadMinutes: 7 as never }))
  } finally {
    h.cleanup()
  }
})
test('the loopback bridge accepts keyed activity posts and reports pairing identity', async () => {
  const h = harness()
  const server = new WorkBuddyLocalServer(
    'k'.repeat(43),
    () => null,
    () => {},
    { pairing: () => h.service.pairing(), deliver: (raw) => h.service.deliver(raw) },
    0
  )
  try {
    await server.start()
    const url = `http://127.0.0.1:${server.address()}`
    const headers = { 'Content-Type': 'application/json', 'X-Work-Buddy-Key': 'k'.repeat(43), Origin: 'chrome-extension://abc' }
    const pair = await fetch(`${url}/activity/pair`, { headers })
    assert.equal(pair.status, 200)
    assert.equal(((await pair.json()) as { deviceId: string }).deviceId, 'pc')
    const denied = await fetch(`${url}/activity`, { method: 'POST', headers: { ...headers, 'X-Work-Buddy-Key': 'wrong' }, body: '{}' })
    assert.equal(denied.status, 401)
    const page = await fetch(`${url}/activity`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: '{}' })
    assert.equal(page.status, 403)
    const ok = await fetch(`${url}/activity`, { method: 'POST', headers, body: JSON.stringify(envelope([record('visit:1', 0, 60000)])) })
    assert.equal(ok.status, 200)
    assert.equal(((await ok.json()) as { records: number }).records, 1)
    assert.equal(h.service.day(day).records.length, 1)
    const mismatch = await fetch(`${url}/activity`, { method: 'POST', headers, body: JSON.stringify(envelope([], { deviceId: 'other' })) })
    assert.equal(mismatch.status, 409)
  } finally {
    await server.stop()
    h.cleanup()
  }
})
