import assert from 'node:assert/strict'
import test from 'node:test'
import { suggestTaskMerges } from '../src/shared/task-merge-suggestions.ts'
import type { Task } from '../src/shared/types.ts'

function task(id: string, projectId: string | null, status: Task['status'] = 'stopped'): Task {
  return { id, projectId, status, title: id, notes: '', tags: [], plannedTaskId: null, createdAt: 0, updatedAt: 0, intervals: [] }
}

test('suggests only multiple tasks with the same assigned project', () => {
  const tasks = [task('a', 'one'), task('b', 'two'), task('c', 'one'), task('d', null), task('e', null)]
  assert.deepEqual(suggestTaskMerges(tasks).map((group) => [group.projectId, group.tasks.map((item) => item.id)]), [['one', ['a', 'c']]])
  assert.deepEqual(suggestTaskMerges([]), [])
})

test('keeps the running task first without changing the source list', () => {
  const tasks = [task('a', 'one'), task('b', 'one', 'running'), task('c', 'one', 'paused')]
  const before = structuredClone(tasks)
  assert.deepEqual(suggestTaskMerges(tasks)[0].tasks.map((item) => item.id), ['b', 'a', 'c'])
  assert.deepEqual(tasks, before)
})

test('suggestions disappear once sources are removed after merging', () => {
  assert.deepEqual(suggestTaskMerges([task('a', 'one'), task('b', 'two')]), [])
})
