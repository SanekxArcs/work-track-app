import type { AppSnapshot } from '../shared/types'
import { scheduledWorkdayClockEndAt, scheduledWorkdayEndAt } from '../shared/workday'

export const STALE_REMINDER_GRACE_MS = 10 * 60_000

function clockTimeToday(now: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  const at = new Date(now)
  at.setHours(hours, minutes, 0, 0)
  return at.getTime()
}

/**
 * Reminder keys whose scheduled moment is already well in the past at launch. The reminder
 * loop marks them as fired so a restart late in the day does not replay a burst of stale
 * notifications; anything due within the grace window still fires normally.
 */
export function staleReminderKeys(snapshot: AppSnapshot, now: number, graceMs = STALE_REMINDER_GRACE_MS): string[] {
  const cutoff = now - graceMs
  const keys: string[] = []
  const settings = snapshot.settings
  if (clockTimeToday(now, settings.workday.startTime) <= cutoff) keys.push('start')
  for (const task of snapshot.plannedTasks) {
    if (task.reminderTime && clockTimeToday(now, task.reminderTime) <= cutoff) keys.push(`planned-task:${task.id}`)
  }
  const workday = snapshot.workday
  if (workday) {
    const scheduledEndAt = scheduledWorkdayEndAt(settings, workday, snapshot.rests, now)
    const usualClockEndAt = scheduledWorkdayClockEndAt(settings, workday)
    if (scheduledEndAt !== null && scheduledEndAt <= cutoff) keys.push(`end:${workday.id}`)
    if (usualClockEndAt !== null && usualClockEndAt <= cutoff) keys.push(`end-later:${workday.id}`)
  }
  return keys
}
