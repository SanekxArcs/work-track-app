import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import { staleReminderKeys } from '../src/main/reminder-schedule.ts'

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

test('reminders scheduled well before launch are seeded as fired while recent and future ones still fire', () => {
  const db = new WorkBuddyDatabase(':memory:')
  try {
    const settings = db.getSettings()
    db.updateSettings({ ...settings, workday: { ...settings.workday, startTime: '09:00', endTime: '17:00' } })
    db.createPlannedTask({ title: 'Old', reminderTime: '08:00' })
    db.createPlannedTask({ title: 'Soon', reminderTime: '10:55' })
    db.createPlannedTask({ title: 'Later', reminderTime: '14:00' })
    db.createPlannedTask({ title: 'No reminder' })
    const morning = atTime(at(26, 11, 0), () => db.getSnapshot())
    const idOf = (title: string) => morning.plannedTasks.find((task) => task.title === title)!.id
    const keys = staleReminderKeys(morning, morning.now)
    assert.ok(keys.includes('start'))
    assert.ok(keys.includes(`planned-task:${idOf('Old')}`))
    assert.ok(!keys.includes(`planned-task:${idOf('Soon')}`))
    assert.ok(!keys.includes(`planned-task:${idOf('Later')}`))
    assert.ok(!keys.some((key) => key.startsWith('end')))
    // Exactly at the grace boundary the reminder is still considered fresh.
    assert.ok(!staleReminderKeys(morning, at(26, 9, 9)).includes('start'))
    assert.ok(staleReminderKeys(morning, at(26, 9, 10)).includes('start'))
    assert.deepEqual(staleReminderKeys(morning, at(26, 7, 0)), [])

    atTime(at(26, 9, 0), () => db.startWorkday())
    const evening = atTime(at(26, 20, 0), () => db.getSnapshot())
    const eveningKeys = staleReminderKeys(evening, evening.now)
    assert.ok(eveningKeys.includes(`end:${evening.workday!.id}`))
    assert.ok(eveningKeys.includes(`end-later:${evening.workday!.id}`))
    const midday = atTime(at(26, 12, 0), () => db.getSnapshot())
    assert.ok(!staleReminderKeys(midday, midday.now).some((key) => key.startsWith('end')))
  } finally {
    db.close()
  }
})
