import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import { ActivityStore } from '../src/main/activity-store.ts'
import { ActivityService } from '../src/main/activity.ts'
import { AutoTrackingService } from '../src/main/activity-auto.ts'
import {
  intersectActivityRanges,
  normalizeAutoConfig,
  reconcileAutoEntries,
  type AutoEntry
} from '../src/shared/activity-auto.ts'
import { activitySuggestions } from '../src/shared/activity-drafts.ts'
import type { ActivityDay, ActivityRecord } from '../src/shared/activity.ts'
import { localDateKey } from '../src/shared/local-date.ts'

const date = new Date()
date.setDate(date.getDate() - 1)
date.setHours(9, 0, 0, 0)
const base = date.getTime(),
  day = localDateKey(base),
  minute = 60000
const row = (id: string, start: number, end: number, extra: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id,
  sourceId: 'desktop',
  deviceId: 'pc',
  kind: 'desktop',
  state: 'active',
  start: base + start * minute,
  end: base + end * minute,
  app: 'Code.exe',
  title: '',
  ...extra
})
const data = (records: ActivityRecord[]): ActivityDay => ({
  day,
  records,
  assignments: [],
  rules: [],
  status: {} as never,
  cloudFetchedAt: null
})
const snapshot = () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    return db.getDaySnapshot(day)
  } finally {
    db.close()
  }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

