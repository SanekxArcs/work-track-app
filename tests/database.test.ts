import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import { scheduledWorkdayEndAt } from '../src/shared/workday.ts'

function at(day: number, hours: number, minutes = 0): number {
  return new Date(2026, 7, day, hours, minutes, 0, 0).getTime()
}

async function withDatabase(run: (database: WorkBuddyDatabase) => void | Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  try {
    await run(database)
  } finally {
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function atTime<T>(timestamp: number, run: () => T | Promise<T>): Promise<T> {
  const original = Date.now
  Date.now = () => timestamp
  try {
    return await run()
  } finally {
    Date.now = original
  }
}

test('migrates an existing planned-task table before creating its completion index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-legacy-test-'))
  const path = join(directory, 'work-buddy.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`CREATE TABLE planned_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    project_id TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`)
  legacy.close()
  try {
    const database = new WorkBuddyDatabase(path)
    assert.equal(database.getSnapshot().plannedTasks.length, 0)
    database.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('daily coverage and history split an interval that crosses midnight', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    database.updateSettings({ ...settings, workday: { ...settings.workday, startTime: '22:00', endTime: '06:00' } })
    await atTime(at(26, 23, 50), () => database.startTask({ mode: 'parallel', notes: 'Late task' }))
    await atTime(at(27, 0, 10), () => database.pauseAllTasks())

    await atTime(at(27, 0, 10), () => {
      assert.equal(database.getWorkedCoverageToday(), 10 * 60_000)
      const current = database.getSnapshot()
      assert.equal(current.tasks.length, 1)
      const history = database.getHistory(14)
      assert.equal(history.find((day) => day.date === '2026-08-26')?.workedMs, 10 * 60_000)
      assert.equal(history.find((day) => day.date === '2026-08-27')?.workedMs, 10 * 60_000)
    })
  })
})

test('a finished workday does not leak yesterday’s stopped task into a new Focus day', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))
    await atTime(at(26, 11), () => database.endWorkday())

    await atTime(at(27, 9), () => {
      const snapshot = database.getSnapshot()
      assert.equal(snapshot.workday, null)
      assert.equal(snapshot.tasks.length, 0)
    })
  })
})

test('uses one timestamp while creating a Focus snapshot at midnight', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 16), () => database.startTask({ mode: 'parallel', notes: 'Near midnight' }))
    const original = Date.now
    let calls = 0
    Date.now = () => calls++ === 0 ? at(26, 23, 59) : at(27, 0)
    try {
      const snapshot = database.getSnapshot()
      assert.equal(snapshot.now, at(26, 23, 59))
      assert.equal(snapshot.workday?.startedAt, at(26, 16))
      assert.equal(snapshot.tasks.length, 1)
    } finally {
      Date.now = original
    }
  })
})

test('starts a break with one timestamp even when the clock crosses midnight', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 23), () => database.startTask({ mode: 'parallel', notes: 'Late work' }))
    const original = Date.now
    let calls = 0
    Date.now = () => calls++ === 0 ? at(26, 23, 59) : at(27, 0)
    try {
      database.startRest('break')
      Date.now = () => at(26, 23, 59)
      const rest = database.exportBackup().rests[0]
      assert.equal(rest?.createdAt, at(26, 23, 59))
      assert.equal(rest?.intervals[0]?.startedAt, at(26, 23, 59))
    } finally {
      Date.now = original
    }
  })
})

test('ending a day during an open break does not add the break to overtime', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.startTask({ mode: 'parallel', notes: 'Morning work' }))
    await atTime(at(26, 16), () => database.startRest('break'))
    await atTime(at(26, 19), () => database.endWorkday())

    assert.equal(database.getOvertimeOverview().balanceMs, 0)
  })
})

test('starting work on the next calendar day closes a stale normal workday at midnight', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 16), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))
    await atTime(at(27, 9), () => database.startTask({ mode: 'parallel', notes: 'Today' }))

    const snapshot = await atTime(at(27, 9), () => database.getSnapshot())
    const backup = await atTime(at(26, 11), () => database.exportBackup())
    assert.equal(snapshot.workday?.startedAt, at(27, 9))
    assert.equal(backup.workdays.find((day) => day.startedAt === at(26, 16))?.endedAt, at(27, 0))
  })
})

test('opening Focus on a new day closes a stale normal workday before rendering tasks', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 16), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))

    const snapshot = await atTime(at(27, 9), () => database.getSnapshot())
    const backup = database.exportBackup()
    assert.equal(snapshot.workday, null)
    assert.equal(snapshot.tasks.length, 0)
    assert.equal(backup.workdays.find((day) => day.startedAt === at(26, 16))?.endedAt, at(27, 0))
  })
})

test('exporting a backup closes a stale workday before it can be synced', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 16), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))

    const backup = await atTime(at(27, 9), () => database.exportBackup())
    assert.equal(backup.workdays[0].endedAt, at(27, 0))
    assert.equal(backup.tasks[0].status, 'stopped')
    assert.equal(backup.tasks[0].intervals[0].endedAt, at(27, 0))
  })
})

test('opening history directly never counts a stale timer into the next day', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 16), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))

    const history = await atTime(at(27, 9), () => database.getHistory(14))
    assert.equal(history.find((day) => day.date === '2026-08-27')?.workedMs, 0)
    assert.equal(database.exportBackup().workdays[0].endedAt, at(27, 0))
  })
})

