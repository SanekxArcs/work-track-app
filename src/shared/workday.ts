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

/** The scheduled length of a day, including overnight schedules. */
export function scheduledWorkdayDurationMs(settings: AppSettings): number {
  const start = minutesSinceMidnight(settings.workday.startTime)
  const end = minutesSinceMidnight(settings.workday.endTime)
  return (end > start ? end - start : end + 24 * 60 - start) * MINUTE
}

/** The usual clock-time finish on the calendar date that this workday began. */
export function scheduledWorkdayClockEndAt(settings: AppSettings, workday: Workday | null | undefined): number | null {
  if (!workday) return null
  const plannedEnd = new Date(plannedEndOnWorkdayDate(workday.startedAt, settings.workday.endTime))
  if (minutesSinceMidnight(settings.workday.endTime) <= minutesSinceMidnight(settings.workday.startTime)) {
    plannedEnd.setDate(plannedEnd.getDate() + 1)
  }
  return plannedEnd.getTime()
}

/** The scheduled length stored on the workday, falling back to the settings for days without one. */
export function workdayPlannedDurationMs(settings: AppSettings, workday: Workday | null | undefined): number {
  return typeof workday?.scheduledMinutes === 'number' ? workday.scheduledMinutes * MINUTE : scheduledWorkdayDurationMs(settings)
}

export function workdayLunchAllowanceMs(settings: AppSettings, workday: Workday | null | undefined): number {
  return (typeof workday?.lunchMinutes === 'number' ? workday.lunchMinutes : settings.lunch.durationMinutes) * MINUTE
}

/** When the first workday of this calendar day began. */
export function dayStartedAt(workday: Workday): number {
  return workday.earlierSessions?.[0]?.startedAt ?? workday.startedAt
}

function lunchOverageMs(settings: AppSettings, workday: Workday, rests: RestSession[], now: number): number {
  const dayStart = dayStartedAt(workday)
  const lunchElapsed = rests
    .filter((rest) => rest.type === 'lunch')
    .flatMap((rest) => rest.intervals)
    .reduce((total, interval) => total + Math.max(0, Math.min(interval.endedAt ?? now, now) - Math.max(interval.startedAt, dayStart)), 0)
  return Math.max(0, lunchElapsed - workdayLunchAllowanceMs(settings, workday))
}

/**
 * The day's planned finish: the first start plus the scheduled length, extended by lunch time
 * above its allowance and by every gap between finished sessions that began before that finish
 * (the day was off then). Gaps after the planned finish change nothing.
 */
export function dayPlannedEndAt(settings: AppSettings, workday: Workday, rests: RestSession[], now = Date.now()): number {
  const sessions = [...(workday.earlierSessions ?? []), { startedAt: workday.startedAt, endedAt: workday.endedAt }]
  let plannedEnd = dayStartedAt(workday) + workdayPlannedDurationMs(settings, workday) + lunchOverageMs(settings, workday, rests, workday.endedAt ?? now)
  for (let index = 1; index < sessions.length; index += 1) {
    const gapStart = sessions[index - 1].endedAt ?? sessions[index].startedAt
    if (gapStart < plannedEnd) plannedEnd += Math.max(0, sessions[index].startedAt - gapStart)
  }
  return plannedEnd
}

/** The planned finish of the open workday. */
export function scheduledWorkdayEndAt(settings: AppSettings, workday: Workday | null | undefined, rests: RestSession[], now = Date.now()): number | null {
  if (!workday || workday.endedAt !== null) return null
  return dayPlannedEndAt(settings, workday, rests, now)
}

/**
 * Overtime belongs to actual work performed after the day's planned finish.
 * A second session started after the planned finish must never inherit the
 * empty gap between the planned end and its own start. Pass the work intervals
 * of every session of the day so earlier sessions count too.
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

  const threshold = dayPlannedEndAt(settings, workday, rests, endedAt)
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
