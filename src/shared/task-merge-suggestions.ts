import type { Task } from './types'

export interface TaskMergeSuggestion {
  projectId: string
  tasks: Task[]
}

/** Call with the tasks visible on the selected day. Never group unassigned tasks. */
export function suggestTaskMerges(tasks: Task[]): TaskMergeSuggestion[] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.projectId) continue
    const group = groups.get(task.projectId) ?? []
    group.push(task)
    groups.set(task.projectId, group)
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1).map(([projectId, group]) => ({
    projectId,
    // Keep the active task's context when possible, otherwise the first visible task.
    tasks: [...group.filter((task) => task.status === 'running'), ...group.filter((task) => task.status !== 'running')]
  }))
}