test('rejects an edited interval that would end in the future', async () => {
  await withDatabase(async (database) => {
    const snapshot = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Later' }))
    const taskId = snapshot.tasks[0].id
    await atTime(at(26, 12), () => database.pauseTask(taskId))
    await atTime(at(26, 10), () => assert.throws(() => database.updateTask({ id: taskId, startedAt: at(26, 11), endedAt: at(26, 12) }), /future/i))

    assert.equal(await atTime(at(26, 10), () => database.getWorkedCoverageToday()), 0)
  })
})

test('pausing an old timer closes it at midnight instead of counting the night', async () => {
  await withDatabase(async (database) => {
    const initial = await atTime(at(26, 16), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))
    await atTime(at(27, 9), () => database.pauseTask(initial.tasks[0].id))

    const task = database.exportBackup().tasks.find((item) => item.id === initial.tasks[0].id)
    assert.equal(task?.intervals[0].endedAt, at(27, 0))
    assert.equal(await atTime(at(27, 9), () => database.getWorkedCoverageToday()), 0)
  })
})

test('does not let a delayed end-day command close a newer workday', async () => {
  await withDatabase(async (database) => {
    const first = await atTime(at(26, 10), () => database.startWorkday())
    const firstId = first.workday?.id
    assert.ok(firstId)
    await atTime(at(26, 16), () => database.endWorkday())
    const next = await atTime(at(27, 9), () => database.startWorkday())

    await atTime(at(27, 10), () => assert.throws(() => database.endWorkday(firstId), /no longer active/i))
    assert.equal((await atTime(at(27, 10), () => database.getSnapshot())).workday?.id, next.workday?.id)
  })
})

test('lets an open workday start be corrected independently of tasks', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 10), () => database.startWorkday())
    const updated = await atTime(at(26, 10), () => database.updateWorkdayStart(at(26, 8, 10)))

    assert.equal(updated.workday?.startedAt, at(26, 8, 10))
    assert.equal(scheduledWorkdayEndAt(updated.settings, updated.workday, updated.rests, at(26, 10)), at(26, 17, 10))
  })
})

test('keeps breaks from before midnight in an overnight workday snapshot', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    database.updateSettings({
      ...settings,
      workday: { ...settings.workday, startTime: '22:00', endTime: '06:00' },
      lunch: { ...settings.lunch, durationMinutes: 20 }
    })
    await atTime(at(26, 23), () => database.startTask({ mode: 'parallel', notes: 'Night shift' }))
    const duringLunch = await atTime(at(26, 23, 30), () => database.startRest('lunch'))
    const lunchId = duringLunch.rests[0].id
    await atTime(at(27, 0), () => database.completeRest(lunchId))

    const snapshot = await atTime(at(27, 0, 10), () => database.getSnapshot())
    assert.equal(snapshot.rests.length, 1)
    assert.equal(snapshot.rests[0].type, 'lunch')
    assert.equal(scheduledWorkdayEndAt(snapshot.settings, snapshot.workday, snapshot.rests, at(27, 0, 10)), at(27, 7, 10))
  })
})

test('keeps an explicit task interval edit within that interval', async () => {
  await withDatabase(async (database) => {
    const first = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Recurring task' }))
    const id = first.tasks[0].id
    await atTime(at(26, 11), () => database.pauseTask(id))
    await atTime(at(27, 10), () => database.resumeTask(id, 'parallel'))
    const second = await atTime(at(27, 11), () => database.pauseTask(id))
    const secondIntervalId = second.tasks[0].intervals.find((interval) => interval.startedAt === at(27, 10))?.id
    assert.ok(secondIntervalId)

    await atTime(at(27, 11), () => database.updateTask({ id, intervalId: secondIntervalId, startedAt: at(27, 9), endedAt: at(27, 11) }))
    const intervals = database.exportBackup().tasks.find((task) => task.id === id)?.intervals ?? []
    assert.equal(intervals.find((interval) => interval.startedAt === at(26, 10))?.endedAt, at(26, 11))
    assert.equal(intervals.find((interval) => interval.id === secondIntervalId)?.startedAt, at(27, 9))
  })
})

test('rejects merging a different active workday from a backup', async () => {
  await withDatabase(async (database) => {
    const backup = database.exportBackup()
    backup.workdays.push({ id: 'remote-open-day', startedAt: at(26, 9), endedAt: null })
    await atTime(at(26, 10), () => database.startWorkday())

    assert.throws(() => database.importBackup(backup, 'merge'), /active workday/i)
  })
})

test('merging an older backup keeps local task edits and adds only missing intervals', async () => {
  await withDatabase(async (database) => {
    const started = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Original note' }))
    const taskId = started.tasks[0].id
    await atTime(at(26, 11), () => database.pauseTask(taskId))
    const backup = await atTime(at(26, 12), () => database.exportBackup())
    backup.tasks[0].notes = 'Older backup note'
    backup.tasks[0].intervals.push({ id: 'backup-only-interval', taskId, startedAt: at(26, 11), endedAt: at(26, 12) })

    await atTime(at(26, 12), () => database.updateTask({ id: taskId, notes: 'Current local note' }))
    await atTime(at(26, 12), () => database.importBackup(backup, 'merge'))
    const restored = database.exportBackup().tasks.find((task) => task.id === taskId)

    assert.equal(restored?.notes, 'Current local note')
    assert.equal(restored?.intervals.length, 2)
    assert.ok(restored?.intervals.some((interval) => interval.id === 'backup-only-interval'))
  })
})

