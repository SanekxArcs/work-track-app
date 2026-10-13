import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettings } from '../src/main/database.ts'
import { dailyRestBalance, dueRestTypes } from '../src/shared/rest.ts'
import type { AppSettings, RestSession, Task, Workday } from '../src/shared/types.ts'

const MINUTE = 60_000
const base = new Date(2026, 7, 26, 8, 0, 0, 0).getTime()

function settings(): AppSettings {
  return structuredClone(defaultSettings)
}

function task(id: string, startedAt: number, endedAt: number | null): Task {
  return {
    id, title: '', projectId: null, plannedTaskId: null, notes: '', tags: [], status: endedAt === null ? 'running' : 'paused', createdAt: startedAt, updatedAt: startedAt,
    intervals: [{ id: `${id}-interval`, taskId: id, startedAt, endedAt }]
  }
}

function rest(id: string, type: 'break' | 'lunch', startedAt: number, endedAt: number): RestSession {
  return {
    id, type, status: 'completed', plannedMinutes: 5, alarmMuted: false, createdAt: startedAt, endedAt,
    intervals: [{ id: `${id}-interval`, restId: id, startedAt, endedAt }]
  }
}

const workday: Workday = { id: 'day', startedAt: base, endedAt: null }

test('does not make a parallel pair of timers reach a break reminder twice as fast', () => {
  const snapshotSettings = settings()
  const now = base + 30 * MINUTE
  const tasks = [task('first', base, null), task('second', base, null)]
  assert.deepEqual(dueRestTypes(snapshotSettings, workday, [], tasks, now), [])
})

test('offers a break after the configured amount of actual work', () => {
  const snapshotSettings = settings()
  const now = base + snapshotSettings.breaks.everyMinutes * MINUTE
  assert.deepEqual(dueRestTypes(snapshotSettings, workday, [], [task('work', base, null)], now), ['break'])
})

test('resets the break cadence after a completed break', () => {
  const snapshotSettings = settings()
  const breakEnd = base + 60 * MINUTE
  const tasks = [task('work', base, null)]
  assert.deepEqual(dueRestTypes(snapshotSettings, workday, [rest('break', 'break', base + 55 * MINUTE, breakEnd)], tasks, breakEnd + 30 * MINUTE), [])
  assert.deepEqual(dueRestTypes(snapshotSettings, workday, [rest('break', 'break', base + 55 * MINUTE, breakEnd)], tasks, breakEnd + 55 * MINUTE), ['break'])
})

test('a skipped lunch suppresses lunch reminders without suppressing breaks', () => {
  const snapshotSettings = settings()
  snapshotSettings.lunch.mode = 'worked'
  snapshotSettings.lunch.afterMinutes = 30
  snapshotSettings.breaks.everyMinutes = 30
  const skippedLunch: RestSession = { ...rest('skip-lunch', 'lunch', base, base), plannedMinutes: 0 }
  assert.deepEqual(dueRestTypes(snapshotSettings, workday, [skippedLunch], [task('work', base, null)], base + 31 * MINUTE), ['break'])
})

test('used-up daily break allowance suppresses reminders even after more work', () => {
  const snapshotSettings = settings()
  snapshotSettings.breaks.dailyMinutes = 5
  const taken = rest('taken', 'break', base + 55 * MINUTE, base + 60 * MINUTE)
  assert.deepEqual(dueRestTypes(snapshotSettings, workday, [taken], [task('work', base, null)], base + 120 * MINUTE), [])
})

test('rest balance uses the saved day allowance and counts only actual rest intervals', () => {
  const taken = rest('lunch', 'lunch', base + 60 * MINUTE, base + 90 * MINUTE)
  const shortBreak = rest('short', 'break', base + 100 * MINUTE, base + 102 * MINUTE)
  const day = { ...workday, lunchMinutes: 60, breakMinutes: 15 }
  assert.deepEqual(dailyRestBalance(settings(), day, [taken, shortBreak], base + 180 * MINUTE), [
    { type: 'lunch', usedMs: 30 * MINUTE, remainingMs: 30 * MINUTE },
    { type: 'break', usedMs: 2 * MINUTE, remainingMs: 13 * MINUTE }
  ])
})
