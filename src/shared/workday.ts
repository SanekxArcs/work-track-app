import type { AppSettings, RestSession, Workday } from './types'

const MINUTE = 60_000

/** The planned finish, extended only by lunch time that exceeded its planned duration. */
export function scheduledWorkdayEndAt(settings: AppSettings, workday: Workday | null | undefined, rests: RestSession[], now = Date.now()): number | null {
  if (!workday || workday.endedAt !== null) return null

  const [hours, minutes] = settings.workday.endTime.split(':').map(Number)
  const plannedEnd = new Date(workday.startedAt)
  plannedEnd.setHours(hours || 0, minutes || 0, 0, 0)
  if (plannedEnd.getTime() <= workday.startedAt) plannedEnd.setDate(plannedEnd.getDate() + 1)

  const lunchElapsed = rests
    .filter((rest) => rest.type === 'lunch')
    .flatMap((rest) => rest.intervals)
    .reduce((total, interval) => total + Math.max(0, Math.min(interval.endedAt ?? now, now) - Math.max(interval.startedAt, workday.startedAt)), 0)
  const lunchOverage = Math.max(0, lunchElapsed - settings.lunch.durationMinutes * MINUTE)
  return plannedEnd.getTime() + lunchOverage
}
