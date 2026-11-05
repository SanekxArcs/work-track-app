export interface TimeRange {
  start: number
  end: number
}
/** One closed period an external producer asks Work Buddy to record as a stopped task. */
export interface TaskImportEntry {
  /** Stable 64-hex key chosen by the producer; replaying the same key is idempotent. */
  key: string
  intervals: TimeRange[]
  projectId: string | null
  notes: string
}
/** Sorts ranges and merges touching or overlapping ones. */
export function normalizeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  const result: TimeRange[] = []
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.end <= range.start)
      throw new Error('Invalid time range')
    const prior = result.at(-1)
    if (prior && prior.end >= range.start) prior.end = Math.max(prior.end, range.end)
    else result.push({ ...range })
  }
  return result
}
