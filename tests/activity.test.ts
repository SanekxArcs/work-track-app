import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityStore } from '../src/main/activity-store.ts'
import { ActivityService } from '../src/main/activity.ts'
import {
  activityReport,
  validateActivityEnvelope,
  splitActivityRecord,
  type ActivityRecord
} from '../src/shared/activity.ts'
import { correctedActivity, activityReview } from '../src/shared/activity-review.ts'
import { localDateKey } from '../src/shared/local-date.ts'
import { WorkBuddyDatabase } from '../src/main/database.ts'

const base = Date.now() - 3600000
const row = (id: string, start: number, end: number, extra: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id,
  sourceId: 'source',
  deviceId: 'pc',
  kind: 'desktop',
  state: 'active',
  app: 'Code.exe',
  title: '',
  start: base + start,
  end: base + end,
  ...extra
})
test('browser enrichment never doubles desktop time; background browser does not override another app or idle', () => {
  const report = activityReport(
    [
      row('code', 0, 10000),
      row('chrome', 10000, 20000, { app: 'chrome.exe' }),
      row('idle', 20000, 30000, { state: 'idle', app: '' }),
      row('tab', 0, 30000, { kind: 'browser', app: 'chrome.exe', domain: 'docs.test' })
    ],
    [
      { start: base + 5000, end: base + 15000 },
      { start: base + 10000, end: base + 18000 }
    ]
  )
  assert.equal(report.activeMs, 20000)
  assert.equal(report.browserMs, 10000)
  assert.equal(report.idleMs, 10000)
  assert.equal(report.manualMs, 13000)
  assert.equal(report.untrackedMs, 7000)
  assert.deepEqual(
    report.segments.map((s) => s.record.id),
    ['code', 'tab', 'idle']
  )
  assert.deepEqual(report.segments[1].evidenceIds, ['tab', 'chrome'])
})
test('browser-only evidence works with no desktop collector, overlapping tabs count once', () => {
  const report = activityReport([row('a', 0, 10000, { kind: 'browser' }), row('b', 5000, 15000, { kind: 'browser' })])
  assert.equal(report.activeMs, 15000)
  assert.equal(report.browserMs, 15000)
})
test('activity validation strips unknown data and URL credentials/query/hash, rejects duplicate IDs and invalid dates', () => {
  const data = {
    schemaVersion: 1,
    sourceId: 'source',
    deviceId: 'pc',
    kind: 'browser',
    day: localDateKey(base),
    capturedAt: Date.now(),
    retentionDays: 30,
    records: [
      {
        ...row('a', 0, 2000, { kind: 'browser', url: 'https://user:pass@example.com/path?token=secret#x' }),
        secret: 'never'
      }
    ],
    key: 'never'
  }
  const clean = validateActivityEnvelope(data)
  assert.equal(clean.records[0].url, 'https://example.com/path')
  assert.ok(!JSON.stringify(clean).includes('never'))
  assert.ok(!JSON.stringify(clean).includes('secret'))
  assert.throws(() => validateActivityEnvelope({ ...data, records: [data.records[0], data.records[0]] }))
  assert.throws(() => validateActivityEnvelope({ ...data, day: '2026-02-30' }))
  assert.throws(() => validateActivityEnvelope({ ...data, records: [{ ...data.records[0], deviceId: 'different' }] }))
})
test('native records split across local midnight without losing duration', () => {
  const start = new Date(2026, 9, 20, 23, 59, 58).getTime()
  const parts = splitActivityRecord({ ...row('a', 0, 4000), start, end: start + 4000 })
  assert.deepEqual(
    parts.map((p) => [p.day, p.record.end - p.record.start]),
    [
      ['2026-10-20', 2000],
      ['2026-10-21', 2000]
    ]
  )
})
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'work-buddy-activity-test-'))
  const store = new ActivityStore(join(directory, 'activity.sqlite'), 'pc')
  let idle = 0,
    fail = false,
    resolveRequest: (() => void) | undefined
  const uploads: unknown[] = []
  let responder: ((env: { sourceId: string; day: string }) => Response) | undefined
  const request: typeof fetch = async (_url, options) => {
    if (fail) throw new Error('offline')
    if (resolveRequest)
      await new Promise<void>((resolve) => {
        resolveRequest = resolve
      })
    const env = JSON.parse(options!.body as string)
    uploads.push(env)
    if (responder) return responder(env)
    return new Response(JSON.stringify({ sourceId: env.sourceId, day: env.day, syncedAt: Date.now(), accepted: true }))
  }
  const service = new ActivityService(
    store,
    { encrypt: (v) => 'encrypted:' + v, decrypt: (v) => v.slice(10) },
    () => idle,
    request,
    { start() {}, stop() {} }
  )
  service.start()
  service.configure({ ...store.config(), enabled: true, captureTitles: true })
  return {
    store,
    service,
    uploads,
    setIdle: (value: number) => {
      idle = value
    },
    setFail: (value: boolean) => {
      fail = value
    },
    setResponder: (value: typeof responder) => {
      responder = value
    },
    cleanup: () => {
      service.stop()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
test('capture checkpoints are durable, closes foreground interval correctly, and leaves sleep/restart gaps', () => {
  const h = harness(),
    at = Date.now() - 100000
  try {
    h.service.observe({ app: 'Code.exe', title: 'Project', at }, at)
    h.service.observe({ app: 'Code.exe', title: 'Project', at: at + 2000 }, at + 2000)
    h.service.observe({ app: 'chrome.exe', title: 'Docs', at: at + 4000 }, at + 4000)
    let rows = h.store.local(localDateKey(at))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].end - rows[0].start, 4000)
    assert.equal(rows[0].app, 'Code.exe')
    h.service.observe({ app: 'chrome.exe', title: 'Docs', at: at + 6000 }, at + 6000)
    h.service.observe({ app: 'Code.exe', title: 'After sleep', at: at + 90000 }, at + 90000)
    rows = h.store.local(localDateKey(at))
    assert.equal(activityReport(rows).activeMs, 6000)
    h.service.system('suspend')
    h.service.observe({ app: 'Code.exe', title: '', at: at + 92000 }, at + 92000)
    assert.equal(activityReport(h.store.local(localDateKey(at))).activeMs, 6000)
    h.service.system('resume')
    h.service.observe({ app: 'Code.exe', title: '', at: at + 94000 }, at + 94000)
    assert.equal(activityReport(h.store.local(localDateKey(at))).activeMs, 6000)
  } finally {
    h.cleanup()
  }
})
test('privacy exclusions stop capture and titles remain opt-in; pause cannot fabricate elapsed time', () => {
  const h = harness(),
    at = Date.now() - 100000
  try {
    h.service.configure({
      ...h.store.config(),
      captureTitles: false,
      excludedApps: ['secret.exe'],
      excludedTitlePatterns: ['private']
    })
    for (const [offset, app, title] of [
      [0, 'Code.exe', 'Public'],
      [2000, 'Code.exe', 'Public'],
      [4000, 'secret.exe', 'Sensitive'],
      [6000, 'Code.exe', 'Private'],
      [8000, 'Code.exe', 'Public'],
      [10000, 'Code.exe', 'Public']
    ] as const)
      h.service.observe({ app, title, at: at + offset }, at + offset)
    const rows = h.store.local(localDateKey(at))
    assert.equal(activityReport(rows).activeMs, 4000)
    assert.ok(rows.every((r) => r.title === ''))
    h.service.configure({ ...h.store.config(), enabled: false })
    h.service.observe({ app: 'Code.exe', title: '', at: at + 12000 }, at + 12000)
    assert.equal(activityReport(h.store.local(localDateKey(at))).activeMs, 4000)
  } finally {
    h.cleanup()
  }
})
test('offline activity stays queued; successful retries and deletion replace the same day without duplication', async () => {
  const h = harness(),
    at = Date.now() - 100000,
    day = localDateKey(at)
  try {
    h.service.configure(
      { ...h.store.config(), cloudEnabled: true, siteUrl: 'https://test.convex.site' },
      'w'.repeat(32),
      'r'.repeat(32)
    )
    h.service.observe({ app: 'Code.exe', title: 'Project', at }, at)
    h.service.observe({ app: 'Code.exe', title: 'Project', at: at + 2000 }, at + 2000)
    h.setFail(true)
    await h.service.sync()
    assert.equal(h.store.dirty().length, 1)
    assert.equal(h.service.status().syncError, 'offline')
    h.setFail(false)
    await h.service.sync()
    assert.equal(h.store.dirty().length, 0)
    assert.equal(h.uploads.length, 1)
    h.service.deleteDay(day)
    await h.service.sync()
    assert.equal(h.uploads.length, 2)
    assert.equal((h.uploads[1] as { records: unknown[] }).records.length, 0)
  } finally {
    h.cleanup()
  }
})
test('dirty revisions preserve newer observations while an upload is in flight', () => {
  const h = harness(),
    day = localDateKey(Date.now())
  try {
    h.store.mark(day)
    const revision = h.store.dirty()[0].revision
    h.store.mark(day)
    h.store.ack(day, revision)
    assert.equal(h.store.dirty().length, 1)
  } finally {
    h.cleanup()
  }
})
test('project rules and explicit exclusions affect review without editing underlying records', () => {
  const records = [row('a', 0, 1000), row('b', 1000, 2000)]
  const projects = [{ id: 'p', name: 'Work Buddy' }] as Parameters<typeof correctedActivity>[3]
  const fixed = correctedActivity(
    records,
    [{ recordId: 'b', projectId: null, excluded: true, note: '' }],
    [{ kind: 'app', pattern: 'code.exe', projectId: 'p' }],
    projects
  )
  assert.equal(fixed.length, 1)
  assert.equal(fixed[0].projectName, 'Work Buddy')
  assert.equal(records[0].projectName, undefined)
})
test('manual review clips cross-midnight intervals and correction notes are available to AI', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    const day = localDateKey(base),
      snapshot = db.getDaySnapshot(day)
    const result = activityReview(
      { day, records: [row('a', 0, 1000)], assignments: [], rules: [], status: {} as never, cloudFetchedAt: null },
      snapshot,
      [{ recordId: 'a', projectId: null, excluded: false, note: 'Read docs' }],
      [],
      Date.now()
    )
    assert.equal(result.evidence[0].note, 'Read docs')
    assert.equal(result.evidence[0].ref, 'E1')
  } finally {
    db.close()
  }
})

