import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppSettings, RestSession, TimeInterval, Workday } from '../src/shared/types.ts'
import { localDateKey, localDateTimestamp, localDayBounds } from '../src/shared/local-date.ts'
import { scheduledWorkdayEndAt, workdayOvertimeMs } from '../src/shared/workday.ts'

const MINUTE = 60_000

function at(hours: number, minutes = 0, dayOffset = 0): number {
  const value = new Date(2026, 7, 26 + dayOffset, hours, minutes, 0, 0)
  return value.getTime()
}

function settings(endTime = '16:00', lunchMinutes = 30): AppSettings {
  return {
    locale: 'uk', theme: 'dark', alwaysOnTop: true, autoStart: true, globalShortcut: 'CommandOrControl+Shift+T',
    workday: { startReminder: true, startTime: '08:00', endReminder: true, endTime },
    breaks: { enabled: true, everyMinutes: 55, durationMinutes: 5 },
    lunch: { enabled: true, mode: 'worked', time: '13:00', afterMinutes: 240, durationMinutes: lunchMinutes, includedInWorkHours: false },
    idle: { enabled: true, thresholdMinutes: 10 },
    notifications: { sound: 'soft', volume: 0.7, customSoundPath: '', customSoundName: '' },
    wellnessEnabled: true, wellnessActions: [], projectColors: [],
    ai: { enabled: false, model: 'gemini-3.5-flash-lite', hasApiKey: false }
  }
}

function workday(startedAt: number, endedAt: number | null): Workday {
  return { id: 'day', startedAt, endedAt }
}

function lunch(startedAt: number, endedAt: number): RestSession {
  return {
    id: 'lunch', type: 'lunch', status: 'completed', plannedMinutes: 30, alarmMuted: false,
    createdAt: startedAt, endedAt,
    intervals: [{ id: 'lunch-interval', restId: 'lunch', startedAt, endedAt }]
  }
}

function worked(startedAt: number, endedAt: number): TimeInterval {
  return { id: `${startedAt}-${endedAt}`, taskId: 'task', startedAt, endedAt }
}

test('does not count a late-started short day as overtime before its shifted finish', () => {
  const start = at(22, 55)
  const end = at(22, 59)
  assert.equal(workdayOvertimeMs(settings(), workday(start, end), [], end, [worked(start, end)]), 0)
})

test('counts overtime after a regular planned finish', () => {
  const start = at(8)
  const end = at(17)
  assert.equal(workdayOvertimeMs(settings(), workday(start, end), [], end, [worked(start, end)]), 60 * MINUTE)
})

test('extends the planned finish only by lunch time above its configured duration', () => {
  const start = at(8)
  const lunchStart = at(12)
  const lunchEnd = at(13, 45)
  const end = at(17, 15)
  const rests = [lunch(lunchStart, lunchEnd)]
  assert.equal(scheduledWorkdayEndAt(settings(), workday(start, null), rests, end), end)
  assert.equal(workdayOvertimeMs(settings(), workday(start, end), rests, end, [worked(start, end)]), 0)
})

test('does not extend a day with lunch time before the day actually started', () => {
  const start = at(14)
  const end = at(16, 30)
  const rests = [lunch(at(12), at(13, 45))]
  assert.equal(workdayOvertimeMs(settings(), workday(start, end), rests, end, [worked(start, end)]), 0)
})

test('does not count an end-of-day break as overtime', () => {
  const start = at(8)
  const breakStart = at(16)
  const end = at(19)
  assert.equal(workdayOvertimeMs(settings(), workday(start, end), [], end, [worked(start, breakStart)]), 0)
})

test('uses the next calendar day for an overnight work schedule', () => {
  const nightSettings = settings('06:00')
  nightSettings.workday.startTime = '22:00'
  const start = at(22)
  const end = at(6, 0, 1)
  assert.equal(scheduledWorkdayEndAt(nightSettings, workday(start, null), [], end), end)
  assert.equal(workdayOvertimeMs(nightSettings, workday(start, end), [], end, [worked(start, end)]), 0)
})

test('moves the finish with the actual start, even when the day begins late', () => {
  const start = at(22, 55)
  assert.equal(scheduledWorkdayEndAt(settings(), workday(start, null), [], start), at(6, 55, 1))
})

test('uses the actual day start for the planned finish', () => {
  const start = at(8, 10)
  const end = at(16, 10)
  assert.equal(scheduledWorkdayEndAt(settings(), workday(start, null), [], start), end)
  assert.equal(workdayOvertimeMs(settings(), workday(start, end), [], end, [worked(start, end)]), 0)
})

test('uses local calendar boundaries instead of a fixed 24-hour range', () => {
  const timestamp = at(18, 30)
  const [start, end] = localDayBounds(timestamp)
  const expectedEnd = new Date(start)
  expectedEnd.setDate(expectedEnd.getDate() + 1)
  assert.equal(end, expectedEnd.getTime())
  assert.equal(localDateKey(start), '2026-08-26')
  assert.equal(localDateKey(localDateTimestamp('2026-08-26')), '2026-08-26')
  assert.throws(() => localDateTimestamp('2026-02-30'), /Invalid history date/)
})
