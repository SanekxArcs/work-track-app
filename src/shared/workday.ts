import type { AppSettings, RestSession, Workday } from './types'

const MINUTE = 60_000

function plannedEndOnWorkdayDate(workdayStartedAt: number, endTime: string): number {
  const [hours, minutes] = endTime.split(':').map(Number)
  const plannedEnd = new Date(workdayStartedAt)
  plannedEnd.setHours(hours || 0, minutes || 0, 0, 0)
  return plannedEnd.getTime()
}

function lunchOverageMs(settings: AppSettings, workday: Workday, rests: RestSession[], now: number): number {
  const lunchElapsed = rests
    .filter((rest) => rest.type === 'lunch')
    .flatMap((rest) => rest.intervals)
    .reduce((total, interval) => total + Math.max(0, Math.min(interval.endedAt ?? now, now) - Math.max(interval.startedAt, workday.startedAt)), 0)
  return Math.max(0, lunchElapsed - settings.lunch.durationMinutes * MINUTE)
}

/** The planned finish, extended only by lunch time that exceeded its planned duration. */
export function scheduledWorkdayEndAt(settings: AppSettings, workday: Workday | null | undefined, rests: RestSession[], now = Date.now()): number | null {
  if (!workday || workday.endedAt !== null) return null

  const plannedEnd = new Date(plannedEndOnWorkdayDate(workday.startedAt, settings.workday.endTime))
  if (plannedEnd.getTime() <= workday.startedAt) plannedEnd.setDate(plannedEnd.getDate() + 1)
  return plannedEnd.getTime() + lunchOverageMs(settings, workday, rests, now)
}

/**
 * Overtime belongs to actual work performed after the planned finish.
 * A second session started after the planned finish must never inherit the
 * empty gap between the planned end and its own start.
 */
export function workdayOvertimeMs(settings: AppSettings, workday: Workday | null | undefined, rests: RestSession[], now = Date.now()): number {
  if (!workday) return 0
  const endedAt = workday.endedAt ?? now
  if (endedAt <= workday.startedAt) return 0

  const plannedEnd = plannedEndOnWorkdayDate(workday.startedAt, settings.workday.endTime)
  const threshold = workday.startedAt >= plannedEnd
    ? workday.startedAt
    : plannedEnd + lunchOverageMs(settings, workday, rests, endedAt)
  return Math.max(0, endedAt - threshold)
}
