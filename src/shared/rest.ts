import type { AppSettings, RestSession, RestType, Task, TimeInterval, Workday } from './types'

const MINUTE = 60_000

function minuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function currentMinute(timestamp: number): number {
  const date = new Date(timestamp)
  return date.getHours() * 60 + date.getMinutes()
}

export function restElapsed(rest: RestSession, now = Date.now()): number {
  return rest.intervals.reduce((sum, interval) => sum + Math.max(0, (interval.endedAt ?? now) - interval.startedAt), 0)
}

export function restRemaining(rest: RestSession, now = Date.now()): number {
  return Math.max(0, rest.plannedMinutes * MINUTE - restElapsed(rest, now))
}

function unionDuration(intervals: TimeInterval[], startAt: number, now: number): number {
  const ranges = intervals
    .map((interval) => [Math.max(startAt, interval.startedAt), Math.min(interval.endedAt ?? now, now)] as const)
    .filter(([, end]) => end > startAt)
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

export function breakStreakStartedAt(workday: Workday, rests: RestSession[]): number {
  const completedRestEnds = rests
    .filter((rest) => rest.status === 'completed' && rest.plannedMinutes > 0)
    .flatMap((rest) => rest.intervals)
    .map((interval) => interval.endedAt ?? 0)
  return Math.max(workday.startedAt, ...completedRestEnds)
}

export function dueRestTypes(settings: AppSettings, workday: Workday | null, rests: RestSession[], tasks: Task[], now = Date.now()): RestType[] {
  if (!workday || workday.endedAt !== null || rests.some((rest) => rest.status !== 'completed')) return []
  const due: RestType[] = []
  const workIntervals = tasks.flatMap((task) => task.intervals)
  const workedMs = unionDuration(workIntervals, workday.startedAt, now)
  const lunchSkipped = rests.some((rest) => rest.type === 'lunch' && rest.plannedMinutes === 0)
  const breakSkipped = rests.some((rest) => rest.type === 'break' && rest.plannedMinutes === 0)
  const lunches = rests.filter((rest) => rest.type === 'lunch' && rest.plannedMinutes > 0)
  const lunchDue = settings.lunch.enabled && !lunchSkipped && lunches.length === 0 && (
    settings.lunch.mode === 'clock'
      ? currentMinute(now) >= minuteOfDay(settings.lunch.time)
      : workedMs >= settings.lunch.afterMinutes * MINUTE
  )
  if (lunchDue) due.push('lunch')

  const activeWorkSinceRest = unionDuration(workIntervals, breakStreakStartedAt(workday, rests), now)
  if (!breakSkipped && settings.breaks.enabled && activeWorkSinceRest >= settings.breaks.everyMinutes * MINUTE) due.push('break')
  return due
}
