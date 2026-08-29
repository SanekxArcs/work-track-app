import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  AppSettings,
  AppSnapshot,
  BackupData,
  BackupImportMode,
  BackupPreview,
  HistoryDay,
  OvertimeOverview,
  PlannedTask,
  PlannedTaskInput,
  PlannedTaskUpdateInput,
  Project,
  ProjectInput,
  ProjectUpdateInput,
  RestInterval,
  RestSession,
  RestType,
  StartMode,
  StartTaskInput,
  Task,
  TaskMergeInput,
  TaskUpdateInput,
  TimeInterval,
  Workday
} from '../shared/types'
import { workdayOvertimeMs } from '../shared/workday'
import { localDateKey, localDateTimestamp, localDayBounds, localDaysBefore } from '../shared/local-date'

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
  sanity: {
    projectId: '',
    dataset: '',
    apiVersion: '2026-08-21',
    hasToken: false,
    lastSyncedAt: null
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
  alarm_muted: number
  created_at: number
  ended_at: number | null
  resume_task_ids_json: string
}
type RestIntervalRow = { id: string; rest_id: string; started_at: number; ended_at: number | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalId(value: unknown): value is string | null {
  return value === null || isId(value)
}

function hasUniqueIds(items: unknown[]): boolean {
  const ids = items.map((item) => isRecord(item) ? item.id : undefined)
  return ids.every(isId) && new Set(ids).size === ids.length
}

function hasOverlappingIntervals(intervals: Array<{ startedAt: number; endedAt: number | null }>): boolean {
  const ranges = intervals
    .filter((interval) => (interval.endedAt ?? Number.POSITIVE_INFINITY) > interval.startedAt)
    .sort((first, second) => first.startedAt - second.startedAt)
  let latestEnd = Number.NEGATIVE_INFINITY
  for (const interval of ranges) {
    if (interval.startedAt < latestEnd) return true
    latestEnd = Math.max(latestEnd, interval.endedAt ?? Number.POSITIVE_INFINITY)
  }
  return false
}

function validIntervals(value: unknown, ownerId: string): boolean {
  if (!Array.isArray(value) || !hasUniqueIds(value)) return false
  if (!value.every((item) => isRecord(item) && isId(item.id) && (item.taskId === ownerId || item.restId === ownerId))) return false
  if (!value.every((item) => {
    if (!isRecord(item) || !isTimestamp(item.startedAt)) return false
    return item.endedAt === null || (isTimestamp(item.endedAt) && item.endedAt >= item.startedAt)
  })) return false
  return !hasOverlappingIntervals(value as Array<{ startedAt: number; endedAt: number | null }>)
}

function validateBackup(backup: BackupData): void {
  if (!isRecord(backup.settings)) throw new Error('The selected backup has invalid settings')
  if (!hasUniqueIds(backup.projects) || !backup.projects.every((item) => isId(item.name) && isId(item.color) && typeof item.archived === 'boolean' && isTimestamp(item.createdAt))) {
    throw new Error('The selected backup has invalid projects')
  }
  const projectIds = new Set(backup.projects.map((item) => item.id))
  if (!hasUniqueIds(backup.plannedTasks) || !backup.plannedTasks.every((item) => isId(item.title) && typeof item.notes === 'string' && isTimestamp(item.createdAt) && isOptionalId(item.projectId) && (item.projectId === null || projectIds.has(item.projectId)))) {
    throw new Error('The selected backup has invalid planned tasks')
  }
  const plannedTaskIds = new Set(backup.plannedTasks.map((item) => item.id))
  if (!hasUniqueIds(backup.tasks) || !backup.tasks.every((item) =>
    typeof item.title === 'string'
    && typeof item.notes === 'string'
    && Array.isArray(item.tags)
    && item.tags.every((tag) => typeof tag === 'string')
    && (item.status === 'running' || item.status === 'paused' || item.status === 'stopped')
    && isTimestamp(item.createdAt)
    && isTimestamp(item.updatedAt)
    && isOptionalId(item.projectId)
    && (item.projectId === null || projectIds.has(item.projectId))
    && isOptionalId(item.plannedTaskId)
    && (item.plannedTaskId === null || plannedTaskIds.has(item.plannedTaskId))
    && validIntervals(item.intervals, item.id)
  )) throw new Error('The selected backup has invalid tasks')
  const intervalIds = backup.tasks.flatMap((item) => item.intervals.map((interval) => interval.id))
  if (!hasUniqueIds(backup.workdays) || !backup.workdays.every((item) => isTimestamp(item.startedAt) && (item.endedAt === null || (isTimestamp(item.endedAt) && item.endedAt >= item.startedAt)))) {
    throw new Error('The selected backup has invalid workdays')
  }
  if (backup.workdays.filter((item) => item.endedAt === null).length > 1) throw new Error('The selected backup has more than one active workday')
  if (!hasUniqueIds(backup.rests) || !backup.rests.every((item) =>
    (item.type === 'lunch' || item.type === 'break')
    && (item.status === 'running' || item.status === 'paused' || item.status === 'completed')
    && Number.isFinite(item.plannedMinutes)
    && item.plannedMinutes >= 0
    && typeof item.alarmMuted === 'boolean'
    && isTimestamp(item.createdAt)
    && (item.endedAt === null || (isTimestamp(item.endedAt) && item.endedAt >= item.createdAt))
    && validIntervals(item.intervals, item.id)
  )) throw new Error('The selected backup has invalid rest sessions')
  intervalIds.push(...backup.rests.flatMap((item) => item.intervals.map((interval) => interval.id)))
  if (new Set(intervalIds).size !== intervalIds.length) throw new Error('The selected backup has duplicate interval IDs')
  if (backup.rests.filter((item) => item.status !== 'completed').length > 1) throw new Error('The selected backup has more than one active break')
  const hasOpenWorkday = backup.workdays.some((item) => item.endedAt === null)
  for (const task of backup.tasks) {
    const openIntervals = task.intervals.filter((interval) => interval.endedAt === null).length
    if ((task.status === 'running' && openIntervals !== 1) || (task.status !== 'running' && openIntervals !== 0)) {
      throw new Error('The selected backup has inconsistent task timer states')
    }
    if (task.status === 'running' && !hasOpenWorkday) throw new Error('The selected backup has an active task without an active workday')
  }
  for (const rest of backup.rests) {
    const openIntervals = rest.intervals.filter((interval) => interval.endedAt === null).length
    const isActive = rest.status !== 'completed'
    if ((rest.status === 'running' && openIntervals !== 1) || (rest.status !== 'running' && openIntervals !== 0) || (isActive !== (rest.endedAt === null))) {
      throw new Error('The selected backup has inconsistent break timer states')
    }
    if (isActive && !hasOpenWorkday) throw new Error('The selected backup has an active break without an active workday')
  }
  for (const date of backup.overtimeRedeemedDates ?? []) localDateTimestamp(date)
}

function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function positiveInteger(value: unknown, fallback: number, maximum = 24 * 60): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= maximum
    ? Math.round(value)
    : fallback
}

function unitNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function deepSettings(raw?: string): AppSettings {
  if (!raw) return structuredClone(defaultSettings)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return structuredClone(defaultSettings)
  }
  const stored = isRecord(parsed) ? parsed as Partial<AppSettings> : {}
  const storedWorkday: Record<string, unknown> = isRecord(stored.workday) ? stored.workday : {}
  const storedBreaks: Record<string, unknown> = isRecord(stored.breaks) ? stored.breaks : {}
  const storedLunch: Record<string, unknown> = isRecord(stored.lunch) ? stored.lunch : {}
  const storedIdle: Record<string, unknown> = isRecord(stored.idle) ? stored.idle : {}
  const storedNotifications: Record<string, unknown> = isRecord(stored.notifications) ? stored.notifications : {}
  const storedAi: Record<string, unknown> = isRecord(stored.ai) ? stored.ai : {}
  const storedGoogle: Record<string, unknown> = isRecord(stored.googleCalendar) ? stored.googleCalendar : {}
  const storedSanity: Record<string, unknown> = isRecord(stored.sanity) ? stored.sanity : {}
  const sounds = ['system', 'soft', 'bell', 'pop', 'custom'] as const
  const models = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] as const
  const colors = Array.isArray(stored.projectColors)
    ? stored.projectColors.filter((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).slice(0, 24)
    : []
  const wellnessActions = Array.isArray(stored.wellnessActions)
    ? stored.wellnessActions.filter((action): action is AppSettings['wellnessActions'][number] => isRecord(action)
      && isId(action.id) && typeof action.labelUk === 'string' && typeof action.labelEn === 'string' && typeof action.enabled === 'boolean').slice(0, 50)
    : []
  return {
    ...structuredClone(defaultSettings),
    ...stored,
    locale: stored.locale === 'en' ? 'en' : 'uk',
    theme: stored.theme === 'light' || stored.theme === 'system' ? stored.theme : 'dark',
    alwaysOnTop: typeof stored.alwaysOnTop === 'boolean' ? stored.alwaysOnTop : defaultSettings.alwaysOnTop,
    autoStart: typeof stored.autoStart === 'boolean' ? stored.autoStart : defaultSettings.autoStart,
    workday: {
      startReminder: typeof storedWorkday.startReminder === 'boolean' ? storedWorkday.startReminder : defaultSettings.workday.startReminder,
      startTime: isClockTime(storedWorkday.startTime) ? storedWorkday.startTime : defaultSettings.workday.startTime,
      endReminder: typeof storedWorkday.endReminder === 'boolean' ? storedWorkday.endReminder : defaultSettings.workday.endReminder,
      endTime: isClockTime(storedWorkday.endTime) ? storedWorkday.endTime : defaultSettings.workday.endTime
    },
    breaks: {
      enabled: typeof storedBreaks.enabled === 'boolean' ? storedBreaks.enabled : defaultSettings.breaks.enabled,
      everyMinutes: positiveInteger(storedBreaks.everyMinutes, defaultSettings.breaks.everyMinutes),
      durationMinutes: positiveInteger(storedBreaks.durationMinutes, defaultSettings.breaks.durationMinutes)
    },
    lunch: {
      enabled: typeof storedLunch.enabled === 'boolean' ? storedLunch.enabled : defaultSettings.lunch.enabled,
      mode: storedLunch.mode === 'clock' ? 'clock' : 'worked',
      time: isClockTime(storedLunch.time) ? storedLunch.time : defaultSettings.lunch.time,
      afterMinutes: positiveInteger(storedLunch.afterMinutes, defaultSettings.lunch.afterMinutes),
      durationMinutes: positiveInteger(storedLunch.durationMinutes, defaultSettings.lunch.durationMinutes),
      includedInWorkHours: typeof storedLunch.includedInWorkHours === 'boolean' ? storedLunch.includedInWorkHours : defaultSettings.lunch.includedInWorkHours
    },
    idle: { enabled: typeof storedIdle.enabled === 'boolean' ? storedIdle.enabled : defaultSettings.idle.enabled, thresholdMinutes: positiveInteger(storedIdle.thresholdMinutes, defaultSettings.idle.thresholdMinutes) },
    notifications: {
      sound: sounds.includes(storedNotifications.sound as AppSettings['notifications']['sound']) ? storedNotifications.sound as AppSettings['notifications']['sound'] : defaultSettings.notifications.sound,
      volume: unitNumber(storedNotifications.volume, defaultSettings.notifications.volume),
      customSoundPath: typeof storedNotifications.customSoundPath === 'string' ? storedNotifications.customSoundPath : '',
      customSoundName: typeof storedNotifications.customSoundName === 'string' ? storedNotifications.customSoundName : ''
    },
    wellnessEnabled: typeof stored.wellnessEnabled === 'boolean' ? stored.wellnessEnabled : defaultSettings.wellnessEnabled,
    projectColors: colors.length ? colors : [...defaultSettings.projectColors],
    wellnessActions: wellnessActions.length ? wellnessActions : structuredClone(defaultSettings.wellnessActions),
    ai: { enabled: typeof storedAi.enabled === 'boolean' ? storedAi.enabled : defaultSettings.ai.enabled, model: models.includes(storedAi.model as AppSettings['ai']['model']) ? storedAi.model as AppSettings['ai']['model'] : defaultSettings.ai.model, hasApiKey: typeof storedAi.hasApiKey === 'boolean' ? storedAi.hasApiKey : false },
    googleCalendar: { clientId: typeof storedGoogle.clientId === 'string' ? storedGoogle.clientId : '', calendarId: typeof storedGoogle.calendarId === 'string' ? storedGoogle.calendarId : '', calendarName: typeof storedGoogle.calendarName === 'string' ? storedGoogle.calendarName : '', hasConnection: typeof storedGoogle.hasConnection === 'boolean' ? storedGoogle.hasConnection : false, syncOnDayEnd: typeof storedGoogle.syncOnDayEnd === 'boolean' ? storedGoogle.syncOnDayEnd : defaultSettings.googleCalendar.syncOnDayEnd },
    sanity: { projectId: typeof storedSanity.projectId === 'string' ? storedSanity.projectId : '', dataset: typeof storedSanity.dataset === 'string' ? storedSanity.dataset : '', apiVersion: typeof storedSanity.apiVersion === 'string' ? storedSanity.apiVersion : defaultSettings.sanity.apiVersion, hasToken: typeof storedSanity.hasToken === 'boolean' ? storedSanity.hasToken : false, lastSyncedAt: isTimestamp(storedSanity.lastSyncedAt) ? storedSanity.lastSyncedAt : null }
  }
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
}

