import type { Locale, Task, TimeInterval } from '@shared/types'

/** Unit suffixes for the compact duration form: "1h 5m" in English, "1 год 5 хв" in Ukrainian. */
export function compactDurationUnits(locale: Locale = 'en'): { hours: string; minutes: string } {
  return locale === 'uk' ? { hours: ' год', minutes: ' хв' } : { hours: 'h', minutes: 'm' }
}

export function intervalDuration(interval: TimeInterval, now = Date.now()): number {
  return Math.max(0, Math.min(interval.endedAt ?? now, now) - interval.startedAt)
}

export function taskDuration(task: Task, now = Date.now()): number {
  return task.intervals.reduce((total, interval) => total + intervalDuration(interval, now), 0)
}

export function formatDuration(milliseconds: number, compact = false, locale: Locale = 'en'): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (compact) {
    const units = compactDurationUnits(locale)
    return hours > 0 ? `${hours}${units.hours} ${minutes}${units.minutes}` : `${minutes}${units.minutes}`
  }
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatHm(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000))
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

export function formatClock(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(timestamp)
}

export function unionDuration(intervals: TimeInterval[], now = Date.now()): number {
  const ranges = intervals
    .map((item) => [item.startedAt, Math.min(item.endedAt ?? now, now)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
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

export function overlapDuration(intervals: TimeInterval[], now = Date.now()): number {
  const events = intervals.flatMap((interval) => {
    const endedAt = Math.min(interval.endedAt ?? now, now)
    return endedAt > interval.startedAt
      ? [{ at: interval.startedAt, delta: 1 }, { at: endedAt, delta: -1 }]
      : []
  }).sort((a, b) => a.at - b.at || a.delta - b.delta)
  let active = 0
  let previous = events[0]?.at ?? now
  let overlap = 0
  for (const event of events) {
    if (active > 1) overlap += event.at - previous
    active += event.delta
    previous = event.at
  }
  return overlap
}

export function dayIntervals(tasks: Task[], dayTimestamp = Date.now()): TimeInterval[] {
  const start = new Date(dayTimestamp)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const dayStart = start.getTime()
  const dayEnd = end.getTime()
  return tasks.flatMap((task) => task.intervals.flatMap((interval) => {
    const startedAt = Math.max(interval.startedAt, dayStart)
    const endedAt = Math.min(interval.endedAt ?? dayTimestamp, dayTimestamp, dayEnd)
    if (endedAt <= startedAt) return []
    return [{ ...interval, startedAt, endedAt }]
  }))
}