test('records a workday span in every calendar day it crosses', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    database.updateSettings({ ...settings, workday: { ...settings.workday, startTime: '22:00', endTime: '06:00' } })
    await atTime(at(26, 23), () => database.startWorkday())
    await atTime(at(27, 1), () => database.endWorkday())

    const history = await atTime(at(27, 1), () => database.getHistory(14))
    const secondDay = history.find((day) => day.date === '2026-08-27')
    assert.equal(secondDay?.startedAt, at(27, 0))
    assert.equal(secondDay?.endedAt, at(27, 1))
  })
})

test('rejects an invalid backup before it can be imported into SQLite', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Safe task' }))
    await atTime(at(26, 11), () => database.endWorkday())
    const backup = database.exportBackup()
    backup.tasks[0].status = 'invalid' as 'stopped'

    assert.throws(() => database.parseBackup(JSON.stringify(backup)), /invalid tasks/i)
    assert.throws(() => database.importBackup(backup, 'replace'), /invalid tasks/i)
    assert.equal(database.exportBackup().tasks.length, 1)
  })
})

test('rejects an incompatible backup at the import boundary', async () => {
  await withDatabase(async (database) => {
    const backup = database.exportBackup()
    const incompatible = { ...backup, schemaVersion: 2 } as unknown as typeof backup

    assert.throws(() => database.importBackup(incompatible, 'replace'), /compatible/i)
  })
})

test('rejects a backup with an impossible active timer state', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Safe task' }))
    const backup = await atTime(at(26, 10), () => database.exportBackup())
    backup.tasks[0].status = 'paused'

    assert.throws(() => database.parseBackup(JSON.stringify(backup)), /inconsistent task timer/i)
    assert.equal((await atTime(at(26, 10), () => database.exportBackup())).tasks[0].status, 'running')
  })
})

test('normalizes malformed persisted settings instead of breaking timer logic', async () => {
  await withDatabase(async (database) => {
    const malformed = database.exportBackup()
    malformed.settings = {
      ...malformed.settings,
      workday: { ...malformed.settings.workday, startTime: 'not-a-time' },
      breaks: { ...malformed.settings.breaks, everyMinutes: -4 },
      googleCalendar: { clientId: 'obsolete-client-id' }
    } as typeof malformed.settings
    database.importBackup(malformed, 'replace')

    const settings = database.getSettings()
    assert.equal(settings.workday.startTime, '09:00')
    assert.equal(settings.breaks.everyMinutes, 55)
    assert.equal('googleCalendar' in settings, false)
  })
})

test('folds long calendar lines without splitting UTF-8 characters', async () => {
  await withDatabase(async (database) => {
    const notes = 'Робота над дуже довгим описом для календаря, який має лишатися валідним після експорту. '.repeat(3)
    await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes }))
    await atTime(at(26, 11), () => database.endWorkday())
    const calendar = database.createDayCalendarIcs('2026-08-26')

    assert.ok(calendar.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75))
    assert.match(calendar, /\r\n /)
  })
})

test('does not allow ambiguous duplicate project names', async () => {
  await withDatabase(async (database) => {
    database.createProject({ name: 'Cupio', color: '#ffffff' })
    assert.throws(() => database.createProject({ name: ' cupio ', color: '#000000' }), /already exists/i)
  })
})

test('merging a Day task keeps the source task history outside the selected date', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    database.updateSettings({ ...settings, workday: { ...settings.workday, startTime: '22:00', endTime: '06:00' } })

    const source = await atTime(at(26, 23, 30), () => database.startTask({ mode: 'parallel', notes: 'Before midnight' }))
    const sourceId = source.tasks[0].id
    await atTime(at(27, 0, 30), () => database.pauseTask(sourceId))
    await atTime(at(27, 0, 30), () => database.endWorkday())

    const target = await atTime(at(27, 0, 40), () => database.startTask({ mode: 'parallel', notes: 'After midnight' }))
    const targetId = target.tasks.find((task) => task.id !== sourceId)?.id
    assert.ok(targetId)
    await atTime(at(27, 1), () => database.endWorkday())

    await atTime(at(27, 1), () => database.mergeTasks({ date: '2026-08-27', targetId, sourceIds: [sourceId] }))
    const backup = database.exportBackup()
    const sourceIntervals = backup.tasks.find((task) => task.id === sourceId)?.intervals ?? []
    const targetIntervals = backup.tasks.find((task) => task.id === targetId)?.intervals ?? []

    assert.deepEqual(sourceIntervals.map((interval) => [interval.startedAt, interval.endedAt]), [[at(26, 23, 30), at(27, 0)]])
    assert.ok(targetIntervals.some((interval) => interval.startedAt === at(27, 0) && interval.endedAt === at(27, 0, 30)))
    assert.ok(targetIntervals.some((interval) => interval.startedAt === at(27, 0, 40) && interval.endedAt === at(27, 1)))
  })
})

test('does not merge parallel task intervals into a double-counted task', async () => {
  await withDatabase(async (database) => {
    const source = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel' }))
    const sourceId = source.tasks[0].id
    const target = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel' }))
    const targetId = target.tasks.find((task) => task.id !== sourceId)?.id
    assert.ok(targetId)
    await atTime(at(26, 11), () => database.endWorkday())

    await atTime(at(26, 11), () => assert.throws(
      () => database.mergeTasks({ date: '2026-08-26', targetId, sourceIds: [sourceId] }),
      /overlapping time/i
    ))
    assert.equal(database.exportBackup().tasks.length, 2)
  })
})

