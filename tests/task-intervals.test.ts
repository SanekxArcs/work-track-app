import assert from 'node:assert/strict'
import test from 'node:test'
import { applyIntervalOperations, sortTasksByTrackedTime } from '../src/shared/task-intervals.ts'
import type { Task, TimeInterval } from '../src/shared/types.ts'

const ranges: TimeInterval[] = [
  { id: 'one', taskId: 'task', startedAt: 1000, endedAt: 2000 },
  { id: 'tiny', taskId: 'task', startedAt: 3000, endedAt: 3001 },
  { id: 'last', taskId: 'task', startedAt: 4000, endedAt: null }
]

test('draft deletion followed by merging spans both surviving ranges without mutating the original', () => {
  const result = applyIntervalOperations(ranges, [{ type: 'delete', id: 'tiny' }, { type: 'merge', firstId: 'one', secondId: 'last' }])
  assert.deepEqual(result, [{ id: 'one', taskId: 'task', startedAt: 1000, endedAt: null }])
  assert.equal(ranges.length, 3)
  assert.equal(ranges[0].endedAt, 2000)
})

test('a merge can be followed by another merge or deletion of the combined range', () => {
  assert.deepEqual(applyIntervalOperations(ranges, [{ type: 'merge', firstId: 'one', secondId: 'tiny' }, { type: 'merge', firstId: 'one', secondId: 'last' }, { type: 'delete', id: 'one' }]), [])
})

test('nonadjacent ranges cannot be merged implicitly across an unselected range', () => {
  assert.throws(() => applyIntervalOperations(ranges, [{ type: 'merge', firstId: 'one', secondId: 'last' }]), /adjacent/)
})

test('historical task order ignores newer intervals recorded outside the selected date', () => {
  const task = (id: string, intervals: TimeInterval[]): Task => ({ id, intervals, title: '', notes: '', projectId: null, plannedTaskId: null, tags: [], status: 'paused', createdAt: 1, updatedAt: 99999 })
  const old = task('old', [{ id: 'a', taskId: 'old', startedAt: 1000, endedAt: 2000 }, { id: 'b', taskId: 'old', startedAt: 10000, endedAt: 20000 }])
  const recent = task('recent', [{ id: 'c', taskId: 'recent', startedAt: 3000, endedAt: 4000 }])
  assert.deepEqual(sortTasksByTrackedTime([old, recent], 30000, 0, 5000).map((entry) => entry.id), ['recent', 'old'])
  assert.deepEqual(sortTasksByTrackedTime([old, recent], 30000).map((entry) => entry.id), ['old', 'recent'])
})
