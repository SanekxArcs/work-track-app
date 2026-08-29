import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    assert.equal(scheduledWorkdayEndAt(snapshot.settings, snapshot.workday, snapshot.rests, at(27, 0, 10)), at(27, 6, 10))
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
      breaks: { ...malformed.settings.breaks, everyMinutes: -4 }
    }
    database.importBackup(malformed, 'replace')

    const settings = database.getSettings()
    assert.equal(settings.workday.startTime, '09:00')
    assert.equal(settings.breaks.everyMinutes, 55)
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