test('does not merge a task that has no time on the selected Day', async () => {
  await withDatabase(async (database) => {
    const first = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel' }))
    const firstId = first.tasks[0].id
    await atTime(at(26, 11), () => database.endWorkday())
    const second = await atTime(at(27, 10), () => database.startTask({ mode: 'parallel' }))
    const secondId = second.tasks.find((task) => task.id !== firstId)?.id
    assert.ok(secondId)
    await atTime(at(27, 11), () => database.endWorkday())

    await atTime(at(27, 11), () => assert.throws(
      () => database.mergeTasks({ date: '2026-08-27', targetId: secondId, sourceIds: [firstId] }),
      /selected day/i
    ))
    assert.equal(database.exportBackup().tasks.length, 2)
  })
})

test('rejects task interval edits that would double-count the same task', async () => {
  await withDatabase(async (database) => {
    const first = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel' }))
    const taskId = first.tasks[0].id
    await atTime(at(26, 11), () => database.pauseTask(taskId))
    await atTime(at(26, 12), () => database.resumeTask(taskId, 'parallel'))
    const second = await atTime(at(26, 13), () => database.pauseTask(taskId))
    const secondIntervalId = second.tasks[0].intervals.find((interval) => interval.startedAt === at(26, 12))?.id
    assert.ok(secondIntervalId)

    await atTime(at(26, 13), () => assert.throws(
      () => database.updateTask({ id: taskId, intervalId: secondIntervalId, startedAt: at(26, 10, 30), endedAt: at(26, 13) }),
      /cannot overlap/i
    ))
  })
})

test('rejects an imported backup with overlapping intervals for one task', async () => {
  await withDatabase(async (database) => {
    const initial = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel' }))
    const taskId = initial.tasks[0].id
    await atTime(at(26, 11), () => database.pauseTask(taskId))
    await atTime(at(26, 12), () => database.resumeTask(taskId, 'parallel'))
    await atTime(at(26, 13), () => database.pauseTask(taskId))
    const backup = database.exportBackup()
    backup.tasks[0].intervals[1].startedAt = at(26, 10, 30)

    assert.throws(() => database.parseBackup(JSON.stringify(backup)), /invalid tasks/i)
  })
})

test('completes an attached planned task, hides it, and clears the link when deleted', async () => {
  await withDatabase(async (database) => {
    const planned = await atTime(at(26, 9), () => database.createPlannedTask({ title: 'Prepare release notes' }))
    const plannedId = planned.plannedTasks[0]?.id
    assert.ok(plannedId)

    const started = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', plannedTaskId: plannedId }))
    assert.equal(started.plannedTasks.length, 0)
    assert.equal(started.tasks[0]?.plannedTaskId, plannedId)
    assert.equal(database.exportBackup().plannedTasks[0]?.completedAt, at(26, 10))

    const detached = await atTime(at(26, 10), () => database.deletePlannedTask(plannedId))
    assert.equal(detached.tasks[0]?.plannedTaskId, null)
  })
})

test('stores an optional daily reminder time for a planned task', async () => {
  await withDatabase(async (database) => {
    const created = await atTime(at(26, 9), () => database.createPlannedTask({ title: 'Call the dentist', reminderTime: '14:05' }))
    const task = created.plannedTasks[0]
    assert.equal(task?.reminderTime, '14:05')

    const updated = await database.updatePlannedTask({ id: task!.id, title: task!.title, reminderTime: null })
    assert.equal(updated.plannedTasks[0]?.reminderTime, null)
    assert.throws(() => database.createPlannedTask({ title: 'Invalid alarm', reminderTime: '25:00' }), /HH:MM/)
  })
})

test('completes a planned task when it is attached while editing a paused task', async () => {
  await withDatabase(async (database) => {
    const planned = await atTime(at(26, 9), () => database.createPlannedTask({ title: 'Check invoice' }))
    const plannedId = planned.plannedTasks[0]?.id
    assert.ok(plannedId)
    const started = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel' }))
    const taskId = started.tasks[0]?.id
    assert.ok(taskId)
    await atTime(at(26, 11), () => database.pauseTask(taskId))

    const updated = await atTime(at(26, 12), () => database.updateTask({ id: taskId, plannedTaskId: plannedId }))
    assert.equal(updated.plannedTasks.length, 0)
    assert.equal(updated.tasks[0]?.plannedTaskId, plannedId)
    assert.equal(database.exportBackup().plannedTasks[0]?.completedAt, at(26, 12))
  })
})

test('imports an older backup that has no planned-task completion field', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.createPlannedTask({ title: 'Legacy item' }))
    const backup = database.exportBackup()
    delete backup.plannedTasks[0]?.completedAt

    assert.doesNotThrow(() => database.parseBackup(JSON.stringify(backup)))
  })
})

test('restoring an active break keeps the tasks that should resume afterwards', async () => {
  await withDatabase(async (database) => {
    const initial = await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Resume after break' }))
    const taskId = initial.tasks[0].id
    const resting = await atTime(at(26, 11), () => database.startRest('break'))
    const restId = resting.rests[0].id
    const backup = await atTime(at(26, 11), () => database.exportBackup())

    assert.deepEqual(backup.rests[0].resumeTaskIds, [taskId])
    await atTime(at(26, 11), () => database.importBackup(backup, 'replace'))
    const completed = await atTime(at(26, 12), () => database.completeRest(restId))

    assert.equal(completed.tasks.find((task) => task.id === taskId)?.status, 'running')
    assert.throws(() => database.parseBackup(JSON.stringify({
      ...backup,
      rests: [{ ...backup.rests[0], resumeTaskIds: ['unknown-task'] }]
    })), /invalid rest sessions/i)
  })
})

