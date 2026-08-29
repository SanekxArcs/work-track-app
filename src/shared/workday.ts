import type { AppSettings, RestSession, TimeInterval, Workday } from './types'

const MINUTE = 60_000

function plannedEndOnWorkdayDate(workdayStartedAt: number, endTime: string): number {
  const [hours, minutes] = endTime.split(':').map(Number)
  const plannedEnd = new Date(workdayStartedAt)
  plannedEnd.setHours(hours || 0, minutes || 0, 0, 0)
  return plannedEnd.getTime()
}

function minutesSinceMidnight(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

function plannedEndAt(settings: AppSettings, workdayStartedAt: number): number {
  const plannedEnd = new Date(plannedEndOnWorkdayDate(workdayStartedAt, settings.workday.endTime))
  if (minutesSinceMidnight(settings.workday.endTime) <= minutesSinceMidnight(settings.workday.startTime)) {
    plannedEnd.setDate(plannedEnd.getDate() + 1)
  }
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

  return plannedEndAt(settings, workday.startedAt) + lunchOverageMs(settings, workday, rests, now)
}

/**
 * Overtime belongs to actual work performed after the planned finish.
 * A second session started after the planned finish must never inherit the
 * empty gap between the planned end and its own start.
 */
export function workdayOvertimeMs(
  settings: AppSettings,
  workday: Workday | null | undefined,
  rests: RestSession[],
  now = Date.now(),
  workIntervals?: TimeInterval[]
): number {
  if (!workday) return 0
  const endedAt = workday.endedAt ?? now
  if (endedAt <= workday.startedAt) return 0

  const plannedEnd = plannedEndAt(settings, workday.startedAt)
  const threshold = workday.startedAt >= plannedEnd
    ? workday.startedAt
    : plannedEnd + lunchOverageMs(settings, workday, rests, endedAt)
  if (!workIntervals) return Math.max(0, endedAt - threshold)

  const ranges = workIntervals
    .map((interval) => [Math.max(interval.startedAt, threshold), Math.min(interval.endedAt ?? endedAt, endedAt)] as const)
    .filter(([start, end]) => end > start)
    .sort((first, second) => first[0] - second[0])
  if (!ranges.length) return 0

  let total = 0
  let [start, end] = ranges[0]
  for (const [nextStart, nextEnd] of ranges.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd)
    else {
      total += end - start
      start = nextStart
      end = nextEnd
    }
  }
  return total + end - start
}