function icsTimestamp(value: number): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 limits each physical iCalendar line to 75 UTF-8 octets. */
function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line
  const parts: string[] = []
  let current = ''
  let width = 0
  for (const character of line) {
    const characterWidth = Buffer.byteLength(character, 'utf8')
    const maximum = parts.length ? 74 : 75
    if (current && width + characterWidth > maximum) {
      parts.push(current)
      current = character
      width = characterWidth
    } else {
      current += character
      width += characterWidth
    }
  }
  if (current) parts.push(current)
  return parts.map((part, index) => index === 0 ? part : ` ${part}`).join('\r\n')
}

export class WorkBuddyDatabase {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.db.close()
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
        alarm_muted INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS overtime_redemptions (
        date TEXT PRIMARY KEY,
        redeemed_at INTEGER NOT NULL
      );

      -- Web commands are eventually delivered by Sanity. Keep their ids locally so
      -- a retry after the command was already applied cannot create a duplicate task.
      CREATE TABLE IF NOT EXISTS processed_remote_commands (
        id TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL
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
    const restColumns = this.db.prepare('PRAGMA table_info(rest_sessions)').all() as Array<{ name: string }>
    if (!restColumns.some((column) => column.name === 'alarm_muted')) this.db.exec('ALTER TABLE rest_sessions ADD COLUMN alarm_muted INTEGER NOT NULL DEFAULT 0')

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
    settings.sanity.hasToken = this.hasSecret('sanity_api_token')
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
    // Opening the app on a new calendar day must not leave yesterday's live
    // task in Focus until the user presses another button.
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const [dayStart, dayEnd] = localDayBounds(now)
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
         WHERE t.status IN ('running', 'paused') OR (i.started_at < ? AND (i.ended_at IS NULL OR i.ended_at > ?))
         ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, t.updated_at DESC`
      )
      .all(dayEnd, dayStart) as TaskRow[]

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
      .prepare('SELECT * FROM workdays WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at DESC LIMIT 1')
      .get(dayEnd, dayStart) as WorkdayRow | undefined

    const workday: Workday | null = workdayRow
      ? { id: workdayRow.id, startedAt: workdayRow.started_at, endedAt: workdayRow.ended_at }
      : null

    // An overnight workday can begin before midnight. Its earlier breaks and
    // lunch still affect the current reminder cadence and planned finish.
    const activeWorkdayStartedAt = workday?.endedAt === null ? workday.startedAt : null
    const restRows = this.db
      .prepare("SELECT * FROM rest_sessions WHERE (created_at < ? AND (ended_at IS NULL OR ended_at > ?)) OR status IN ('running', 'paused') OR (? IS NOT NULL AND created_at >= ?) ORDER BY created_at")
      .all(dayEnd, dayStart, activeWorkdayStartedAt, activeWorkdayStartedAt) as RestRow[]
    const restIntervalStatement = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at')
    const rests = restRows.map((row): RestSession => ({
      id: row.id,
      type: row.type,
      status: row.status,
      plannedMinutes: row.planned_minutes,
      alarmMuted: Boolean(row.alarm_muted),
      createdAt: row.created_at,
      endedAt: row.ended_at,
      intervals: (restIntervalStatement.all(row.id) as RestIntervalRow[]).map((interval): RestInterval => ({
        id: interval.id,
        restId: interval.rest_id,
        startedAt: interval.started_at,
        endedAt: interval.ended_at
      }))
    }))

    return { projects, plannedTasks, tasks, workday, rests, settings: this.getSettings(), now }
  }

  getHistory(days = 182): HistoryDay[] {
    const safeDays = Math.min(730, Math.max(14, Math.round(days)))
    const [todayStart, rangeEnd] = localDayBounds()
    const rangeStart = localDaysBefore(todayStart, safeDays - 1)
    type DayBucket = HistoryDay & { ranges: Array<readonly [number, number]>; taskIds: Set<string>; projectIds: Set<string> }
    const buckets = new Map<string, DayBucket>()
    for (let start = rangeStart; start < rangeEnd; start = localDayBounds(start)[1]) {
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
      for (let dayStart = Math.max(rangeStart, localDayBounds(interval.started_at)[0]); dayStart < intervalEnd; dayStart = localDayBounds(dayStart)[1]) {
        const bucket = buckets.get(localDateKey(dayStart))
        if (!bucket) continue
        const [, dayEnd] = localDayBounds(dayStart)
        bucket.ranges.push([Math.max(interval.started_at, dayStart), Math.min(intervalEnd, dayEnd)])
        bucket.taskIds.add(interval.task_id)
        if (interval.project_id) bucket.projectIds.add(interval.project_id)
      }
    }

    const workdays = this.db.prepare('SELECT started_at, ended_at FROM workdays WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)').all(rangeEnd, rangeStart) as Array<{ started_at: number; ended_at: number | null }>
    for (const workday of workdays) {
      const workdayEnd = Math.min(workday.ended_at ?? now, rangeEnd)
      for (let dayStart = Math.max(rangeStart, localDayBounds(workday.started_at)[0]); dayStart < workdayEnd; dayStart = localDayBounds(dayStart)[1]) {
        const bucket = buckets.get(localDateKey(dayStart))
        if (!bucket) continue
        const [, dayEnd] = localDayBounds(dayStart)
        const startedAt = Math.max(workday.started_at, dayStart)
        const endedAt = Math.min(workdayEnd, dayEnd)
        bucket.startedAt = bucket.startedAt === null ? startedAt : Math.min(bucket.startedAt, startedAt)
        bucket.endedAt = bucket.endedAt === null ? endedAt : Math.max(bucket.endedAt, endedAt)
      }
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

  getOvertimeOverview(): OvertimeOverview {
    const settings = this.getSettings()
    const workdays = this.db.prepare('SELECT started_at, ended_at FROM workdays WHERE ended_at IS NOT NULL ORDER BY started_at DESC').all() as Array<{ started_at: number; ended_at: number }>
    const redemptions = new Set((this.db.prepare('SELECT date FROM overtime_redemptions').all() as Array<{ date: string }>).map((row) => row.date))
    const lunchSessions = this.db.prepare(
      `SELECT r.*, i.id AS interval_id, i.started_at AS interval_started_at, i.ended_at AS interval_ended_at
       FROM rest_sessions r JOIN rest_intervals i ON i.rest_id = r.id
       WHERE r.type = 'lunch' AND i.started_at < ? AND i.ended_at > ?`
    )
    const taskIntervals = this.db.prepare(
      'SELECT id, task_id, started_at, ended_at FROM time_intervals WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)'
    )
    const dailyOvertime = new Map<string, number>()
    for (const workday of workdays) {
      const rests = (lunchSessions.all(workday.ended_at, workday.started_at) as Array<RestRow & { interval_id: string; interval_started_at: number; interval_ended_at: number }>)
        .map((row): RestSession => ({
          id: row.id, type: 'lunch', status: row.status, plannedMinutes: row.planned_minutes, alarmMuted: Boolean(row.alarm_muted), createdAt: row.created_at, endedAt: row.ended_at,
          intervals: [{ id: row.interval_id, restId: row.id, startedAt: row.interval_started_at, endedAt: row.interval_ended_at }]
        }))
      const workedIntervals = (taskIntervals.all(workday.ended_at, workday.started_at) as IntervalRow[]).map((interval): TimeInterval => ({
        id: interval.id, taskId: interval.task_id, startedAt: interval.started_at, endedAt: interval.ended_at
      }))
      const overtime = workdayOvertimeMs(settings, { id: '', startedAt: workday.started_at, endedAt: workday.ended_at }, rests, workday.ended_at, workedIntervals)
      if (overtime > 0) {
        const date = localDateKey(workday.started_at)
        dailyOvertime.set(date, (dailyOvertime.get(date) ?? 0) + overtime)
      }
    }
    const days = [...dailyOvertime.entries()]
      .map(([date, overtimeMs]) => ({ date, overtimeMs, redeemed: redemptions.has(date) }))
      .sort((first, second) => second.date.localeCompare(first.date))
    return { balanceMs: days.reduce((total, day) => total + (day.redeemed ? 0 : day.overtimeMs), 0), days }
  }

  setOvertimeRedeemed(date: string, redeemed: boolean): OvertimeOverview {
    localDateTimestamp(date)
    const overview = this.getOvertimeOverview()
    if (!overview.days.some((day) => day.date === date)) throw new Error('This day has no overtime to redeem')
    if (redeemed) this.db.prepare('INSERT INTO overtime_redemptions (date, redeemed_at) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET redeemed_at = excluded.redeemed_at').run(date, Date.now())
    else this.db.prepare('DELETE FROM overtime_redemptions WHERE date = ?').run(date)
    return this.getOvertimeOverview()
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
    const workdayRow = this.db.prepare('SELECT * FROM workdays WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at DESC LIMIT 1').get(dayEnd, dayStart) as WorkdayRow | undefined
    const workday = workdayRow ? { id: workdayRow.id, startedAt: workdayRow.started_at, endedAt: workdayRow.ended_at } : null
    const restRows = this.db.prepare('SELECT * FROM rest_sessions WHERE created_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY created_at').all(dayEnd, dayStart) as RestRow[]
    const restIntervalStatement = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at')
    const rests = restRows.map((row): RestSession => ({
      id: row.id, type: row.type, status: row.status, plannedMinutes: row.planned_minutes, alarmMuted: Boolean(row.alarm_muted), createdAt: row.created_at, endedAt: row.ended_at,
      intervals: (restIntervalStatement.all(row.id) as RestIntervalRow[]).map((interval): RestInterval => ({ id: interval.id, restId: interval.rest_id, startedAt: interval.started_at, endedAt: interval.ended_at }))
    }))
    return { projects, plannedTasks, tasks, workday, rests, settings: this.getSettings(), now: Math.min(Date.now(), dayEnd - 1) }
  }

  exportBackup(): BackupData {
    // Startup sync and manual backups must never publish yesterday's stale
    // active timers before the renderer has had a chance to request a snapshot.
    this.normalizeStaleWorkday(Date.now())
    const settings = this.getSettings()
    const { ai: _ai, googleCalendar: _googleCalendar, sanity: _sanity, ...backupSettings } = settings
    const projects = (this.db.prepare('SELECT * FROM projects ORDER BY created_at').all() as ProjectRow[]).map((row): Project => ({
      id: row.id, name: row.name, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at
    }))
    const plannedTasks = (this.db.prepare('SELECT * FROM planned_tasks ORDER BY created_at').all() as PlannedTaskRow[]).map((row): PlannedTask => ({
      id: row.id, title: row.title, projectId: row.project_id, notes: row.notes, createdAt: row.created_at
    }))
    const intervalStatement = this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at')
    const tasks = (this.db.prepare('SELECT * FROM tasks ORDER BY created_at').all() as TaskRow[]).map((row): Task => ({
      id: row.id,
      title: row.title,
      projectId: row.project_id,
      plannedTaskId: row.planned_task_id,
      notes: row.notes,
      tags: JSON.parse(row.tags_json) as string[],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      intervals: (intervalStatement.all(row.id) as IntervalRow[]).map((interval): TimeInterval => ({
        id: interval.id, taskId: interval.task_id, startedAt: interval.started_at, endedAt: interval.ended_at
      }))
    }))
    const workdays = (this.db.prepare('SELECT * FROM workdays ORDER BY started_at').all() as WorkdayRow[]).map((row): Workday => ({
      id: row.id, startedAt: row.started_at, endedAt: row.ended_at
    }))
    const restIntervals = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at')
    const rests = (this.db.prepare('SELECT * FROM rest_sessions ORDER BY created_at').all() as RestRow[]).map((row): RestSession => ({
      id: row.id,
      type: row.type,
      status: row.status,
      plannedMinutes: row.planned_minutes,
      alarmMuted: Boolean(row.alarm_muted),
      createdAt: row.created_at,
      endedAt: row.ended_at,
      intervals: (restIntervals.all(row.id) as RestIntervalRow[]).map((interval): RestInterval => ({
        id: interval.id, restId: interval.rest_id, startedAt: interval.started_at, endedAt: interval.ended_at
      }))
    }))
    const overtimeRedeemedDates = (this.db.prepare('SELECT date FROM overtime_redemptions ORDER BY date').all() as Array<{ date: string }>).map((row) => row.date)
    return { schemaVersion: 1, exportedAt: Date.now(), settings: backupSettings, projects, plannedTasks, tasks, workdays, rests, overtimeRedeemedDates }
  }

  parseBackup(raw: string): BackupData {
    let backup: unknown
    try {
      backup = JSON.parse(raw)
    } catch {
      throw new Error('The selected file is not valid JSON')
    }
    if (!backup || typeof backup !== 'object') throw new Error('The selected file is not a Work Buddy backup')
    const candidate = backup as Partial<BackupData>
    if (candidate.schemaVersion !== 1 || !Number.isFinite(candidate.exportedAt) || !candidate.settings || typeof candidate.settings !== 'object') {
      throw new Error('The selected file is not a compatible Work Buddy backup')
    }
    const collections = [candidate.projects, candidate.plannedTasks, candidate.tasks, candidate.workdays, candidate.rests]
    if (!collections.every(Array.isArray)) throw new Error('The selected backup is incomplete')
    const rawRests = candidate.rests as unknown[]
    const normalized = {
      ...candidate,
      rests: rawRests.map((item) => isRecord(item) && typeof item.alarmMuted !== 'boolean' ? { ...item, alarmMuted: false } : item),
      overtimeRedeemedDates: Array.isArray(candidate.overtimeRedeemedDates) ? candidate.overtimeRedeemedDates.filter((date): date is string => typeof date === 'string') : []
    } as BackupData
    validateBackup(normalized)
    return normalized
  }

  getBackupPreview(backup: BackupData): BackupPreview {
    return {
      exportedAt: backup.exportedAt,
      projectCount: backup.projects.length,
      plannedTaskCount: backup.plannedTasks.length,
      taskCount: backup.tasks.length,
      intervalCount: backup.tasks.reduce((count, task) => count + task.intervals.length, 0),
      workdayCount: backup.workdays.length,
      restCount: backup.rests.length
    }
  }

  importBackup(backup: BackupData, mode: BackupImportMode): AppSnapshot {
    if (mode !== 'merge' && mode !== 'replace') throw new Error('Invalid import mode')
    const existingSettings = this.getSettings()
    if (mode === 'merge') {
      const localOpenWorkdays = new Set((this.db.prepare('SELECT id FROM workdays WHERE ended_at IS NULL').all() as Array<{ id: string }>).map((workday) => workday.id))
      const localActiveRests = new Set((this.db.prepare("SELECT id FROM rest_sessions WHERE status IN ('running', 'paused')").all() as Array<{ id: string }>).map((rest) => rest.id))
      const importedOpenWorkdays = backup.workdays.filter((workday) => workday.endedAt === null && !localOpenWorkdays.has(workday.id))
      const importedActiveRests = backup.rests.filter((rest) => rest.status !== 'completed' && !localActiveRests.has(rest.id))
      if (localOpenWorkdays.size + importedOpenWorkdays.length > 1) {
        throw new Error('Finish the active workday before merging a backup with an active workday')
      }
      if (localActiveRests.size + importedActiveRests.length > 1) {
        throw new Error('Finish the active break before merging a backup with an active break')
      }
    }
    this.transaction(() => {
      if (mode === 'replace') {
        this.db.exec('DELETE FROM rest_intervals; DELETE FROM time_intervals; DELETE FROM rest_sessions; DELETE FROM tasks; DELETE FROM planned_tasks; DELETE FROM workdays; DELETE FROM projects; DELETE FROM overtime_redemptions;')
      }
      const project = this.db.prepare(`INSERT INTO projects (id, name, color, archived, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, archived = excluded.archived, created_at = excluded.created_at`)
      const plannedTask = this.db.prepare(`INSERT INTO planned_tasks (id, title, project_id, notes, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, project_id = excluded.project_id, notes = excluded.notes, created_at = excluded.created_at`)
      const task = this.db.prepare(`INSERT INTO tasks (id, title, project_id, planned_task_id, notes, tags_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, project_id = excluded.project_id, planned_task_id = excluded.planned_task_id, notes = excluded.notes, tags_json = excluded.tags_json, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at`)
      const interval = this.db.prepare(`INSERT INTO time_intervals (id, task_id, started_at, ended_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, started_at = excluded.started_at, ended_at = excluded.ended_at`)
      const workday = this.db.prepare(`INSERT INTO workdays (id, started_at, ended_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, ended_at = excluded.ended_at`)
      const rest = this.db.prepare(`INSERT INTO rest_sessions (id, type, status, planned_minutes, alarm_muted, created_at, ended_at, resume_task_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, '[]')
        ON CONFLICT(id) DO UPDATE SET type = excluded.type, status = excluded.status, planned_minutes = excluded.planned_minutes, alarm_muted = excluded.alarm_muted, created_at = excluded.created_at, ended_at = excluded.ended_at, resume_task_ids_json = '[]'`)
      const restInterval = this.db.prepare(`INSERT INTO rest_intervals (id, rest_id, started_at, ended_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET rest_id = excluded.rest_id, started_at = excluded.started_at, ended_at = excluded.ended_at`)
      const overtimeRedemption = this.db.prepare('INSERT INTO overtime_redemptions (date, redeemed_at) VALUES (?, ?) ON CONFLICT(date) DO NOTHING')

      for (const item of backup.projects) project.run(item.id, item.name, item.color, Number(item.archived), item.createdAt)
      for (const item of backup.plannedTasks) plannedTask.run(item.id, item.title, item.projectId, item.notes, item.createdAt)
      for (const item of backup.tasks) {
        task.run(item.id, item.title, item.projectId, item.plannedTaskId, item.notes, JSON.stringify(item.tags), item.status, item.createdAt, item.updatedAt)
        for (const itemInterval of item.intervals) interval.run(itemInterval.id, item.id, itemInterval.startedAt, itemInterval.endedAt)
      }
      for (const item of backup.workdays) workday.run(item.id, item.startedAt, item.endedAt)
      for (const item of backup.rests) {
        rest.run(item.id, item.type, item.status, item.plannedMinutes, Number(item.alarmMuted ?? false), item.createdAt, item.endedAt)
        for (const itemInterval of item.intervals) restInterval.run(itemInterval.id, item.id, itemInterval.startedAt, itemInterval.endedAt)
      }
      for (const date of backup.overtimeRedeemedDates ?? []) overtimeRedemption.run(date, Date.now())
      if (mode === 'replace') {
        const restoredSettings = deepSettings(JSON.stringify({ ...backup.settings, ai: existingSettings.ai, googleCalendar: existingSettings.googleCalendar, sanity: existingSettings.sanity }))
        this.db.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify(restoredSettings))
      }
    })
    return this.getSnapshot()
  }

  createDayCalendarIcs(date: string): string {
    const [dayStart, dayEnd] = localDayBounds(localDateTimestamp(date))
    const now = Date.now()
    const rows = this.db.prepare(
      `SELECT i.id, i.started_at, i.ended_at, t.title, t.notes, p.name AS project_name
       FROM time_intervals i
       JOIN tasks t ON t.id = i.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE i.started_at < ? AND (i.ended_at IS NULL OR i.ended_at > ?)
       ORDER BY i.started_at`
    ).all(dayEnd, dayStart) as Array<{ id: string; started_at: number; ended_at: number | null; title: string; notes: string; project_name: string | null }>
    const taskEvents = rows.flatMap((row) => {
      const startedAt = Math.max(row.started_at, dayStart)
      const endedAt = Math.min(row.ended_at ?? now, dayEnd)
      if (endedAt <= startedAt) return []
      const title = row.notes.trim() || row.title.trim() || 'Work Buddy task'
      const summary = row.project_name ? `${row.project_name} · ${title}` : title
      const details = row.notes.trim()
      return [
        'BEGIN:VEVENT',
        `UID:work-buddy-${row.id}@local`,
        `DTSTAMP:${icsTimestamp(now)}`,
        `DTSTART:${icsTimestamp(startedAt)}`,
        `DTEND:${icsTimestamp(endedAt)}`,
        `SUMMARY:${icsEscape(summary)}`,
        ...(details ? [`DESCRIPTION:${icsEscape(details)}`] : []),
        'END:VEVENT'
      ]
    })
    const restRows = this.db.prepare(
      `SELECT i.id, i.started_at, i.ended_at, s.type
       FROM rest_intervals i
       JOIN rest_sessions s ON s.id = i.rest_id
       WHERE i.started_at < ? AND (i.ended_at IS NULL OR i.ended_at > ?)
       ORDER BY i.started_at`
    ).all(dayEnd, dayStart) as Array<{ id: string; started_at: number; ended_at: number | null; type: RestType }>
    const restEvents = restRows.flatMap((row) => {
      const startedAt = Math.max(row.started_at, dayStart)
      const endedAt = Math.min(row.ended_at ?? now, dayEnd)
      if (endedAt <= startedAt) return []
      const title = row.type === 'lunch' ? 'Lunch · Work Buddy' : 'Break · Work Buddy'
      return [
        'BEGIN:VEVENT',
        `UID:work-buddy-rest-${row.id}@local`,
        `DTSTAMP:${icsTimestamp(now)}`,
        `DTSTART:${icsTimestamp(startedAt)}`,
        `DTEND:${icsTimestamp(endedAt)}`,
        `SUMMARY:${icsEscape(title)}`,
        `DESCRIPTION:${icsEscape(row.type === 'lunch' ? 'Tracked lunch in Work Buddy' : 'Tracked break in Work Buddy')}`,
        'END:VEVENT'
      ]
    })
    const events = [...taskEvents, ...restEvents]
    if (!events.length) throw new Error('There is no tracked work to export for this day')
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Work Buddy//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR', ''].map(foldIcsLine).join('\r\n')
  }

  getGoogleCalendarEvents(days = 182): Array<{ id: string; title: string; projectName: string; notes: string; tags: string[]; startedAt: number; endedAt: number }> {
    const safeDays = Math.min(730, Math.max(1, Math.round(days)))
    const start = localDaysBefore(Date.now(), safeDays)
    const rows = this.db.prepare(
      `SELECT i.id, i.started_at, i.ended_at, t.title, t.notes, p.name AS project_name
       FROM time_intervals i
       JOIN tasks t ON t.id = i.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE i.ended_at IS NOT NULL AND i.ended_at > ?
       ORDER BY i.started_at`
    ).all(start) as Array<{ id: string; title: string; notes: string; project_name: string | null; started_at: number; ended_at: number }>
    const taskEvents = rows.map((row) => ({
      id: row.id,
      title: row.notes.trim() || row.title.trim() || 'Work Buddy task',
      projectName: row.project_name ?? '',
      notes: row.notes,
      tags: [] as string[],
      startedAt: row.started_at,
      endedAt: row.ended_at
    }))
    const restRows = this.db.prepare(
      `SELECT i.id, i.started_at, i.ended_at, s.type
       FROM rest_intervals i
       JOIN rest_sessions s ON s.id = i.rest_id
       WHERE i.ended_at IS NOT NULL AND i.ended_at > ?
       ORDER BY i.started_at`
    ).all(start) as Array<{ id: string; started_at: number; ended_at: number; type: RestType }>
    const restEvents = restRows.map((row) => ({
      id: `rest-${row.id}`,
      title: row.type === 'lunch' ? 'Lunch' : 'Break',
      projectName: '',
      notes: row.type === 'lunch' ? 'Tracked lunch in Work Buddy' : 'Tracked break in Work Buddy',
      tags: [] as string[],
      startedAt: row.started_at,
      endedAt: row.ended_at
    }))
    return [...taskEvents, ...restEvents].sort((a, b) => a.startedAt - b.startedAt)
  }

  startWorkday(): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const current = this.getOpenWorkday()
    if (!current) {
      this.db.prepare('INSERT INTO workdays (id, started_at, ended_at) VALUES (?, ?, NULL)').run(randomUUID(), now)
    }
    return this.getSnapshot()
  }

  endWorkday(expectedWorkdayId?: string): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    if (expectedWorkdayId && this.getOpenWorkday()?.id !== expectedWorkdayId) {
      throw new Error('This workday is no longer active')
    }
    const transaction = (): void => this.transaction(() => {
      this.finishOpenWorkday(now)
    })
    transaction()
    return this.getSnapshot()
  }

  startTask(input: StartTaskInput): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
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
    this.normalizeStaleWorkday(now)
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
    this.normalizeStaleWorkday(now)
    const transaction = (): void => this.transaction(() => {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(now, id)
      this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE id = ?").run(now, id)
    })
    transaction()
    return this.getSnapshot()
  }

  pauseAllTasks(): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    this.transaction(() => this.pauseAll(now))
    return this.getSnapshot()
  }

  stopAllTasks(): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    this.transaction(() => {
      this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE ended_at IS NULL').run(now)
      this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status != 'stopped'").run(now)
    })
    return this.getSnapshot()
  }

  startRest(type: RestType): AppSnapshot {
    this.normalizeStaleWorkday(Date.now())
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
    this.normalizeStaleWorkday(now)
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
    this.normalizeStaleWorkday(now)
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
    this.normalizeStaleWorkday(now)
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
    this.normalizeStaleWorkday(Date.now())
    if (!this.getOpenWorkday()) throw new Error('Start the workday first')
    if (this.getActiveRest()) throw new Error('Finish the active break first')
    const now = Date.now()
    const [dayStart, dayEnd] = localDayBounds(now)
    const alreadySkipped = this.db.prepare('SELECT 1 FROM rest_sessions WHERE type = ? AND planned_minutes = 0 AND created_at >= ? AND created_at < ?').get(type, dayStart, dayEnd)
    if (!alreadySkipped) {
      this.db.prepare("INSERT INTO rest_sessions (id, type, status, planned_minutes, created_at, ended_at, resume_task_ids_json) VALUES (?, ?, 'completed', 0, ?, ?, '[]')")
        .run(randomUUID(), type, now, now)
    }
    return this.getSnapshot()
  }

  updateRestStart(id: string, startedAt: number): AppSnapshot {
    this.normalizeStaleWorkday(Date.now())
    const interval = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at LIMIT 1').get(id) as RestIntervalRow | undefined
    if (!interval) throw new Error('Rest start was not found')
    this.validateAdjustedStart(startedAt, interval.started_at, interval.ended_at)
    this.db.prepare('UPDATE rest_intervals SET started_at = ? WHERE id = ?').run(Math.round(startedAt), interval.id)
    return this.getSnapshot()
  }

  setRestAlarmMuted(id: string, muted: boolean): AppSnapshot {
    this.normalizeStaleWorkday(Date.now())
    const result = this.db.prepare("UPDATE rest_sessions SET alarm_muted = ? WHERE id = ? AND status != 'completed'").run(Number(muted), id)
    if (!result.changes) throw new Error('Active break not found')
    return this.getSnapshot()
  }

  updateTask(input: TaskUpdateInput): AppSnapshot {
    this.normalizeStaleWorkday(Date.now())
    const current = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.id) as TaskRow | undefined
    if (!current) throw new Error('Task not found')
    const selectedInterval = input.intervalId === undefined
      ? undefined
      : this.db.prepare('SELECT * FROM time_intervals WHERE id = ? AND task_id = ?').get(input.intervalId, input.id) as IntervalRow | undefined
    if (input.intervalId !== undefined && !selectedInterval) throw new Error('Task interval not found')
    const firstInterval = input.startedAt === undefined
      ? undefined
      : selectedInterval ?? this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at LIMIT 1').get(input.id) as IntervalRow | undefined
    const finalInterval = input.endedAt === undefined
      ? undefined
      : selectedInterval ?? this.db.prepare('SELECT * FROM time_intervals WHERE task_id = ? ORDER BY started_at DESC LIMIT 1').get(input.id) as IntervalRow | undefined
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
    if (input.startedAt !== undefined || input.endedAt !== undefined) {
      const intervals = (this.db.prepare('SELECT id, started_at, ended_at FROM time_intervals WHERE task_id = ?').all(input.id) as IntervalRow[])
        .map((interval) => ({
          startedAt: interval.id === firstInterval?.id && input.startedAt !== undefined ? input.startedAt : interval.started_at,
          endedAt: interval.id === finalInterval?.id && input.endedAt !== undefined ? input.endedAt : interval.ended_at
        }))
      if (hasOverlappingIntervals(intervals)) throw new Error('Task intervals cannot overlap')
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

  mergeTasks(input: TaskMergeInput): AppSnapshot {
    const sourceIds = [...new Set(input.sourceIds)].filter((id) => id !== input.targetId)
    if (!input.targetId || !sourceIds.length) throw new Error('Choose at least two tasks to merge')
    const reference = localDateTimestamp(input.date)
    const [dayStart, dayEnd] = localDayBounds(reference)
    const taskIds = [input.targetId, ...sourceIds]
    const placeholders = taskIds.map(() => '?').join(', ')
    const tasks = this.db.prepare(`SELECT id, status FROM tasks WHERE id IN (${placeholders})`).all(...taskIds) as Array<{ id: string; status: Task['status'] }>
    if (tasks.length !== taskIds.length) throw new Error('One of the selected tasks was not found')
    if (tasks.some((task) => task.status !== 'stopped')) throw new Error('Finish the workday before merging tasks')
    const ranges = (this.db.prepare(
      `SELECT started_at, ended_at FROM time_intervals
       WHERE task_id IN (${placeholders}) AND started_at < ? AND ended_at > ?`
    ).all(...taskIds, dayEnd, dayStart) as Array<{ started_at: number; ended_at: number }>).map((interval) => ({
      startedAt: Math.max(interval.started_at, dayStart),
      endedAt: Math.min(interval.ended_at, dayEnd)
    }))
    if (hasOverlappingIntervals(ranges)) throw new Error('Tasks with overlapping time cannot be merged')

    this.transaction(() => {
      const overlappingIntervals = this.db.prepare(
        'SELECT id, task_id, started_at, ended_at FROM time_intervals WHERE task_id = ? AND started_at < ? AND ended_at > ? ORDER BY started_at'
      )
      const moveInterval = this.db.prepare('UPDATE time_intervals SET task_id = ?, started_at = ?, ended_at = ? WHERE id = ?')
      const addInterval = this.db.prepare('INSERT INTO time_intervals (id, task_id, started_at, ended_at) VALUES (?, ?, ?, ?)')
      const countIntervals = this.db.prepare('SELECT COUNT(*) AS count FROM time_intervals WHERE task_id = ?')
      const removeTask = this.db.prepare('DELETE FROM tasks WHERE id = ?')
      for (const sourceId of sourceIds) {
        const intervals = overlappingIntervals.all(sourceId, dayEnd, dayStart) as IntervalRow[]
        for (const interval of intervals) {
          // A Day merge must only affect the selected calendar date. Split a
          // cross-midnight interval around that date instead of moving all of
          // its history to the target task.
          const movedStart = Math.max(interval.started_at, dayStart)
          const movedEnd = Math.min(interval.ended_at as number, dayEnd)
          if (interval.started_at < movedStart) {
            addInterval.run(randomUUID(), sourceId, interval.started_at, movedStart)
          }
          if ((interval.ended_at as number) > movedEnd) {
            addInterval.run(randomUUID(), sourceId, movedEnd, interval.ended_at)
          }
          moveInterval.run(input.targetId, movedStart, movedEnd, interval.id)
        }
        const remaining = countIntervals.get(sourceId) as { count: number }
        if (!remaining.count) removeTask.run(sourceId)
      }
      this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), input.targetId)
    })
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

  updatePlannedTask(input: PlannedTaskUpdateInput): AppSnapshot {
    const title = input.title.trim()
    if (!title) throw new Error('Planned task name is required')
    const result = this.db.prepare('UPDATE planned_tasks SET title = ?, project_id = ?, notes = ? WHERE id = ?').run(
      title, input.projectId ?? null, input.notes?.trim() ?? '', input.id
    )
    if (!result.changes) throw new Error('Planned task not found')
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
    if (this.projectNameExists(name)) throw new Error('A project with this name already exists')
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
    if (this.projectNameExists(name, input.id)) throw new Error('A project with this name already exists')
    const result = this.db.prepare('UPDATE projects SET name = ?, color = ?, archived = COALESCE(?, archived) WHERE id = ?').run(
      name,
      input.color,
      input.archived === undefined ? null : Number(input.archived),
      input.id
    )
    if (!result.changes) throw new Error('Project not found')
    return this.getSnapshot()
  }

  getWorkedCoverageToday(now = Date.now()): number {
    const [dayStart, dayEnd] = localDayBounds(now)
    const rows = this.db
      .prepare('SELECT started_at, ended_at FROM time_intervals WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at')
      .all(dayEnd, dayStart) as Array<{ started_at: number; ended_at: number | null }>
    const ranges = rows
      .map((row) => [Math.max(row.started_at, dayStart), Math.min(row.ended_at ?? now, now, dayEnd)] as const)
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

  private getOpenWorkday(): WorkdayRow | undefined {
    return this.db.prepare('SELECT * FROM workdays WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get() as WorkdayRow | undefined
  }

  hasProcessedRemoteCommand(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM processed_remote_commands WHERE id = ?').get(id))
  }

  markRemoteCommandProcessed(id: string): void {
    this.db.prepare('INSERT OR IGNORE INTO processed_remote_commands (id, processed_at) VALUES (?, ?)').run(id, Date.now())
  }

  private normalizeStaleWorkday(now: number): void {
    const current = this.getOpenWorkday()
    if (!current) return
    const [todayStart] = localDayBounds(now)
    if (current.started_at >= todayStart) return

    const settings = this.getSettings()
    const [startHours, startMinutes] = settings.workday.startTime.split(':').map(Number)
    const [endHours, endMinutes] = settings.workday.endTime.split(':').map(Number)
    const scheduleCrossesMidnight = (endHours || 0) * 60 + (endMinutes || 0) <= (startHours || 0) * 60 + (startMinutes || 0)
    const [previousDayStart] = localDayBounds(todayStart - 1)
    if (scheduleCrossesMidnight && current.started_at >= previousDayStart) return

    this.transaction(() => this.finishOpenWorkday(todayStart))
  }

  private finishOpenWorkday(endedAt: number): void {
    this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE ended_at IS NULL').run(endedAt)
    this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status != 'stopped'").run(endedAt)
    this.db.prepare('UPDATE workdays SET ended_at = ? WHERE ended_at IS NULL').run(endedAt)
    this.db.prepare('UPDATE rest_intervals SET ended_at = ? WHERE ended_at IS NULL').run(endedAt)
    this.db.prepare("UPDATE rest_sessions SET status = 'completed', ended_at = ?, resume_task_ids_json = '[]' WHERE status IN ('running', 'paused')").run(endedAt)
  }

  private projectNameExists(name: string, excludedId?: string): boolean {
    const normalized = name.normalize('NFKC').toLocaleLowerCase()
    const projects = this.db.prepare('SELECT id, name FROM projects').all() as Array<{ id: string; name: string }>
    return projects.some((project) => project.id !== excludedId && project.name.normalize('NFKC').toLocaleLowerCase() === normalized)
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
    if (endedAt > Date.now()) throw new Error('End time cannot be in the future')
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