test('backdating a break also removes the overlapping auto-paused task time', async () => {
  await withDatabase(async (database) => {
    const initial = await atTime(at(26, 14), () => database.startTask({ mode: 'parallel', notes: 'Before lunch' }))
    const taskId = initial.tasks[0].id
    const lunch = await atTime(at(26, 14, 15), () => database.startRest('lunch'))
    const lunchId = lunch.rests[0].id
    await atTime(at(26, 15, 15), () => database.completeRest(lunchId))
    await atTime(at(26, 16), () => database.endWorkday())

    await atTime(at(26, 16), () => database.updateRestStart(lunchId, at(26, 14)))
    const restored = database.exportBackup()
    const task = restored.tasks.find((item) => item.id === taskId)
    const rest = restored.rests.find((item) => item.id === lunchId)

    assert.equal(task?.intervals[0].endedAt, at(26, 14))
    assert.equal(rest?.intervals[0].startedAt, at(26, 14))
  })
})

test('continuing a day reopens it without counting the gap as work', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Morning' }))
    await atTime(at(26, 11), () => database.endWorkday())

    const resumed = await atTime(at(26, 12), () => database.resumeWorkday())
    assert.equal(resumed.workday?.endedAt, null)
    assert.equal(resumed.workday?.startedAt, at(26, 9))
    assert.equal(resumed.tasks.length, 1)
    assert.equal(resumed.tasks[0].status, 'paused')
    assert.equal(await atTime(at(26, 13), () => database.getWorkedCoverageToday()), 2 * 60 * 60 * 1000)
  })
})

test('a finished workday from a previous day cannot be continued', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))
    await atTime(at(26, 11), () => database.endWorkday())
    await atTime(at(27, 9), () => assert.throws(() => database.resumeWorkday()))
  })
})

test('project stats count overlapping tasks once and support statuses', async () => {
  await withDatabase(async (database) => {
    const created = await atTime(at(26, 8), () => database.createProject({ name: 'Alpha', color: '#b8e986', statusId: 'status-active' }))
    const project = created.projects[0]
    assert.equal(project.statusId, 'status-active')
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', projectId: project.id, notes: 'One' }))
    await atTime(at(26, 9, 30), () => database.startTask({ mode: 'parallel', projectId: project.id, notes: 'Two' }))
    await atTime(at(26, 10), () => database.endWorkday())

    const [stats] = await atTime(at(26, 12), () => database.getProjectStats())
    assert.equal(stats.totalMs, 60 * 60 * 1000)
    assert.equal(stats.todayMs, 60 * 60 * 1000)
    assert.equal(stats.taskCount, 2)

    const updated = await atTime(at(26, 12), () => database.updateProject({ id: project.id, name: 'Alpha', color: '#b8e986', archived: true }))
    assert.equal(updated.projects[0].archived, true)
    assert.equal(updated.projects[0].statusId, 'status-active')
    const cleared = await atTime(at(26, 12), () => database.updateProject({ id: project.id, name: 'Alpha', color: '#b8e986', statusId: null }))
    assert.equal(cleared.projects[0].statusId, null)
  })
})

test('projects support priority order, budget, deadline, merge and delete', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.createProject({ name: 'A', color: '#b8e986', deadline: '2026-09-01', budgetHours: 2.5 }))
    await atTime(at(26, 8), () => database.createProject({ name: 'B', color: '#7bdff2' }))
    let snapshot = await atTime(at(26, 8), () => database.createProject({ name: 'C', color: '#f7a072' }))
    assert.deepEqual(snapshot.projects.map((project) => project.name), ['A', 'B', 'C'])
    assert.equal(snapshot.projects[0].deadline, '2026-09-01')
    assert.equal(snapshot.projects[0].budgetHours, 2.5)

    const [a, b, c] = snapshot.projects
    snapshot = database.reorderProjects([c.id, a.id, b.id])
    assert.deepEqual(snapshot.projects.map((project) => project.name), ['C', 'A', 'B'])
    assert.throws(() => database.updateProject({ id: a.id, name: 'A', color: a.color, deadline: 'tomorrow' }))
    snapshot = database.updateProject({ id: a.id, name: 'A', color: a.color, deadline: null, budgetHours: null })
    assert.equal(snapshot.projects.find((project) => project.id === a.id)?.budgetHours, null)

    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', projectId: a.id, notes: 'Work' }))
    assert.equal(database.getProjectTasks(a.id).length, 1)
    snapshot = database.mergeProjects(a.id, b.id)
    assert.equal(snapshot.projects.some((project) => project.id === a.id), false)
    assert.equal(database.getProjectTasks(b.id).length, 1)
    snapshot = database.deleteProject(b.id)
    assert.equal(database.getProjectTasks(b.id).length, 0)
  })
})

test('exports a calendar file for a range of days', async () => {
  await withDatabase(async (database) => {
    await atTime(at(24, 9), () => database.startTask({ mode: 'parallel', notes: 'Day one' }))
    await atTime(at(24, 10), () => database.endWorkday())
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Day three' }))
    await atTime(at(26, 10), () => database.endWorkday())
    const ics = await atTime(at(27, 9), () => database.createCalendarIcs('2026-08-24', '2026-08-26'))
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2)
    await atTime(at(27, 9), () => assert.throws(() => database.createCalendarIcs('2026-08-26', '2026-08-24')))
    await atTime(at(27, 9), () => assert.throws(() => database.createCalendarIcs('2026-08-25', '2026-08-25')))
  })
})

