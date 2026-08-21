import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  AppSettings,
  AppSnapshot,
  HistoryDay,
  PlannedTask,
  PlannedTaskInput,
  Project,
  ProjectInput,
  ProjectUpdateInput,
  RestInterval,
  RestSession,
  RestType,
  StartMode,
  StartTaskInput,
  Task,
  TaskUpdateInput,
  TimeInterval,
  Workday
} from '../shared/types'

const DAY_MS = 24 * 60 * 60 * 1000

export const defaultSettings: AppSettings = {
  locale: 'uk',
  theme: 'dark',
  alwaysOnTop: true,
  autoStart: true,
  workday: {
    startReminder: true,
    startTime: '09:00',
    endReminder: true,
    endTime: '18:00'
  },
  breaks: {
    enabled: true,
    everyMinutes: 55,
    durationMinutes: 5
  },
  lunch: {
    enabled: true,
    mode: 'worked',
    time: '13:00',
    afterMinutes: 240,
    durationMinutes: 30,
    includedInWorkHours: false
  },
  idle: {
    enabled: true,
    thresholdMinutes: 10
  },
  notifications: {
    sound: 'soft',
    volume: 0.72,
    customSoundPath: '',
    customSoundName: ''
  },
  wellnessEnabled: true,
  projectColors: ['#b8e986', '#7bdff2', '#f7a072', '#cdb4db', '#f6d365', '#7ae7c7'],
  ai: {
    enabled: false,
    model: 'gemini-3.5-flash-lite',
    hasApiKey: false
  },
  googleCalendar: {
    clientId: '',
    calendarId: '',
    calendarName: '',
    hasConnection: false,
    syncOnDayEnd: true
  },
  wellnessActions: [
    { id: randomUUID(), labelUk: '10 разів віджатися', labelEn: 'Do 10 push-ups', enabled: true },
    { id: randomUUID(), labelUk: 'Розім’яти спину', labelEn: 'Stretch your back', enabled: true },
    { id: randomUUID(), labelUk: 'Випити води', labelEn: 'Drink some water', enabled: true }
  ]
}

type ProjectRow = { id: string; name: string; color: string; archived: number; created_at: number }
type TaskRow = {
  id: string
  title: string
  project_id: string | null
  planned_task_id: string | null
  notes: string
  tags_json: string
  status: Task['status']
  created_at: number
  updated_at: number
}
type PlannedTaskRow = { id: string; title: string; project_id: string | null; notes: string; created_at: number }
type IntervalRow = { id: string; task_id: string; started_at: number; ended_at: number | null }
type WorkdayRow = { id: string; started_at: number; ended_at: number | null }
type RestRow = {
  id: string
  type: RestType
  status: RestSession['status']
  planned_minutes: number
  created_at: number
  ended_at: number | null
  resume_task_ids_json: string
}
type RestIntervalRow = { id: string; rest_id: string; started_at: number; ended_at: number | null }

function localDayBounds(now = Date.now()): [number, number] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return [start.getTime(), start.getTime() + DAY_MS]
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateTimestamp(value: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('Invalid history date')
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0)
  if (localDateKey(date.getTime()) !== value) throw new Error('Invalid history date')
  return date.getTime()
}

function deepSettings(raw?: string): AppSettings {
  if (!raw) return structuredClone(defaultSettings)
  const stored = JSON.parse(raw) as Partial<AppSettings>
  return {
    ...structuredClone(defaultSettings),
    ...stored,
    workday: { ...defaultSettings.workday, ...stored.workday },
    breaks: { ...defaultSettings.breaks, ...stored.breaks },
    lunch: { ...defaultSettings.lunch, ...stored.lunch },
    idle: { ...defaultSettings.idle, ...stored.idle },
    notifications: { ...defaultSettings.notifications, ...stored.notifications },
    ai: { ...defaultSettings.ai, ...stored.ai },
    googleCalendar: { ...defaultSettings.googleCalendar, ...stored.googleCalendar },
    projectColors: stored.projectColors?.length ? stored.projectColors : [...defaultSettings.projectColors],
    wellnessActions: stored.wellnessActions ?? structuredClone(defaultSettings.wellnessActions)
  }
}

