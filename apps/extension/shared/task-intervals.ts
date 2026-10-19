import type { Task, TaskIntervalOperation, TimeInterval } from './types'

/** Apply draft operations in order. A merge fills the gap between adjacent ranges. */
export function applyIntervalOperations(intervals: TimeInterval[], operations: TaskIntervalOperation[]): TimeInterval[] {
  let result = intervals.map((interval) => ({ ...interval })).sort((a, b) => a.startedAt - b.startedAt)
  for (const operation of operations) {
    if (operation.type === 'delete') {
      if (!result.some((interval) => interval.id === operation.id)) throw new Error('Task interval not found')
      result = result.filter((interval) => interval.id !== operation.id)
    } else if (operation.type === 'merge') {
      const first = result.findIndex((interval) => interval.id === operation.firstId)
      const second = result.findIndex((interval) => interval.id === operation.secondId)
      if (first < 0 || second !== first + 1) throw new Error('Choose adjacent task intervals to merge')
      if (result[first].endedAt === null) throw new Error('The running interval must be last')
      result[first] = { ...result[first], endedAt: result[second].endedAt }
      result.splice(second, 1)
    } else {
      throw new Error('Invalid task interval operation')
    }
  }
  return result
}

/** Metadata edits never affect this order; historical views use only the selected day's time. */
export function sortTasksByTrackedTime(tasks: Task[], now: number, from = -Infinity, until = Infinity): Task[] {
  const score = (task: Task): [number, number] => {
    const ranges = task.intervals.filter((interval) => interval.startedAt < until && (interval.endedAt ?? now) >= from)
    return [Math.max(0, ...ranges.map((interval) => Math.min(interval.endedAt ?? now, now, until))),
      Math.max(0, ...ranges.map((interval) => interval.startedAt))]
  }
  const scores = new Map(tasks.map((task) => [task.id, score(task)]))
  return [...tasks].sort((a, b) => {
    const first = scores.get(a.id)!, second = scores.get(b.id)!
    return second[0] - first[0] || second[1] - first[1] || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  })
}