test('projects can carry a type and clear it again', async () => {
  await withDatabase(async (database) => {
    const created = database.createProject({ name: 'Typed', color: '#b8e986', typeId: 'type-x' })
    const project = created.projects[0]
    assert.equal(project.typeId, 'type-x')
    assert.equal(database.updateProject({ id: project.id, name: 'Typed', color: project.color }).projects[0].typeId, 'type-x')
    assert.equal(database.updateProject({ id: project.id, name: 'Typed', color: project.color, typeId: null }).projects[0].typeId, null)
    const settings = database.getSettings()
    const saved = database.updateSettings({ ...settings, projectTypes: [{ id: 'type-x', name: 'Client', color: '#7bdff2' }] })
    assert.equal(saved.settings.projectTypes[0].name, 'Client')
  })
})

test('a backup restore keeps the manual project order', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.createProject({ name: 'A', color: '#b8e986' }))
    await atTime(at(26, 8, 1), () => database.createProject({ name: 'B', color: '#7bdff2' }))
    const created = await atTime(at(26, 8, 2), () => database.createProject({ name: 'C', color: '#f7a072' }))
    const [a, b, c] = created.projects
    database.reorderProjects([c.id, a.id, b.id])

    const restored = database.importBackup(database.exportBackup(), 'replace')
    assert.deepEqual(restored.projects.map((project) => project.name), ['C', 'A', 'B'])
  })
})

test('the workday start cannot move past already tracked time', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Work' }))
    await atTime(at(26, 12), () => assert.throws(() => database.updateWorkdayStart(at(26, 11)), /after tracked time/i))
    const earlier = await atTime(at(26, 12), () => database.updateWorkdayStart(at(26, 8, 30)))
    assert.equal(earlier.workday?.startedAt, at(26, 8, 30))
  })
})

test('project stats close a running interval left over from the previous day', async () => {
  await withDatabase(async (database) => {
    const created = await atTime(at(26, 8), () => database.createProject({ name: 'Night', color: '#b8e986' }))
    await atTime(at(26, 22), () => database.startTask({ mode: 'parallel', projectId: created.projects[0].id, notes: 'Late' }))

    const [stats] = await atTime(at(27, 9), () => database.getProjectStats())
    assert.equal(stats.totalMs, 2 * 60 * 60 * 1000)
    assert.equal(stats.todayMs, 0)
    assert.equal(stats.lastWorkedAt, at(27, 0))
  })
})

test('continuing a day restores a task that was edited after the day ended', async () => {
  await withDatabase(async (database) => {
    const started = await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Morning' }))
    await atTime(at(26, 11), () => database.endWorkday())
    await atTime(at(26, 11, 30), () => database.updateTask({ id: started.tasks[0].id, notes: 'Morning, fixed' }))

    const resumed = await atTime(at(26, 12), () => database.resumeWorkday())
    assert.equal(resumed.tasks.find((task) => task.id === started.tasks[0].id)?.status, 'paused')
  })
})

test('rejects a project budget that rounds to zero minutes', async () => {
  await withDatabase(async (database) => {
    assert.throws(() => database.createProject({ name: 'Tiny', color: '#b8e986', budgetHours: 0.005 }))
  })
})

test('built-in project statuses follow the interface language', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    assert.equal(settings.projectStatuses[0].name, 'Активний')
    const english = database.updateSettings({ ...settings, locale: 'en' }).settings
    assert.equal(english.projectStatuses[0].name, 'Active')
    const renamed = database.updateSettings({ ...english, projectStatuses: [{ ...english.projectStatuses[0], name: 'Doing' }, ...english.projectStatuses.slice(1)] }).settings
    assert.equal(database.updateSettings({ ...renamed, locale: 'uk' }).settings.projectStatuses[0].name, 'Doing')
  })
})

test('reordering one view keeps every project position unique', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.createProject({ name: 'A', color: '#b8e986' }))
    await atTime(at(26, 8, 1), () => database.createProject({ name: 'B', color: '#7bdff2' }))
    const created = await atTime(at(26, 8, 2), () => database.createProject({ name: 'Old', color: '#f7a072' }))
    const [a, b, old] = created.projects
    database.updateProject({ id: old.id, name: old.name, color: old.color, archived: true })
    database.reorderProjects([b.id, a.id])
    const restored = database.updateProject({ id: old.id, name: old.name, color: old.color, archived: false })
    assert.deepEqual(restored.projects.map((project) => project.name), ['B', 'A', 'Old'])
  })
})

test('calendar export leaves out time that is still running', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Done' }))
    await atTime(at(26, 10), () => database.startTask({ mode: 'switch', notes: 'Running' }))
    const ics = await atTime(at(26, 11), () => database.createCalendarIcs('2026-08-26', '2026-08-26'))
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1)
    assert.match(ics, /SUMMARY:Done/)
  })
})

test('project stats and task summaries pick up new tracked time', async () => {
  await withDatabase(async (database) => {
    const created = await atTime(at(26, 8), () => database.createProject({ name: 'Alpha', color: '#b8e986' }))
    const projectId = created.projects[0].id
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', projectId, notes: 'One' }))
    assert.equal((await atTime(at(26, 10), () => database.getProjectStats()))[0].totalMs, 60 * 60 * 1000)
    await atTime(at(26, 10), () => database.endWorkday())
    assert.equal((await atTime(at(26, 12), () => database.getProjectStats()))[0].totalMs, 60 * 60 * 1000)
    await atTime(at(26, 13), () => database.startTask({ mode: 'parallel', projectId, notes: 'Two' }))
    assert.equal((await atTime(at(26, 14), () => database.getProjectStats()))[0].totalMs, 2 * 60 * 60 * 1000)

    const tasks = await atTime(at(26, 14), () => database.getProjectTasks(projectId))
    assert.deepEqual(tasks.map((task) => [task.label, task.totalMs, task.intervalCount]), [['Two', 60 * 60 * 1000, 1], ['One', 60 * 60 * 1000, 1]])
    assert.equal(tasks[1].firstStartedAt, at(26, 9))
    assert.equal(tasks[1].lastEndedAt, at(26, 10))
  })
})