test('activity source identity, queued observations and recaps survive reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-buddy-activity-restart-')),
    file = join(directory, 'activity.sqlite'),
    day = localDateKey(base)
  let store = new ActivityStore(file, 'pc')
  try {
    const source = store.sourceId
    store.put(day, { ...row('persist', 0, 2000), sourceId: source })
    store.saveRecap(day, { summary: 'Saved recap', generatedAt: Date.now(), through: base + 2000, evidence: [] })
    store.close()
    store = new ActivityStore(file, 'pc')
    assert.equal(store.sourceId, source)
    assert.equal(store.local(day).length, 1)
    assert.equal(store.dirty().length, 1)
    assert.equal(store.recap(day)?.summary, 'Saved recap')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('pausing preserves saved recaps, privacy changes clear them, and invalid keys do not replace credentials', () => {
  const h = harness(),
    day = localDateKey(Date.now())
  try {
    h.service.configure(
      { ...h.store.config(), cloudEnabled: true, siteUrl: 'https://test.convex.site' },
      'w'.repeat(32),
      'r'.repeat(32)
    )
    h.store.saveRecap(day, { summary: 'Daily recap', generatedAt: Date.now(), through: Date.now(), evidence: [] })
    h.service.configure({ ...h.store.config(), enabled: false })
    assert.equal(h.store.recap(day)?.summary, 'Daily recap')
    const key = h.store.get('writeKey')
    assert.throws(() => h.service.configure(h.store.config(), 'x'.repeat(32), 'short'))
    assert.equal(h.store.get('writeKey'), key)
    h.service.configure({ ...h.store.config(), excludedApps: ['private.exe'] })
    assert.equal(h.store.recap(day), undefined)
  } finally {
    h.cleanup()
  }
})

test('browser tracker colon-day IDs upload unchanged and can receive project corrections',()=>{
  const h=harness(),day=localDateKey(base),id='7e8c0022-b616-4594-ae70-23e1a47da248:'+day
  try{
    const data=validateActivityEnvelope({schemaVersion:1,sourceId:'browser',deviceId:'pc',kind:'browser',day,capturedAt:Date.now(),retentionDays:30,records:[row(id,0,2000,{sourceId:'browser',kind:'browser',app:'chrome.exe',url:'https://docs.test/'})]})
    assert.equal(data.records[0].id,id)
    h.service.assign({recordId:id,projectId:null,excluded:false,note:'Browser context'})
    assert.equal(h.service.assignments()[0].recordId,id)
    assert.throws(()=>validateActivityEnvelope({...data,sourceId:'unsafe:source'}))
  }finally{h.cleanup()}
})

const cloud = (h: ReturnType<typeof harness>) =>
  h.service.configure(
    { ...h.store.config(), cloudEnabled: true, siteUrl: 'https://test.convex.site' },
    'w'.repeat(32),
    'r'.repeat(32)
  )
test('a rejected day is skipped until it changes while other days keep uploading; envelopes carry the local time zone', async () => {
  const h = harness(),
    bad = localDateKey(base - 86400000),
    good = localDateKey(base)
  try {
    cloud(h)
    h.store.put(bad, { ...row('bad', -86400000, -86398000), sourceId: h.store.sourceId })
    h.store.put(good, { ...row('good', 0, 2000), sourceId: h.store.sourceId })
    h.setResponder((env) =>
      env.day === bad
        ? Response.json({ error: 'Invalid activity envelope', code: 'invalid_envelope' }, { status: 400 })
        : Response.json({ sourceId: env.sourceId, day: env.day, syncedAt: Date.now(), accepted: true })
    )
    await h.service.sync()
    const sent = h.uploads as Array<{ day: string; tzOffsetMinutes: number; timezone?: string }>
    assert.ok(sent.some((e) => e.day === bad) && sent.some((e) => e.day === good))
    assert.equal(sent[0].tzOffsetMinutes, new Date().getTimezoneOffset())
    assert.equal(sent[0].timezone, Intl.DateTimeFormat().resolvedOptions().timeZone)
    assert.deepEqual(h.store.dirty().map((d) => d.day), [bad])
    assert.equal(h.service.rejected()[bad], h.store.dirty()[0].revision)
    assert.match(h.service.status().syncError!, /HTTP 400: Invalid activity envelope/)
    assert.ok(h.service.status().lastSyncedAt)
    await h.service.sync()
    assert.equal(h.uploads.length, 2)
    assert.match(h.service.status().syncError!, /rejected/)
    h.store.put(bad, { ...row('bad-2', -86390000, -86388000), sourceId: h.store.sourceId })
    h.setResponder(undefined)
    await h.service.sync()
    assert.equal(h.uploads.length, 3)
    assert.equal(h.store.dirty().length, 0)
    assert.deepEqual(h.service.rejected(), {})
    assert.equal(h.service.status().syncError, null)
    h.setResponder(() => Response.json({ error: 'Pair again', code: 'unauthorized' }, { status: 401 }))
    h.store.put(good, { ...row('good-2', 3000, 4000), sourceId: h.store.sourceId })
    await h.service.sync()
    assert.equal(h.service.status().syncError, 'Activity connection key was rejected')
    assert.equal(h.store.dirty().length, 1)
    assert.deepEqual(h.service.rejected(), {})
  } finally {
    h.cleanup()
  }
})
test('a stale answer is not acknowledged and the day is retried on the next sync', async () => {
  const h = harness(),
    day = localDateKey(base)
  try {
    cloud(h)
    h.store.put(day, { ...row('a', 0, 2000), sourceId: h.store.sourceId })
    const revision = h.store.dirty().find((d) => d.day === day)!.revision
    h.setResponder((env) => Response.json({ sourceId: env.sourceId, day: env.day, syncedAt: Date.now(), accepted: false, reason: 'stale' }))
    await h.service.sync()
    assert.equal(h.store.dirty().find((d) => d.day === day)?.revision, revision)
    assert.equal(h.service.status().syncError, null)
    assert.deepEqual(h.service.rejected(), {})
    h.setResponder(undefined)
    await h.service.sync()
    assert.equal(h.store.dirty().length, 0)
    assert.equal((h.uploads as Array<{ day: string }>).filter((e) => e.day === day).length, 2)
  } finally {
    h.cleanup()
  }
})
test('non-privacy settings changes do not re-upload history; privacy and deployment changes do', async () => {
  const h = harness(),
    day = localDateKey(base)
  try {
    cloud(h)
    h.store.put(day, { ...row('a', 0, 2000), sourceId: h.store.sourceId })
    await h.service.sync()
    assert.equal(h.store.dirty().length, 0)
    h.service.configure({ ...h.store.config(), idleSeconds: 120 })
    h.service.configure({ ...h.store.config(), enabled: false })
    h.service.configure({ ...h.store.config(), cloudEnabled: false })
    h.service.configure({ ...h.store.config(), cloudEnabled: true })
    assert.equal(h.store.dirty().length, 0)
    h.service.configure({ ...h.store.config(), excludedApps: ['secret.exe'] })
    assert.ok(h.store.dirty().some((d) => d.day === day))
    await h.service.sync()
    assert.equal(h.store.dirty().length, 0)
    h.service.configure({ ...h.store.config(), siteUrl: 'https://other.convex.site' }, 'w'.repeat(32), 'r'.repeat(32))
    assert.ok(h.store.dirty().some((d) => d.day === day))
    h.service.deleteDay(day)
    await h.service.resync()
    assert.equal(h.store.dirty().length, 0)
    assert.equal((h.uploads.at(-1) as { day: string; records: unknown[] }).records.length, 0)
  } finally {
    h.cleanup()
  }
})