export class WorkBuddyDatabase {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS planned_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        planned_task_id TEXT REFERENCES planned_tasks(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('running', 'paused', 'stopped')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS time_intervals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workdays (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS rest_sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('lunch', 'break')),
        status TEXT NOT NULL CHECK(status IN ('running', 'paused', 'completed')),
        planned_minutes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        resume_task_ids_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS rest_intervals (
        id TEXT PRIMARY KEY,
        rest_id TEXT NOT NULL REFERENCES rest_sessions(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_intervals_task ON time_intervals(task_id);
      CREATE INDEX IF NOT EXISTS idx_intervals_start ON time_intervals(started_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);
      CREATE INDEX IF NOT EXISTS idx_planned_tasks_created ON planned_tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_rest_intervals_rest ON rest_intervals(rest_id);
      CREATE INDEX IF NOT EXISTS idx_rest_sessions_created ON rest_sessions(created_at);
    `)

    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    if (!taskColumns.some((column) => column.name === 'planned_task_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN planned_task_id TEXT REFERENCES planned_tasks(id) ON DELETE SET NULL')

    const settings = this.db.prepare('SELECT id FROM app_settings WHERE id = 1').get()
    if (!settings) {
      this.db.prepare('INSERT INTO app_settings (id, json) VALUES (1, ?)').run(JSON.stringify(defaultSettings))
    }
  }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT json FROM app_settings WHERE id = 1').get() as { json: string } | undefined
    const settings = deepSettings(row?.json)
    settings.ai.hasApiKey = this.hasSecret('gemini_api_key')
    settings.googleCalendar.hasConnection = this.hasSecret('google_calendar_tokens')
    return settings
  }

  getSecret(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM secrets WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setSecret(key: string, value: string): void {
    this.db.prepare('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  deleteSecret(key: string): void {
    this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key)
  }

  hasSecret(key: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM secrets WHERE key = ?').get(key))
  }

  updateSettings(settings: AppSettings): AppSnapshot {
    const safe = deepSettings(JSON.stringify(settings))
    this.db.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify(safe))
    return this.getSnapshot()
  }

  getSnapshot(): AppSnapshot {
    const [dayStart, dayEnd] = localDayBounds()
    const projects = (this.db.prepare('SELECT * FROM projects ORDER BY archived, created_at').all() as ProjectRow[]).map(
      (row): Project => ({
        id: row.id,
        name: row.name,
        color: row.color,
        archived: Boolean(row.archived),
        createdAt: row.created_at
      })
    )
    const plannedTasks = (this.db.prepare('SELECT * FROM planned_tasks ORDER BY created_at DESC').all() as PlannedTaskRow[]).map(
      (row): PlannedTask => ({ id: row.id, title: row.title, projectId: row.project_id, notes: row.notes, createdAt: row.created_at })
    )

    const taskRows = this.db
      .prepare(
        `SELECT DISTINCT t.* FROM tasks t
         LEFT JOIN time_intervals i ON i.task_id = t.id
         WHERE t.status IN ('running', 'paused') OR i.started_at BETWEEN ? AND ?
         ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, t.updated_at DESC`
      )
      .all(dayStart, dayEnd) as TaskRow[]

    const intervalStatement = this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at')
    const tasks = taskRows.map((row): Task => {
      const intervals = (intervalStatement.all(row.id) as IntervalRow[]).map(
        (item): TimeInterval => ({
          id: item.id,
          taskId: item.task_id,
          startedAt: item.started_at,
          endedAt: item.ended_at
        })
      )
      return {
        id: row.id,
        title: row.title,
        projectId: row.project_id,
        plannedTaskId: row.planned_task_id,
        notes: row.notes,
        tags: JSON.parse(row.tags_json) as string[],
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        intervals
      }
    })

    const workdayRow = this.db
      .prepare('SELECT * FROM workdays WHERE started_at BETWEEN ? AND ? ORDER BY started_at DESC LIMIT 1')
      .get(dayStart, dayEnd) as WorkdayRow | undefined

    const workday: Workday | null = workdayRow
      ? { id: workdayRow.id, startedAt: workdayRow.started_at, endedAt: workdayRow.ended_at }
      : null

    const restRows = this.db
      .prepare("SELECT * FROM rest_sessions WHERE created_at BETWEEN ? AND ? OR status IN ('running', 'paused') ORDER BY created_at")
      .all(dayStart, dayEnd) as RestRow[]
    const restIntervalStatement = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at')
    const rests = restRows.map((row): RestSession => ({
      id: row.id,
      type: row.type,
      status: row.status,
      plannedMinutes: row.planned_minutes,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      intervals: (restIntervalStatement.all(row.id) as RestIntervalRow[]).map((interval): RestInterval => ({
        id: interval.id,
        restId: interval.rest_id,
        startedAt: interval.started_at,
        endedAt: interval.ended_at
      }))
    }))

    return { projects, plannedTasks, tasks, workday, rests, settings: this.getSettings(), now: Date.now() }
  }

  getHistory(days = 182): HistoryDay[] {
    const safeDays = Math.min(730, Math.max(14, Math.round(days)))
    const [todayStart] = localDayBounds()
    const rangeStart = todayStart - (safeDays - 1) * DAY_MS
    const rangeEnd = todayStart + DAY_MS
    type DayBucket = HistoryDay & { ranges: Array<readonly [number, number]>; taskIds: Set<string>; projectIds: Set<string> }
    const buckets = new Map<string, DayBucket>()
    for (let index = 0; index < safeDays; index += 1) {
      const start = rangeStart + index * DAY_MS
      const key = localDateKey(start)
      buckets.set(key, { date: key, workedMs: 0, taskCount: 0, projectCount: 0, startedAt: null, endedAt: null, ranges: [], taskIds: new Set(), projectIds: new Set() })
    }

    const intervals = this.db.prepare(
      `SELECT i.started_at, i.ended_at, t.id AS task_id, t.project_id
       FROM time_intervals i JOIN tasks t ON t.id = i.task_id
       WHERE i.started_at < ? AND (i.ended_at IS NULL OR i.ended_at > ?)`
    ).all(rangeEnd, rangeStart) as Array<{ started_at: number; ended_at: number | null; task_id: string; project_id: string | null }>
    const now = Date.now()
    for (const interval of intervals) {
      const intervalEnd = Math.min(interval.ended_at ?? now, rangeEnd)
      for (let dayStart = Math.max(rangeStart, localDayBounds(interval.started_at)[0]); dayStart < intervalEnd; dayStart += DAY_MS) {
        const bucket = buckets.get(localDateKey(dayStart))
        if (!bucket) continue
        bucket.ranges.push([Math.max(interval.started_at, dayStart), Math.min(intervalEnd, dayStart + DAY_MS)])
        bucket.taskIds.add(interval.task_id)
        if (interval.project_id) bucket.projectIds.add(interval.project_id)
      }
    }

    const workdays = this.db.prepare('SELECT started_at, ended_at FROM workdays WHERE started_at < ? AND (ended_at IS NULL OR ended_at >= ?)').all(rangeEnd, rangeStart) as Array<{ started_at: number; ended_at: number | null }>
    for (const workday of workdays) {
      const bucket = buckets.get(localDateKey(Math.max(workday.started_at, rangeStart)))
      if (!bucket) continue
      bucket.startedAt = workday.started_at
      bucket.endedAt = workday.ended_at
    }

    return [...buckets.values()].map((bucket) => {
      const ranges = bucket.ranges.sort((a, b) => a[0] - b[0])
      let coverage = 0
      let start = ranges[0]?.[0]
      let end = ranges[0]?.[1]
      for (const [nextStart, nextEnd] of ranges.slice(1)) {
        if (start === undefined || end === undefined) break
        if (nextStart <= end) end = Math.max(end, nextEnd)
        else {
          coverage += end - start
          start = nextStart
          end = nextEnd
        }
      }
      if (start !== undefined && end !== undefined) coverage += end - start
      return { date: bucket.date, workedMs: coverage, taskCount: bucket.taskIds.size, projectCount: bucket.projectIds.size, startedAt: bucket.startedAt, endedAt: bucket.endedAt }
    })
  }

  getDaySnapshot(date: string): AppSnapshot {
    const [dayStart, dayEnd] = localDayBounds(localDateTimestamp(date))
    const projects = (this.db.prepare('SELECT * FROM projects ORDER BY archived, created_at').all() as ProjectRow[]).map(
      (row): Project => ({ id: row.id, name: row.name, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at })
    )
    const plannedTasks = (this.db.prepare('SELECT * FROM planned_tasks ORDER BY created_at DESC').all() as PlannedTaskRow[]).map(
      (row): PlannedTask => ({ id: row.id, title: row.title, projectId: row.project_id, notes: row.notes, createdAt: row.created_at })
    )
    const taskRows = this.db.prepare(
      `SELECT DISTINCT t.* FROM tasks t JOIN time_intervals i ON i.task_id = t.id
       WHERE i.started_at < ? AND (i.ended_at IS NULL OR i.ended_at > ?)
       ORDER BY t.updated_at DESC`
    ).all(dayEnd, dayStart) as TaskRow[]
    const intervalStatement = this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at')
    const tasks = taskRows.map((row): Task => ({
      id: row.id, title: row.title, projectId: row.project_id, plannedTaskId: row.planned_task_id, notes: row.notes, tags: JSON.parse(row.tags_json) as string[], status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      intervals: (intervalStatement.all(row.id) as IntervalRow[]).map((item): TimeInterval => ({ id: item.id, taskId: item.task_id, startedAt: item.started_at, endedAt: item.ended_at }))
    }))
    const workdayRow = this.db.prepare('SELECT * FROM workdays WHERE started_at < ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at DESC LIMIT 1').get(dayEnd, dayStart) as WorkdayRow | undefined
    const workday = workdayRow ? { id: workdayRow.id, startedAt: workdayRow.started_at, endedAt: workdayRow.ended_at } : null
    const restRows = this.db.prepare('SELECT * FROM rest_sessions WHERE created_at < ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY created_at').all(dayEnd, dayStart) as RestRow[]
    const restIntervalStatement = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at')
    const rests = restRows.map((row): RestSession => ({
      id: row.id, type: row.type, status: row.status, plannedMinutes: row.planned_minutes, createdAt: row.created_at, endedAt: row.ended_at,
      intervals: (restIntervalStatement.all(row.id) as RestIntervalRow[]).map((interval): RestInterval => ({ id: interval.id, restId: interval.rest_id, startedAt: interval.started_at, endedAt: interval.ended_at }))
    }))
    return { projects, plannedTasks, tasks, workday, rests, settings: this.getSettings(), now: Math.min(Date.now(), dayEnd - 1) }
  }

  getGoogleCalendarEvents(days = 182): Array<{ id: string; title: string; projectName: string; notes: string; tags: string[]; startedAt: number; endedAt: number }> {
    const safeDays = Math.min(730, Math.max(1, Math.round(days)))
    const start = Date.now() - safeDays * DAY_MS
    const rows = this.db.prepare(
      `SELECT i.id, i.started_at, i.ended_at, t.title, t.notes, t.tags_json, p.name AS project_name
       FROM time_intervals i
       JOIN tasks t ON t.id = i.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE i.ended_at IS NOT NULL AND i.ended_at > ?
       ORDER BY i.started_at`
    ).all(start) as Array<{ id: string; title: string; notes: string; tags_json: string; project_name: string | null; started_at: number; ended_at: number }>
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      projectName: row.project_name ?? '',
      notes: row.notes,
      tags: JSON.parse(row.tags_json) as string[],
      startedAt: row.started_at,
      endedAt: row.ended_at
    }))
  }

  startWorkday(): AppSnapshot {
    const current = this.getOpenWorkday()
    if (!current) {
      this.db.prepare('INSERT INTO workdays (id, started_at, ended_at) VALUES (?, ?, NULL)').run(randomUUID(), Date.now())
    }
    return this.getSnapshot()
  }

  endWorkday(): AppSnapshot {
    const now = Date.now()
    const transaction = (): void => this.transaction(() => {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE ended_at IS NULL').run(now)
      this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status = 'running'").run(now)
      this.db.prepare('UPDATE workdays SET ended_at = ? WHERE ended_at IS NULL').run(now)
      this.db.prepare('UPDATE rest_intervals SET ended_at = ? WHERE ended_at IS NULL').run(now)
      this.db.prepare("UPDATE rest_sessions SET status = 'completed', ended_at = ?, resume_task_ids_json = '[]' WHERE status IN ('running', 'paused')").run(now)
    })
    transaction()
    return this.getSnapshot()
  }

  startTask(input: StartTaskInput): AppSnapshot {
    const now = Date.now()
    if (this.getActiveRest()?.status === 'running') throw new Error('Pause the active break before starting a task')
    const transaction = (): void => this.transaction(() => {
      if (!this.getOpenWorkday()) {
        this.db.prepare('INSERT INTO workdays (id, started_at, ended_at) VALUES (?, ?, NULL)').run(randomUUID(), now)
      }
      if (input.mode === 'switch') this.pauseAll(now)

      const taskId = input.taskId ?? randomUUID()
      if (input.taskId) {
        const exists = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)
        if (!exists) throw new Error('Task not found')
        this.db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(now, taskId)
      } else {
        this.db
          .prepare(
            `INSERT INTO tasks (id, title, project_id, planned_task_id, notes, tags_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`
          )
          .run(taskId, input.title?.trim() ?? '', input.projectId ?? null, input.plannedTaskId ?? null, input.notes?.trim() ?? '', JSON.stringify(input.tags ?? []), now, now)
      }

      const open = this.db.prepare('SELECT id FROM time_intervals WHERE task_id = ? AND ended_at IS NULL').get(taskId)
      if (!open) {
        this.db.prepare('INSERT INTO time_intervals (id, task_id, started_at, ended_at) VALUES (?, ?, ?, NULL)').run(randomUUID(), taskId, now)
      }
    })
    transaction()
    return this.getSnapshot()
  }

  pauseTask(id: string): AppSnapshot {
    const now = Date.now()
    const transaction = (): void => this.transaction(() => {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(now, id)
      this.db.prepare("UPDATE tasks SET status = 'paused', updated_at = ? WHERE id = ? AND status != 'stopped'").run(now, id)
    })
    transaction()
    return this.getSnapshot()
  }

  resumeTask(id: string, mode: StartMode): AppSnapshot {
    return this.startTask({ taskId: id, mode })
  }

  stopTask(id: string): AppSnapshot {
    const now = Date.now()
    const transaction = (): void => this.transaction(() => {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(now, id)
      this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE id = ?").run(now, id)
    })
    transaction()
    return this.getSnapshot()
  }

  pauseAllTasks(): AppSnapshot {
    const now = Date.now()
    this.transaction(() => this.pauseAll(now))
    return this.getSnapshot()
  }

  stopAllTasks(): AppSnapshot {
    const now = Date.now()
    this.transaction(() => {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE ended_at IS NULL').run(now)
      this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status != 'stopped'").run(now)
    })
    return this.getSnapshot()
  }

  startRest(type: RestType): AppSnapshot {
    if (!this.getOpenWorkday()) throw new Error('Start the workday first')
    const active = this.getActiveRest()
    if (active) throw new Error('Another break is already active')
    const now = Date.now()
    const settings = this.getSettings()
    const plannedMinutes = type === 'lunch' ? settings.lunch.durationMinutes : settings.breaks.durationMinutes
    this.transaction(() => {
      const resumeTaskIds = this.getRunningTaskIds()
      this.pauseAll(now)
      const id = randomUUID()
      this.db.prepare("INSERT INTO rest_sessions (id, type, status, planned_minutes, created_at, ended_at, resume_task_ids_json) VALUES (?, ?, 'running', ?, ?, NULL, ?)")
        .run(id, type, plannedMinutes, now, JSON.stringify(resumeTaskIds))
      this.db.prepare('INSERT INTO rest_intervals (id, rest_id, started_at, ended_at) VALUES (?, ?, ?, NULL)')
        .run(randomUUID(), id, now)
    })
    return this.getSnapshot()
  }

  pauseRest(id: string): AppSnapshot {
    const now = Date.now()
    this.transaction(() => {
      const rest = this.getRest(id)
      if (!rest || rest.status !== 'running') throw new Error('Active break not found')
      this.db.prepare('UPDATE rest_intervals SET ended_at = ? WHERE rest_id = ? AND ended_at IS NULL').run(now, id)
      this.resumeTasks(JSON.parse(rest.resume_task_ids_json) as string[], now)
      this.db.prepare("UPDATE rest_sessions SET status = 'paused', resume_task_ids_json = '[]' WHERE id = ?").run(id)
    })
    return this.getSnapshot()
  }

  resumeRest(id: string): AppSnapshot {
    const now = Date.now()
    this.transaction(() => {
      const rest = this.getRest(id)
      if (!rest || rest.status !== 'paused') throw new Error('Paused break not found')
      const resumeTaskIds = this.getRunningTaskIds()
      this.pauseAll(now)
      this.db.prepare("UPDATE rest_sessions SET status = 'running', resume_task_ids_json = ? WHERE id = ?")
        .run(JSON.stringify(resumeTaskIds), id)
      this.db.prepare('INSERT INTO rest_intervals (id, rest_id, started_at, ended_at) VALUES (?, ?, ?, NULL)')
        .run(randomUUID(), id, now)
    })
    return this.getSnapshot()
  }

  completeRest(id: string): AppSnapshot {
    const now = Date.now()
    this.transaction(() => {
      const rest = this.getRest(id)
      if (!rest || rest.status === 'completed') throw new Error('Active break not found')
      this.db.prepare('UPDATE rest_intervals SET ended_at = ? WHERE rest_id = ? AND ended_at IS NULL').run(now, id)
      if (rest.status === 'running') this.resumeTasks(JSON.parse(rest.resume_task_ids_json) as string[], now)
      this.db.prepare("UPDATE rest_sessions SET status = 'completed', ended_at = ?, resume_task_ids_json = '[]' WHERE id = ?").run(now, id)
    })
    return this.getSnapshot()
  }

  skipRest(type: RestType): AppSnapshot {
    if (!this.getOpenWorkday()) throw new Error('Start the workday first')
    if (this.getActiveRest()) throw new Error('Finish the active break first')
    const now = Date.now()
    const [dayStart, dayEnd] = localDayBounds(now)
    const alreadySkipped = this.db.prepare('SELECT 1 FROM rest_sessions WHERE type = ? AND planned_minutes = 0 AND created_at BETWEEN ? AND ?').get(type, dayStart, dayEnd)
    if (!alreadySkipped) {
      this.db.prepare("INSERT INTO rest_sessions (id, type, status, planned_minutes, created_at, ended_at, resume_task_ids_json) VALUES (?, ?, 'completed', 0, ?, ?, '[]')")
        .run(randomUUID(), type, now, now)
    }
    return this.getSnapshot()
  }

  updateRestStart(id: string, startedAt: number): AppSnapshot {
    const interval = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at LIMIT 1').get(id) as RestIntervalRow | undefined
    if (!interval) throw new Error('Rest start was not found')
    this.validateAdjustedStart(startedAt, interval.started_at, interval.ended_at)
    this.db.prepare('UPDATE rest_intervals SET started_at = ? WHERE id = ?').run(Math.round(startedAt), interval.id)
    return this.getSnapshot()
  }

  updateTask(input: TaskUpdateInput): AppSnapshot {
    const current = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.id) as TaskRow | undefined
    if (!current) throw new Error('Task not found')
    const firstInterval = input.startedAt === undefined
      ? undefined
      : this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at LIMIT 1').get(input.id) as IntervalRow | undefined
    const finalInterval = input.endedAt === undefined
      ? undefined
      : this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at DESC LIMIT 1').get(input.id) as IntervalRow | undefined
    if (input.startedAt !== undefined) {
      if (!firstInterval) throw new Error('Task start was not found')
      const finalEnd = firstInterval.id === finalInterval?.id ? input.endedAt ?? firstInterval.ended_at : firstInterval.ended_at
      this.validateAdjustedStart(input.startedAt, firstInterval.started_at, finalEnd)
    }
    if (input.endedAt !== undefined) {
      if (!finalInterval || finalInterval.ended_at === null) throw new Error('Task end was not found')
      const firstStart = firstInterval?.id === finalInterval.id ? input.startedAt ?? finalInterval.started_at : finalInterval.started_at
      this.validateAdjustedEnd(input.endedAt, firstStart, finalInterval.ended_at)
    }
    this.db
      .prepare('UPDATE tasks SET title = ?, project_id = ?, planned_task_id = ?, notes = ?, tags_json = ?, updated_at = ? WHERE id = ?')
      .run(
        input.title?.trim() ?? current.title,
        input.projectId === undefined ? current.project_id : input.projectId,
        input.plannedTaskId === undefined ? current.planned_task_id : input.plannedTaskId,
        input.notes?.trim() ?? current.notes,
        JSON.stringify(input.tags ?? (JSON.parse(current.tags_json) as string[])),
        Date.now(),
        input.id
      )
    if (input.startedAt !== undefined && firstInterval) {
      this.db.prepare('UPDATE time_intervals SET started_at = ? WHERE id = ?').run(Math.round(input.startedAt), firstInterval.id)
    }
    if (input.endedAt !== undefined && finalInterval) {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE id = ?').run(Math.round(input.endedAt), finalInterval.id)
    }
    return this.getSnapshot()
  }

  deleteTask(id: string): AppSnapshot {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Task not found')
    return this.getSnapshot()
  }

  createPlannedTask(input: PlannedTaskInput): AppSnapshot {
    const title = input.title.trim()
    if (!title) throw new Error('Planned task name is required')
    this.db.prepare('INSERT INTO planned_tasks (id, title, project_id, notes, created_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(), title, input.projectId ?? null, input.notes?.trim() ?? '', Date.now()
    )
    return this.getSnapshot()
  }

  deletePlannedTask(id: string): AppSnapshot {
    const result = this.db.prepare('DELETE FROM planned_tasks WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Planned task not found')
    return this.getSnapshot()
  }

  createProject(input: ProjectInput): AppSnapshot {
    const name = input.name.trim()
    if (!name) throw new Error('Project name is required')
    this.db.prepare('INSERT INTO projects (id, name, color, archived, created_at) VALUES (?, ?, ?, 0, ?)').run(
      randomUUID(),
      name,
      input.color,
      Date.now()
    )
    return this.getSnapshot()
  }

  updateProject(input: ProjectUpdateInput): AppSnapshot {
    const name = input.name.trim()
    if (!name) throw new Error('Project name is required')
    const result = this.db.prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?').run(name, input.color, input.id)
    if (!result.changes) throw new Error('Project not found')
    return this.getSnapshot()
  }

  getWorkedCoverageToday(now = Date.now()): number {
    const [dayStart, dayEnd] = localDayBounds(now)
    const rows = this.db
      .prepare('SELECT started_at, ended_at FROM time_intervals WHERE started_at BETWEEN ? AND ? ORDER BY started_at')
      .all(dayStart, dayEnd) as Array<{ started_at: number; ended_at: number | null }>
    const ranges = rows.map((row) => [row.started_at, row.ended_at ?? now] as const).sort((a, b) => a[0] - b[0])
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

  private getOpenWorkday(): WorkdayRow | undefined {
    return this.db.prepare('SELECT * FROM workdays WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as WorkdayRow | undefined
  }

  private getRest(id: string): RestRow | undefined {
    return this.db.prepare('SELECT * FROM rest_sessions WHERE id = ?').get(id) as RestRow | undefined
  }

  private getActiveRest(): RestRow | undefined {
    return this.db.prepare("SELECT * FROM rest_sessions WHERE status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1").get() as RestRow | undefined
  }

  private getRunningTaskIds(): string[] {
    return (this.db.prepare("SELECT id FROM tasks WHERE status = 'running'").all() as Array<{ id: string }>).map((row) => row.id)
  }

  private resumeTasks(ids: string[], now: number): void {
    const update = this.db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'paused'")
    const hasOpen = this.db.prepare('SELECT 1 FROM time_intervals WHERE task_id = ? AND ended_at IS NULL')
    const addInterval = this.db.prepare('INSERT INTO time_intervals (id, task_id, started_at, ended_at) VALUES (?, ?, ?, NULL)')
    for (const id of ids) {
      const result = update.run(now, id)
      if (result.changes && !hasOpen.get(id)) addInterval.run(randomUUID(), id, now)
    }
  }

  private validateAdjustedStart(startedAt: number, originalStart: number, endedAt: number | null): void {
    if (!Number.isFinite(startedAt)) throw new Error('Invalid start time')
    const [dayStart, dayEnd] = localDayBounds(originalStart)
    const latest = endedAt ?? Date.now()
    if (startedAt < dayStart || startedAt >= dayEnd) throw new Error('Start time must stay on the same day')
    if (startedAt > latest) throw new Error('Start time cannot be after the interval end')
  }

  private validateAdjustedEnd(endedAt: number, startedAt: number, originalEnd: number): void {
    if (!Number.isFinite(endedAt)) throw new Error('Invalid end time')
    const [dayStart, dayEnd] = localDayBounds(originalEnd)
    if (endedAt < dayStart || endedAt >= dayEnd) throw new Error('End time must stay on the same day')
    if (endedAt < startedAt) throw new Error('End time cannot be before the interval start')
  }

  private pauseAll(now: number): void {
    this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE ended_at IS NULL').run(now)
    this.db.prepare("UPDATE tasks SET status = 'paused', updated_at = ? WHERE status = 'running'").run(now)
  }

  private transaction(callback: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      callback()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