test('project task summaries keep tasks without tracked time last', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-empty-task-test-'))
  const path = join(directory, 'work-buddy.sqlite')
  const database = new WorkBuddyDatabase(path)
  try {
    const created = await atTime(at(26, 8), () => database.createProject({ name: 'Alpha', color: '#b8e986' }))
    const projectId = created.projects[0].id
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', projectId, notes: 'Tracked' }))
    await atTime(at(26, 10), () => database.endWorkday())
    const raw = new DatabaseSync(path)
    raw.prepare("INSERT INTO tasks (id, title, project_id, notes, status, created_at, updated_at) VALUES ('empty', '', ?, 'Empty', 'stopped', ?, ?)").run(projectId, at(26, 11), at(26, 11))
    raw.close()

    const tasks = await atTime(at(26, 12), () => database.getProjectTasks(projectId))
    assert.deepEqual(tasks.map((task) => task.label), ['Tracked', 'Empty'])
    assert.equal(tasks[1].lastEndedAt, null)
    assert.equal(tasks[1].firstStartedAt, null)
  } finally {
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('project stats refresh after tasks change but ignore unrelated writes', async () => {
  await withDatabase(async (database) => {
    const created = await atTime(at(26, 8), () => database.createProject({ name: 'Alpha', color: '#b8e986' }))
    const projectId = created.projects[0].id
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', projectId, notes: 'One' }))
    const snapshot = await atTime(at(26, 10), () => database.endWorkday())
    assert.equal((await atTime(at(26, 12), () => database.getProjectStats()))[0].totalMs, 60 * 60 * 1000)
    database.createPlannedTask({ title: 'Later' })
    assert.equal((await atTime(at(26, 12), () => database.getProjectStats()))[0].taskCount, 1)
    database.deleteTask(snapshot.tasks[0].id)
    const [stats] = await atTime(at(26, 12), () => database.getProjectStats())
    assert.equal(stats.totalMs, 0)
    assert.equal(stats.taskCount, 0)
    assert.equal(stats.lastWorkedAt, null)
  })
})

test('a deliberate rename to the other language default name survives saves', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    const renamed = database.updateSettings({ ...settings, projectStatuses: [{ ...settings.projectStatuses[0], name: 'Active' }, ...settings.projectStatuses.slice(1)] }).settings
    assert.equal(renamed.projectStatuses[0].name, 'Active')
    assert.equal(database.updateSettings(renamed).settings.projectStatuses[0].name, 'Active')
    assert.equal(database.getSettings().projectStatuses[0].name, 'Active')
    const english = database.updateSettings({ ...renamed, locale: 'en' }).settings
    assert.equal(english.projectStatuses[0].name, 'Active')
    assert.equal(english.projectStatuses[1].name, 'On hold')
  })
})

test('migrates built-in statuses stored in Ukrainian for an English interface once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-status-test-'))
  const path = join(directory, 'work-buddy.sqlite')
  new WorkBuddyDatabase(path).close()
  const raw = new DatabaseSync(path)
  const stored = JSON.parse((raw.prepare('SELECT json FROM app_settings WHERE id = 1').get() as { json: string }).json)
  raw.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify({ ...stored, locale: 'en' }))
  raw.exec('PRAGMA user_version = 0')
  raw.close()
  let database = new WorkBuddyDatabase(path)
  try {
    const settings = database.getSettings()
    assert.equal(settings.projectStatuses[0].name, 'Active')
    database.updateSettings({ ...settings, projectStatuses: [{ ...settings.projectStatuses[0], name: 'Активний' }, ...settings.projectStatuses.slice(1)] })
    database.close()
    database = new WorkBuddyDatabase(path)
    assert.equal(database.getSettings().projectStatuses[0].name, 'Активний')
  } finally {
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('closing a stale workday never ends time that started after midnight before it began', async () => {
  await withDatabase(async (database) => {
    const settings = database.getSettings()
    database.updateSettings({ ...settings, workday: { ...settings.workday, startTime: '22:00', endTime: '06:00' } })
    await atTime(at(26, 22), () => database.startTask({ mode: 'parallel', notes: 'Late' }))
    await atTime(at(27, 1), () => database.startTask({ mode: 'parallel', notes: 'After midnight' }))
    await atTime(at(27, 1, 30), () => database.startRest('break'))
    await atTime(at(27, 1, 45), () => database.updateSettings({ ...settings, workday: { ...settings.workday, startTime: '09:00', endTime: '18:00' } }))

    const backup = await atTime(at(27, 2), () => database.exportBackup())
    for (const task of backup.tasks) for (const interval of task.intervals) assert.ok(interval.endedAt !== null && interval.endedAt >= interval.startedAt)
    for (const rest of backup.rests) {
      assert.ok(rest.endedAt !== null && rest.endedAt >= rest.createdAt)
      for (const interval of rest.intervals) assert.ok(interval.endedAt !== null && interval.endedAt >= interval.startedAt)
    }
    assert.doesNotThrow(() => database.parseBackup(JSON.stringify(backup)))
  })
})

test('a second workday on the same day can move its start up to its own tracked time', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Morning' }))
    await atTime(at(26, 11), () => database.endWorkday())
    await atTime(at(26, 13), () => database.startWorkday())
    await atTime(at(26, 14), () => database.startTask({ mode: 'parallel', notes: 'Afternoon' }))

    const later = await atTime(at(26, 15), () => database.updateWorkdayStart(at(26, 13, 30)))
    assert.equal(later.workday?.startedAt, at(26, 13, 30))
    await atTime(at(26, 15), () => assert.throws(() => database.updateWorkdayStart(at(26, 14, 30)), /after tracked time/i))
    await atTime(at(26, 15), () => assert.throws(() => database.updateWorkdayStart(at(26, 10)), /previous workday/i))
    const atPreviousEnd = await atTime(at(26, 15), () => database.updateWorkdayStart(at(26, 11)))
    assert.equal(atPreviousEnd.workday?.startedAt, at(26, 11))
  })
})

