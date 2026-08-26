import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkBuddyDatabase } from '../src/main/database.ts'

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

test('rejects an invalid backup before it can be imported into SQLite', async () => {
  await withDatabase(async (database) => {
    await atTime(at(26, 10), () => database.startTask({ mode: 'parallel', notes: 'Safe task' }))
    await atTime(at(26, 11), () => database.endWorkday())
    const backup = database.exportBackup()
    backup.tasks[0].status = 'invalid' as 'stopped'

    assert.throws(() => database.parseBackup(JSON.stringify(backup)), /invalid tasks/i)
    assert.equal(database.exportBackup().tasks.length, 1)
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
