export type WebProject = { id: string; name: string; color: string; archived: boolean }
export type WebInterval = { id: string; startedAt: number; endedAt: number | null }
export type WebTask = { id: string; title: string; projectId: string | null; notes: string; status: 'running' | 'paused' | 'stopped'; intervals: WebInterval[] }
export type WebRest = { id: string; type: 'lunch' | 'break'; status: 'running' | 'paused' | 'completed'; plannedMinutes: number; intervals: WebInterval[] }
export type WebWorkday = { id: string; startedAt: number; endedAt: number | null }

export type WebWorkspace = {
  projects: WebProject[]
  tasks: WebTask[]
  rests: WebRest[]
  workdays: WebWorkday[]
  exportedAt?: number
}

export type WorkBuddyCommand =
  | { command: 'pause-task'; taskId: string }
  | { command: 'resume-task'; taskId: string }
  | { command: 'start-rest'; restType: 'lunch' | 'break' }
  | { command: 'complete-rest'; restId: string }
  | { command: 'end-workday' }

export function activeWorkday(workspace: WebWorkspace): WebWorkday | undefined {
  return workspace.workdays.find((day) => day.endedAt === null)
}

export function taskElapsed(task: WebTask, now = Date.now()): number {
  return task.intervals.reduce((total, interval) => total + Math.max(0, (interval.endedAt ?? now) - interval.startedAt), 0)
}

export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((item) => String(item).padStart(2, '0')).join(':')
}