test('history treats a missing day count from the extension bridge as the default range', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => {
      assert.equal(database.getHistory(null).length, 182)
      assert.equal(database.getHistory(Number.NaN).length, 182)
      assert.equal(database.getHistory(30).length, 30)
    })
  })
})

test('past overtime keeps the schedule its day was worked under', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 9), () => database.startWorkday())
    await atTime(at(26, 9), () => database.startTask({ mode: 'parallel', notes: 'Long day' }))
    await atTime(at(26, 19), () => database.endWorkday())
    assert.equal(database.getOvertimeOverview().days[0].overtimeMs, 60 * 60 * 1000)

    const settings = database.getSettings()
    await atTime(at(27, 8), () => database.updateSettings({ ...settings, workday: { ...settings.workday, endTime: '17:00' } }))
    const [day] = await atTime(at(27, 8), () => database.getOvertimeOverview().days)
    assert.equal(day.date, '2026-08-26')
    assert.equal(day.overtimeMs, 60 * 60 * 1000)

    // Today still follows a schedule change made while it is open.
    const opened = await atTime(at(27, 9), () => database.startWorkday())
    assert.equal(opened.workday?.scheduledMinutes, 8 * 60)
    const longer = await atTime(at(27, 10), () => database.updateSettings({ ...opened.settings, workday: { ...opened.settings.workday, endTime: '19:00' } }))
    assert.equal(longer.workday?.scheduledMinutes, 10 * 60)
  })
})

test('sessions on one day share one allowance and time off between them moves the finish', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.startTask({ mode: 'parallel', notes: 'Morning' }))
    await atTime(at(26, 12), () => database.endWorkday())
    await atTime(at(26, 13), () => database.startTask({ mode: 'parallel', notes: 'Evening' }))
    const live = await atTime(at(26, 20), () => database.getSnapshot())
    assert.deepEqual(live.workday?.earlierSessions, [{ startedAt: at(26, 8), endedAt: at(26, 12) }])
    await atTime(at(26, 23), () => database.endWorkday())

    // 14 hours of work against a 9-hour plan, with an hour off at 12:00.
    const [day] = database.getOvertimeOverview().days
    assert.equal(day.overtimeMs, 5 * 60 * 60 * 1000)
  })
})

test('a session started after the planned finish counts only its own work as overtime', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.startTask({ mode: 'parallel', notes: 'Day' }))
    await atTime(at(26, 17), () => database.endWorkday())
    await atTime(at(26, 20), () => database.startTask({ mode: 'parallel', notes: 'Hotfix' }))
    await atTime(at(26, 21), () => database.endWorkday())
    assert.equal(database.getOvertimeOverview().days[0].overtimeMs, 60 * 60 * 1000)
  })
})

test('a short morning and a short evening session make no overtime together', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 8), () => database.startTask({ mode: 'parallel', notes: 'Morning' }))
    await atTime(at(26, 12), () => database.endWorkday())
    await atTime(at(26, 15), () => database.startTask({ mode: 'parallel', notes: 'Afternoon' }))
    await atTime(at(26, 20), () => database.endWorkday())
    assert.equal(database.getOvertimeOverview().days.length, 0)
  })
})

test('resetting an accidental day removes it and the time tracked in it', async () => {
  await withDatabase(async (database) => {
    await atTime(at(25, 9), () => database.startTask({ mode: 'parallel', notes: 'Yesterday' }))
    const yesterday = await atTime(at(25, 17), () => database.endWorkday())
    const oldTask = yesterday.tasks[0]
    const planned = database.createPlannedTask({ title: 'Plan' }).plannedTasks[0]

    await atTime(at(26, 9), () => database.startWorkday())
    await atTime(at(26, 9, 5), () => database.resumeTask(oldTask.id, 'parallel'))
    await atTime(at(26, 9, 10), () => database.startTask({ mode: 'parallel', notes: 'Oops', plannedTaskId: planned.id }))
    const open = await atTime(at(26, 9, 20), () => database.getSnapshot())
    assert.equal(open.plannedTasks.length, 0)

    const reset = await atTime(at(26, 9, 30), () => database.resetWorkday(open.workday!.id))
    assert.equal(reset.workday, null)
    assert.deepEqual(reset.tasks.map((task) => task.notes), [])
    assert.equal(reset.plannedTasks[0].id, planned.id)
    const history = await atTime(at(26, 9, 30), () => database.getHistory(30))
    assert.equal(history.find((day) => day.date === '2026-08-25')?.workedMs, 8 * 60 * 60 * 1000)
    assert.equal(history.find((day) => day.date === '2026-08-26')?.workedMs ?? 0, 0)
  })
})
