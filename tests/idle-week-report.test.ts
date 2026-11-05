import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import { localDateKey } from '../src/shared/local-date.ts'

function at(day: number, hours: number, minutes = 0): number {
  return new Date(2026, 7, day, hours, minutes, 0, 0).getTime()
}

function atTime<T>(timestamp: number, run: () => T): T {
  const original = Date.now
  Date.now = () => timestamp
  try {
    return run()
  } finally {
    Date.now = original
  }
}

test('discarding an idle stretch splits the running interval and keeps the task running', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    atTime(at(24, 9, 0), () => db.startWorkday())
    atTime(at(24, 9, 0), () => db.startTask({ mode: 'parallel', notes: 'Deep work' }))
    const snapshot = atTime(at(24, 11, 0), () => db.resolveIdle({ startedAt: at(24, 10, 0), endedAt: at(24, 10, 30) }, 'discard'))
    const task = snapshot.tasks[0]
    assert.equal(task.status, 'running')
    assert.deepEqual(task.intervals.map((interval) => [interval.startedAt, interval.endedAt]), [[at(24, 9, 0), at(24, 10, 0)], [at(24, 10, 30), null]])
    assert.equal(snapshot.rests.length, 0)
  } finally {
    db.close()
  }
})

test('turning an idle stretch into a break records a finished micro-break and trims every overlapping task', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    atTime(at(24, 9, 0), () => db.startWorkday())
    atTime(at(24, 9, 0), () => db.startTask({ mode: 'parallel', notes: 'A' }))
    atTime(at(24, 9, 30), () => db.startTask({ mode: 'parallel', notes: 'B' }))
    atTime(at(24, 10, 5), () => db.pauseTask(db.getSnapshot().tasks.find((task) => task.notes === 'B')!.id))
    const snapshot = atTime(at(24, 10, 40), () => db.resolveIdle({ startedAt: at(24, 10, 0), endedAt: at(24, 10, 20) }, 'break'))
    const a = snapshot.tasks.find((task) => task.notes === 'A')!
    const b = snapshot.tasks.find((task) => task.notes === 'B')!
    assert.deepEqual(a.intervals.map((interval) => [interval.startedAt, interval.endedAt]), [[at(24, 9, 0), at(24, 10, 0)], [at(24, 10, 20), null]])
    // B ended inside the idle stretch, so it is cut at the start of the stretch and not resumed.
    assert.deepEqual(b.intervals.map((interval) => [interval.startedAt, interval.endedAt]), [[at(24, 9, 30), at(24, 10, 0)]])
    assert.equal(b.status, 'paused')
    const rest = snapshot.rests.find((item) => item.type === 'break')!
    assert.equal(rest.status, 'completed')
    assert.equal(rest.plannedMinutes, 20)
    assert.deepEqual(rest.intervals.map((interval) => [interval.startedAt, interval.endedAt]), [[at(24, 10, 0), at(24, 10, 20)]])
  } finally {
    db.close()
  }
})

test('rejects idle periods that are too short, too old or malformed', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    atTime(at(24, 9, 0), () => db.startTask({ mode: 'parallel' }))
    assert.throws(() => atTime(at(24, 12, 0), () => db.resolveIdle({ startedAt: at(24, 10, 0), endedAt: at(24, 10, 0, ) + 30_000 }, 'discard')), /too short/)
    assert.throws(() => atTime(at(27, 12, 0), () => db.resolveIdle({ startedAt: at(24, 10, 0), endedAt: at(24, 11, 0) }, 'discard')), /too old/)
    assert.throws(() => atTime(at(24, 12, 0), () => db.resolveIdle({ startedAt: Number.NaN, endedAt: at(24, 11, 0) }, 'discard')), /Invalid idle period/)
  } finally {
    db.close()
  }
})

test('instant tasks take the default project while explicit choices win', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    const firm = db.createProject({ name: 'Firm', color: '#b8e986' }).projects.find((project) => project.name === 'Firm')!
    const other = db.createProject({ name: 'Other', color: '#7bdff2' }).projects.find((project) => project.name === 'Other')!
    db.updateSettings({ ...db.getSettings(), defaultProjectId: firm.id })
    assert.equal(db.getSettings().defaultProjectId, firm.id)
    const instant = atTime(at(24, 9, 0), () => db.startTask({ mode: 'parallel' })).tasks[0]
    assert.equal(instant.projectId, firm.id)
    const explicit = atTime(at(24, 9, 1), () => db.startTask({ mode: 'parallel', projectId: other.id, notes: 'Explicit' })).tasks.find((task) => task.notes === 'Explicit')!
    assert.equal(explicit.projectId, other.id)
    const none = atTime(at(24, 9, 2), () => db.startTask({ mode: 'parallel', projectId: null, notes: 'None' })).tasks.find((task) => task.notes === 'None')!
    assert.equal(none.projectId, null)
    // An archived default project no longer applies.
    db.updateProject({ id: firm.id, name: 'Firm', color: '#b8e986', archived: true })
    const afterArchive = atTime(at(24, 9, 3), () => db.startTask({ mode: 'parallel', notes: 'Later' })).tasks.find((task) => task.notes === 'Later')!
    assert.equal(afterArchive.projectId, null)
  } finally {
    db.close()
  }
})

test('the weekly report sums coverage per day and per project and compares with the week before', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    const alpha = db.createProject({ name: 'Alpha', color: '#b8e986' }).projects.find((project) => project.name === 'Alpha')!
    // 2026-08-24 is a Monday; the week before gets two hours on its Wednesday.
    atTime(at(19, 9, 0), () => db.startTask({ mode: 'parallel', projectId: alpha.id }))
    atTime(at(19, 11, 0), () => db.stopAllTasks())
    atTime(at(24, 9, 0), () => db.startTask({ mode: 'parallel', projectId: alpha.id, notes: 'One' }))
    atTime(at(24, 9, 30), () => db.startTask({ mode: 'parallel', projectId: null, notes: 'Two' }))
    atTime(at(24, 10, 0), () => db.stopAllTasks())
    atTime(at(25, 14, 0), () => db.startTask({ mode: 'parallel', projectId: alpha.id, notes: 'Three' }))
    atTime(at(25, 15, 30), () => db.stopAllTasks())
    const report = atTime(at(26, 12, 0), () => db.getWeekReport(localDateKey(at(24, 12))))
    assert.equal(report.weekStart, localDateKey(at(24, 12)))
    assert.equal(report.days.length, 7)
    // Parallel tasks overlap for half an hour on Monday: coverage is one hour, not ninety minutes.
    assert.equal(report.days[0].workedMs, 60 * 60_000)
    assert.equal(report.days[1].workedMs, 90 * 60_000)
    assert.equal(report.totalMs, 150 * 60_000)
    assert.equal(report.previousTotalMs, 120 * 60_000)
    assert.deepEqual(report.projects.map((entry) => [entry.projectId, entry.ms]), [[alpha.id, 150 * 60_000], [null, 30 * 60_000]])
    assert.throws(() => db.getWeekReport('not-a-date'), /Invalid history date/)
  } finally {
    db.close()
  }
})
