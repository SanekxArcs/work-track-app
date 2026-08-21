import type { AppSettings, RestSession, RestType, Workday } from './types'

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

export function dueRestTypes(settings: AppSettings, workday: Workday | null, rests: RestSession[], workedMs: number, now = Date.now()): RestType[] {
  if (!workday || workday.endedAt !== null || rests.some((rest) => rest.status !== 'completed')) return []
  const due: RestType[] = []
  const lunchSkipped = rests.some((rest) => rest.type === 'lunch' && rest.plannedMinutes === 0)
  const breakSkipped = rests.some((rest) => rest.type === 'break' && rest.plannedMinutes === 0)
  const lunches = rests.filter((rest) => rest.type === 'lunch' && rest.plannedMinutes > 0)
  const lunchDue = settings.lunch.enabled && !lunchSkipped && lunches.length === 0 && (
    settings.lunch.mode === 'clock'
      ? currentMinute(now) >= minuteOfDay(settings.lunch.time)
      : workedMs >= settings.lunch.afterMinutes * MINUTE
  )
  if (lunchDue) due.push('lunch')

  const breaksTaken = rests.filter((rest) => rest.type === 'break' && rest.plannedMinutes > 0).length
  const breaksEarned = settings.breaks.enabled ? Math.floor(workedMs / (settings.breaks.everyMinutes * MINUTE)) : 0
  if (!breakSkipped && breaksEarned > breaksTaken) due.push('break')
  return due
}