test('reconcile creates, extends, drops covered periods and never recreates dismissed time', () => {
  const s = snapshot()
  let n = 0
  const id = () => `e${++n}`
  const at = (m: number) => base + m * minute
  const suggest = (records: ActivityRecord[]) => activitySuggestions(data(records), s, 0, at(60))
  const first = reconcileAutoEntries([], suggest([row('a', 0, 10)]), day, minute, at(10), id)
  assert.equal(first.length, 1)
  assert.equal(first[0].id, 'e1')
  assert.equal(first[0].status, 'open')
  assert.equal(first[0].firstSeenAt, at(10))
  const grown = reconcileAutoEntries(first, suggest([row('a', 0, 12)]), day, minute, at(12), id)
  assert.equal(grown[0].id, 'e1', 'a growing observation keeps its journal entry')
  assert.equal(grown[0].intervals[0].end, at(12))
  assert.equal(grown[0].updatedAt, at(12))
  const same = reconcileAutoEntries(grown, suggest([row('a', 0, 12)]), day, minute, at(13), id)
  assert.deepEqual(same, grown, 'unchanged evidence leaves the entry untouched')
  assert.deepEqual(reconcileAutoEntries(grown, [], day, minute, at(14), id), [], 'covered periods vanish')
  const dismissed: AutoEntry[] = [{ ...grown[0], status: 'dismissed' }]
  const kept = reconcileAutoEntries(dismissed, suggest([row('a', 0, 12)]), day, minute, at(14), id)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].status, 'dismissed')
  const continued = reconcileAutoEntries(dismissed, suggest([row('a', 0, 20)]), day, minute, at(20), id)
  assert.equal(continued.length, 2, 'activity after a dismissed period becomes a new entry')
  assert.deepEqual(continued[1].intervals, [{ start: at(12), end: at(20) }])
  const tiny = reconcileAutoEntries(dismissed, suggest([row('a', 0, 12.5)]), day, minute, at(20), id)
  assert.equal(tiny.length, 1, 'a remainder below the minimum is ignored')
  const short = reconcileAutoEntries([], suggest([row('a', 0, 3)]), day, 5 * minute, at(5), id)
  assert.equal(short.length, 0, 'the minimum period applies to new entries')
})
test('automatic settings are validated and range intersection keeps only shared time', () => {
  assert.throws(() => normalizeAutoConfig({ enabled: true, minimumMs: 1234, intervalMinutes: 5 }))
  assert.throws(() => normalizeAutoConfig({ enabled: 'yes', minimumMs: 60000, intervalMinutes: 5 }))
  assert.deepEqual(normalizeAutoConfig({ enabled: true, minimumMs: 60000, intervalMinutes: 10, extra: 1 }), {
    enabled: true,
    minimumMs: 60000,
    intervalMinutes: 10
  })
  assert.deepEqual(
    intersectActivityRanges(
      [
        { start: 0, end: 100 },
        { start: 200, end: 300 }
      ],
      [{ start: 50, end: 250 }]
    ),
    [
      { start: 50, end: 100 },
      { start: 200, end: 250 }
    ]
  )
})
test('the service journals untracked work, yields to manual timers, records tasks and reopens deleted ones', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-buddy-auto-')),
    store = new ActivityStore(join(directory, 'activity.sqlite'), 'pc'),
    db = new WorkBuddyDatabase(':memory:')
  const activity = new ActivityService(store, { encrypt: (v) => v, decrypt: (v) => v }, () => 0, fetch, {
    start() {},
    stop() {}
  })
  let changes = 0
  const auto = new AutoTrackingService(activity, db, () => changes++, () => base + 30 * minute)
  try {
    store.put(day, row('a', 0, 10))
    store.put(day, row('b', 15, 25))
    assert.equal(auto.config().enabled, false, 'automatic tracking starts paused')
    auto.configure({ enabled: true, minimumMs: 60000, intervalMinutes: 5 })
    await auto.run([day], false)
    let state = auto.state(day)
    assert.equal(state.entries.length, 2)
    assert.equal(state.lastRunAt, base + 30 * minute)
    assert.equal(state.lastError, null)
    assert.ok(state.entries.every((e) => e.status === 'open' && e.match === 'unassigned'))
    db.recordActivityTasks(day, [
      {
        key: hash('manual'),
        notes: 'Manual timer',
        projectId: null,
        intervals: [{ start: base + 15 * minute, end: base + 25 * minute }]
      }
    ])
    await auto.run([day], false)
    state = auto.state(day)
    assert.equal(state.entries.length, 1, 'a manual entry covering the period removes its automatic entry')
    const entry = state.entries[0]
    assert.deepEqual(entry.intervals, [{ start: base, end: base + 10 * minute }])
    assert.throws(() => auto.update(day, entry.id, { project: 'missing' }))
    auto.update(day, entry.id, { notes: 'Fixed the parser' })
    const result = auto.promote(day, [entry.id])
    assert.equal(result.created, 1)
    assert.equal(changes, 1)
    state = auto.state(day)
    assert.equal(state.entries[0].status, 'promoted')
    assert.equal(state.entries[0].taskId, result.taskIds[0])
    const task = db.getDaySnapshot(day).tasks.find((t) => t.id === result.taskIds[0])
    assert.ok(task)
    assert.equal(task.status, 'stopped')
    assert.equal(task.notes, 'Fixed the parser')
    assert.equal(task.intervals.reduce((sum, i) => sum + i.endedAt! - i.startedAt, 0), 10 * minute)
    await auto.run([day], false)
    assert.deepEqual(
      auto.state(day).entries.map((e) => e.status),
      ['promoted'],
      'recorded entries are not journaled again'
    )
    assert.throws(() => auto.dismiss(day, entry.id))
    db.deleteTask(result.taskIds[0])
    await auto.run([day], false)
    state = auto.state(day)
    assert.deepEqual(state.entries.map((e) => e.status), ['open'], 'deleting the task reopens the period')
    const reopened = state.entries[0]
    assert.notEqual(reopened.id, entry.id)
    auto.dismiss(day, reopened.id)
    await auto.run([day], false)
    assert.deepEqual(auto.state(day).entries.map((e) => e.status), ['dismissed'])
    auto.restore(day, reopened.id)
    assert.deepEqual(auto.state(day).entries.map((e) => e.status), ['open'])
    const again = auto.promote(day, [reopened.id])
    assert.equal(again.created, 1)
    const second = db.getDaySnapshot(day).tasks.find((t) => t.id === again.taskIds[0])
    assert.equal(second?.notes, 'Auto · Code.exe', 'a description is derived from the observed context')
    auto.configure({ enabled: false, minimumMs: 60000, intervalMinutes: 5 })
    assert.equal(auto.state(day).entries.length, 1, 'pausing keeps the journal')
    activity.deleteDay(day)
    assert.equal(auto.state(day).entries.length, 0, 'deleting the day removes its journal')
  } finally {
    auto.stop()
    activity.stop()
    store.close()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
