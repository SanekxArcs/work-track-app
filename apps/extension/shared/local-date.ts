/** Local calendar-day helpers. End timestamps are exclusive. */
export function localDayBounds(timestamp = Date.now()): [number, number] {
  const start = new Date(timestamp)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.getTime(), end.getTime()]
}

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localDateTimestamp(value: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('Invalid history date')
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0)
  if (localDateKey(date.getTime()) !== value) throw new Error('Invalid history date')
  return date.getTime()
}

export function localDaysBefore(timestamp: number, days: number): number {
  const result = new Date(timestamp)
  result.setDate(result.getDate() - days)
  return result.getTime()
}
