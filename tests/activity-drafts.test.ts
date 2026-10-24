import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import { ActivityStore } from '../src/main/activity-store.ts'
import { ActivityService } from '../src/main/activity.ts'
import { acceptActivityDrafts } from '../src/main/activity-import.ts'
import {
  activitySuggestions,
  draftFromSuggestions,
  splitActivityDraft,
  mergeActivityDrafts,
  trimActivityDraft,
  subtractActivityRanges,
  validateActivityDrafts
} from '../src/shared/activity-drafts.ts'
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

test('suggestions subtract manual timers and breaks and never include idle time', () => {
  const s = snapshot()
  s.tasks = [
    {
      id: 'task',
      title: '',
      projectId: null,
      notes: 'Existing',
      tags: [],
      status: 'stopped',
      createdAt: base,
      updatedAt: base,
      intervals: [{ id: 'i', taskId: 'task', startedAt: base + 2 * minute, endedAt: base + 4 * minute }]
    }
  ]
  s.rests = [
    {
      id: 'rest',
      type: 'break',
      status: 'completed',
      plannedMinutes: 1,
      createdAt: base + 6 * minute,
      endedAt: base + 7 * minute,
      intervals: [{ id: 'r', restId: 'rest', startedAt: base + 6 * minute, endedAt: base + 7 * minute }]
    }
  ]
  const result = activitySuggestions(data([row('active', 0, 10), row('idle', 10, 15, { state: 'idle' })]), s, 0)
  const ranges = result.flatMap((r) => r.intervals)
  assert.deepEqual(ranges, [
    { start: base, end: base + 2 * minute },
    { start: base + 4 * minute, end: base + 6 * minute },
    { start: base + 7 * minute, end: base + 10 * minute }
  ])
  assert.equal(
    ranges.reduce((sum, r) => sum + r.end - r.start, 0),
    7 * minute
  )
})
test('matching uses explicit corrections, then specific browser rules, then unique project names', () => {
  const s = snapshot()
  s.projects = [
    { id: 'p1', name: 'Client', color: '#ffffff', archived: false, createdAt: base },
    { id: 'p2', name: 'Other', color: '#000000', archived: false, createdAt: base }
  ]
  const d = data([
    row('browser:day', 0, 10, {
      kind: 'browser',
      app: 'chrome.exe',
      domain: 'docs.test',
      browserProjectId: 'folder',
      projectName: 'Client'
    })
  ])
  assert.equal(activitySuggestions(d, s)[0].match, 'name')
  d.rules = [
    { kind: 'domain', pattern: 'docs.test', projectId: 'p2' },
    { kind: 'browserProject', pattern: 'folder', projectId: 'p1' }
  ]
  assert.equal(activitySuggestions(d, s)[0].projectId, 'p1')
  d.assignments = [{ recordId: 'browser:day', projectId: 'p2', excluded: false, note: '' }]
  assert.equal(activitySuggestions(d, s)[0].projectId, 'p2')
  assert.equal(activitySuggestions(d, s)[0].match, 'correction')
  d.records.push(row('second-browser',10,15,{kind:'browser',app:'chrome.exe',domain:'other.test',projectName:'Other'}))
  assert.equal(activitySuggestions(d,s)[0].match,'name','Mixed matching evidence must not invent a remembered rule')
})
test('a growing observation keeps its suggestion identity without expanding reviewed ranges', () => {
  const first = activitySuggestions(data([row('a', 0, 10)]), snapshot())[0]
  const later = activitySuggestions(data([row('a', 0, 12)]), snapshot())[0]
  assert.equal(first.id, later.id)
  const draft = { ...draftFromSuggestions([first]), notes: 'Reviewed' }
  validateActivityDrafts(day, [draft], [later], [])
  assert.equal(draft.intervals.at(-1)!.end, base + 10 * minute)
})
test('splitting, trimming and merging preserve gaps and exact observed duration', () => {
  const suggestions = activitySuggestions(data([row('a', 0, 5), row('b', 5.5, 10)]), snapshot(), 0)
  const original = { ...draftFromSuggestions(suggestions), notes: 'Observed work' }
  const parts = splitActivityDraft(original, base + 6 * minute)
  const merged = mergeActivityDrafts(parts)
  assert.deepEqual(merged.intervals, original.intervals)
  assert.equal(
    merged.intervals.reduce((sum, r) => sum + r.end - r.start, 0),
    9.5 * minute
  )
  assert.equal(
    trimActivityDraft(original, base + minute, base + 9 * minute).intervals.reduce(
      (sum, r) => sum + r.end - r.start,
      0
    ),
    7.5 * minute
  )
  assert.throws(() => trimActivityDraft(original, base - minute, base + 9 * minute))
  assert.throws(() => splitActivityDraft(original, base))
})
test('draft validation rejects fabricated gap time, overlapping entries and stale suggestions', () => {
  const s = snapshot(),
    suggestions = activitySuggestions(data([row('a', 0, 5), row('b', 6, 10)]), s, 0)
  const draft = { ...draftFromSuggestions(suggestions), notes: 'Work' }
  assert.throws(() =>
    validateActivityDrafts(
      day,
      [{ ...draft, intervals: [{ start: base, end: base + 10 * minute }] }],
      suggestions,
      s.projects
    )
  )
  assert.throws(() => validateActivityDrafts(day, [draft, draft], suggestions, s.projects))
  assert.throws(() => validateActivityDrafts(day, [draft], [], s.projects))
  assert.deepEqual(
    subtractActivityRanges(
      [{ start: 0, end: 100 }],
      [
        { start: 20, end: 30 },
        { start: 25, end: 50 }
      ]
    ),
    [
      { start: 0, end: 20 },
      { start: 50, end: 100 }
    ]
  )
})
test('accepted split drafts become visible stopped tasks and replay cannot duplicate them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'work-buddy-reviewed-')),
    store = new ActivityStore(join(directory, 'activity.sqlite'), 'pc'),
    db = new WorkBuddyDatabase(':memory:')
  const activity = new ActivityService(store, { encrypt: (v) => v, decrypt: (v) => v }, () => 0, fetch, {
    start() {},
    stop() {}
  })
  try {
    store.put(day, row('a', 0, 10))
    store.saveRecap(day, { summary: 'Old recap', generatedAt: Date.now(), through: base + 10 * minute, evidence: [] })
    const suggestions = activitySuggestions(activity.day(day), db.getDaySnapshot(day))
    const draft = { ...draftFromSuggestions(suggestions), notes: 'Recovered coding' }
    const drafts = splitActivityDraft(draft, base + 5 * minute)
    const result = acceptActivityDrafts(activity, db, { day, drafts })
    assert.equal(result.created, 2)
    assert.equal(activity.day(day).recap, undefined)
    const tasks = db.getDaySnapshot(day).tasks
    assert.equal(tasks.length, 2)
    assert.ok(tasks.every((t) => t.status === 'stopped'))
    assert.equal(
      tasks.flatMap((t) => t.intervals).reduce((sum, r) => sum + r.endedAt! - r.startedAt, 0),
      10 * minute
    )
    assert.equal(activitySuggestions(activity.day(day), db.getDaySnapshot(day)).length, 0)
    const replay = acceptActivityDrafts(activity, db, { day, drafts })
    assert.equal(replay.created, 0)
    assert.deepEqual(replay.taskIds, result.taskIds)
  } finally {
    activity.stop()
    store.close()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
test('a stale batch rolls back all new tasks when a later entry overlaps tracked work', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    db.recordActivityTasks(day, [
      {
        key: hash('existing'),
        notes: 'Existing',
        projectId: null,
        intervals: [{ start: base + 5 * minute, end: base + 10 * minute }]
      }
    ])
    assert.throws(() =>
      db.recordActivityTasks(day, [
        {
          key: hash('safe'),
          notes: 'Safe first',
          projectId: null,
          intervals: [{ start: base, end: base + 2 * minute }]
        },
        {
          key: hash('overlap'),
          notes: 'Conflicting second',
          projectId: null,
          intervals: [{ start: base + 6 * minute, end: base + 8 * minute }]
        }
      ])
    )
    assert.equal(db.getDaySnapshot(day).tasks.length, 1)
    assert.equal(db.hasActivityImport(hash('safe')), false)
  } finally {
    db.close()
  }
})
test('recording historical work preserves a currently running task and workday', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    const before = db.startTask({ notes: 'Live work', mode: 'parallel' }),
      live = before.tasks.find((t) => t.status === 'running')!
    db.recordActivityTasks(day, [
      {
        key: hash('historic'),
        notes: 'Recovered yesterday',
        projectId: null,
        intervals: [{ start: base, end: base + 5 * minute }]
      }
    ])
    const after = db.getSnapshot(),
      task = after.tasks.find((t) => t.id === live.id)!
    assert.equal(task.status, 'running')
    assert.equal(task.intervals.at(-1)!.endedAt, null)
    assert.equal(after.workday?.id, before.workday?.id)
    assert.equal(db.getDaySnapshot(day).tasks.length, 1)
  } finally {
    db.close()
  }
})
test('replaying a recorded range is idempotent only while its notes and project are unchanged', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    const entry = { key: hash('same'), notes: 'Reviewed work', projectId: null, intervals: [{ start: base, end: base + 5 * minute }] }
    const first = db.recordActivityTasks(day, [entry])
    const replay = db.recordActivityTasks(day, [{ ...entry, notes: '  Reviewed work ' }])
    assert.equal(replay.created, 0)
    assert.deepEqual(replay.taskIds, first.taskIds)
    assert.throws(() => db.recordActivityTasks(day, [{ ...entry, notes: 'Different notes' }]), /already recorded as a task/)
    const project = db.createProject({ name: 'Client', color: '#123456' }).projects[0]
    assert.throws(() => db.recordActivityTasks(day, [{ ...entry, projectId: project.id }]), /already recorded as a task/)
    assert.equal(db.getDaySnapshot(day).tasks.length, 1)
  } finally {
    db.close()
  }
})
