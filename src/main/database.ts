import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  AppSettings,
  AppSnapshot,
  BackupData,
  BackupImportMode,
  BackupPreview,
  HistoryDay,
  Locale,
  OvertimeOverview,
  PlannedTask,
  PlannedTaskInput,
  PlannedTaskUpdateInput,
  Project,
  ProjectInput,
  ProjectStats,
  ProjectStatus,
  ProjectTaskSummary,
  ProjectType,
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
import { scheduledWorkdayDurationMs, workdayOvertimeMs } from '../shared/workday'
import { localDateKey, localDateTimestamp, localDayBounds, localDaysBefore } from '../shared/local-date'

/** Built-in statuses follow the interface language until the user renames them. */
const builtInStatuses: Array<{ id: string; color: string; names: Record<Locale, string> }> = [
  { id: 'status-active', color: '#b8e986', names: { uk: 'Активний', en: 'Active' } },
  { id: 'status-on-hold', color: '#f6d365', names: { uk: 'На паузі', en: 'On hold' } },
  { id: 'status-review', color: '#7bdff2', names: { uk: 'На перевірці', en: 'In review' } }
]

function builtInStatusList(locale: Locale): ProjectStatus[] {
  return builtInStatuses.map(({ id, color, names }) => ({ id, name: names[locale], color }))
}

/**
 * On a language switch, renames a built-in status only if it still carries the previous
 * language's default name, so a deliberate rename (even to the other language's default) stays.
 */
function relocalizeStatus(status: ProjectStatus, previous: ProjectStatus | undefined, from: Locale, to: Locale): ProjectStatus {
  const names = builtInStatuses.find((builtIn) => builtIn.id === status.id)?.names
  if (!names || from === to || previous?.name !== status.name || status.name !== names[from]) return status
  return { ...status, name: names[to] }
}

export const defaultSettings: AppSettings = {
  locale: 'uk',
  theme: 'dark',
  alwaysOnTop: true,
  autoStart: true,
  globalShortcut: 'CommandOrControl+Shift+T',
  notchEnabled: false,
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
  projectTypes: [],
  projectStatuses: builtInStatusList('uk'),
  ai: {
    enabled: false,
    model: 'gemini-3.5-flash-lite',
    hasApiKey: false
  },
  wellnessActions: [
    { id: randomUUID(), labelUk: '10 разів віджатися', labelEn: 'Do 10 push-ups', enabled: true },
    { id: randomUUID(), labelUk: 'Розім’яти спину', labelEn: 'Stretch your back', enabled: true },
    { id: randomUUID(), labelUk: 'Випити води', labelEn: 'Drink some water', enabled: true }
  ]
}

type ProjectRow = { id: string; name: string; color: string; archived: number; status_id: string | null; type_id: string | null; sort_order: number; deadline: string | null; budget_minutes: number | null; created_at: number }
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
type PlannedTaskRow = { id: string; title: string; project_id: string | null; notes: string; reminder_time: string | null; created_at: number; completed_at: number | null }
type IntervalRow = { id: string; task_id: string; started_at: number; ended_at: number | null }
type WorkdayRow = { id: string; started_at: number; ended_at: number | null; stopped_task_ids_json: string | null; scheduled_minutes: number | null; lunch_minutes: number | null }
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

function isDeadline(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Budgets are stored in whole minutes, so anything that rounds to zero minutes is rejected. */
function isBudgetHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.round(value * 60) >= 1 && value <= 100_000
}

function normalizeDeadline(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (!isDeadline(value)) throw new Error('Deadline must be a valid date')
  return value
}

function normalizeBudgetMinutes(hours: number | null | undefined): number | null {
  if (hours === null || hours === undefined) return null
  if (!isBudgetHours(hours)) throw new Error('Budget must be at least one minute')
  return Math.round(hours * 60)
}

function isReminderTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(/^(\d{2}):(\d{2})$/)
  return match !== null && Number(match[1]) < 24 && Number(match[2]) < 60
}

function normalizeReminderTime(value: string | null | undefined): string | null {
  if (value === undefined || value === null || !value.trim()) return null
  if (!isReminderTime(value)) throw new Error('Reminder time must be in HH:MM format')
  return value
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
  if (!backup || typeof backup !== 'object' || backup.schemaVersion !== 1 || !isTimestamp(backup.exportedAt)) {
    throw new Error('The selected backup is not a compatible Work Buddy backup')
  }
  if (!Array.isArray(backup.projects) || !Array.isArray(backup.plannedTasks) || !Array.isArray(backup.tasks) || !Array.isArray(backup.workdays) || !Array.isArray(backup.rests)) {
    throw new Error('The selected backup is incomplete')
  }
  if (backup.overtimeRedeemedDates !== undefined && (!Array.isArray(backup.overtimeRedeemedDates) || !backup.overtimeRedeemedDates.every((date) => typeof date === 'string'))) {
    throw new Error('The selected backup has invalid overtime redemptions')
  }
  if (!isRecord(backup.settings)) throw new Error('The selected backup has invalid settings')
  if (!hasUniqueIds(backup.projects) || !backup.projects.every((item) => isId(item.name) && isId(item.color) && typeof item.archived === 'boolean' && isOptionalId(item.statusId ?? null) && isOptionalId(item.typeId ?? null) && (item.deadline == null || isDeadline(item.deadline)) && (item.budgetHours == null || isBudgetHours(item.budgetHours)) && (item.sortOrder == null || Number.isInteger(item.sortOrder)) && isTimestamp(item.createdAt))) {
    throw new Error('The selected backup has invalid projects')
  }
  const projectIds = new Set(backup.projects.map((item) => item.id))
  if (!hasUniqueIds(backup.plannedTasks) || !backup.plannedTasks.every((item) => isId(item.title) && typeof item.notes === 'string' && isTimestamp(item.createdAt) && (item.reminderTime === undefined || item.reminderTime === null || isReminderTime(item.reminderTime)) && (item.completedAt === undefined || item.completedAt === null || isTimestamp(item.completedAt)) && isOptionalId(item.projectId) && (item.projectId === null || projectIds.has(item.projectId)))) {
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
  const taskIds = new Set(backup.tasks.map((item) => item.id))
  const intervalIds = backup.tasks.flatMap((item) => item.intervals.map((interval) => interval.id))
  const isPlanMinutes = (value: unknown): boolean => value === undefined || value === null || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 24 * 60)
  if (!hasUniqueIds(backup.workdays) || !backup.workdays.every((item) => isTimestamp(item.startedAt) && (item.endedAt === null || (isTimestamp(item.endedAt) && item.endedAt >= item.startedAt))
    && isPlanMinutes(item.scheduledMinutes) && isPlanMinutes(item.lunchMinutes))) {
    throw new Error('The selected backup has invalid workdays')
  }
  if (backup.workdays.filter((item) => item.endedAt === null).length > 1) throw new Error('The selected backup has more than one active workday')
  if (!hasUniqueIds(backup.rests) || !backup.rests.every((item) =>
    (item.type === 'lunch' || item.type === 'break')
    && (item.status === 'running' || item.status === 'paused' || item.status === 'completed')
    && Number.isFinite(item.plannedMinutes)
    && item.plannedMinutes >= 0
    && typeof item.alarmMuted === 'boolean'
    && (item.resumeTaskIds === undefined || (Array.isArray(item.resumeTaskIds) && item.resumeTaskIds.every((id) => isId(id) && taskIds.has(id)) && new Set(item.resumeTaskIds).size === item.resumeTaskIds.length))
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
    if (rest.status !== 'running' && (rest.resumeTaskIds?.length ?? 0) > 0) {
      throw new Error('The selected backup has inconsistent break resume tasks')
    }
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

function isGlobalShortcut(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split('+')
  const key = parts.at(-1)
  const modifiers = parts.slice(0, -1)
  const allowedModifiers = new Set(['CommandOrControl', 'Alt', 'Shift', 'Super'])
  const validKey = typeof key === 'string' && (/^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key) || ['Space', 'Tab', 'Esc', 'Up', 'Down', 'Left', 'Right', 'Delete', 'Backspace'].includes(key))
  return Boolean(key) && modifiers.length > 0 && modifiers.every((modifier) => allowedModifiers.has(modifier))
    && new Set(modifiers).size === modifiers.length
    && modifiers.some((modifier) => modifier === 'CommandOrControl' || modifier === 'Alt' || modifier === 'Super')
    && validKey
}

function deepSettings(raw?: string): AppSettings {
  if (!raw) return structuredClone(defaultSettings)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return structuredClone(defaultSettings)
  }
  const stored = isRecord(parsed) ? parsed as Partial<AppSettings> & { sanity?: unknown; googleCalendar?: unknown } : {}
  const { sanity: _legacySanity, googleCalendar: _legacyGoogleCalendar, ...storedWithoutLegacy } = stored
  const storedWorkday: Record<string, unknown> = isRecord(stored.workday) ? stored.workday : {}
  const storedBreaks: Record<string, unknown> = isRecord(stored.breaks) ? stored.breaks : {}
  const storedLunch: Record<string, unknown> = isRecord(stored.lunch) ? stored.lunch : {}
  const storedIdle: Record<string, unknown> = isRecord(stored.idle) ? stored.idle : {}
  const storedNotifications: Record<string, unknown> = isRecord(stored.notifications) ? stored.notifications : {}
  const storedAi: Record<string, unknown> = isRecord(stored.ai) ? stored.ai : {}
  const sounds = ['system', 'soft', 'bell', 'pop', 'custom'] as const
  const models = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] as const
  const colors = Array.isArray(stored.projectColors)
    ? stored.projectColors.filter((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).slice(0, 24)
    : []
  const locale: Locale = stored.locale === 'en' ? 'en' : 'uk'
  const projectStatuses = Array.isArray(stored.projectStatuses)
    ? stored.projectStatuses.filter((status): status is ProjectStatus => isRecord(status)
      && isId(status.id) && isId(status.name) && typeof status.color === 'string' && /^#[0-9a-f]{6}$/i.test(status.color)).slice(0, 30)
    : builtInStatusList(locale)
  const projectTypes = Array.isArray(stored.projectTypes)
    ? stored.projectTypes.filter((type): type is ProjectType => isRecord(type)
      && isId(type.id) && isId(type.name) && typeof type.color === 'string' && /^#[0-9a-f]{6}$/i.test(type.color)).slice(0, 30)
    : []
  const wellnessActions = Array.isArray(stored.wellnessActions)
    ? stored.wellnessActions.filter((action): action is AppSettings['wellnessActions'][number] => isRecord(action)
      && isId(action.id) && typeof action.labelUk === 'string' && typeof action.labelEn === 'string' && typeof action.enabled === 'boolean').slice(0, 50)
    : []
  return {
    ...structuredClone(defaultSettings),
    ...storedWithoutLegacy,
    locale,
    theme: stored.theme === 'light' || stored.theme === 'system' ? stored.theme : 'dark',
    alwaysOnTop: typeof stored.alwaysOnTop === 'boolean' ? stored.alwaysOnTop : defaultSettings.alwaysOnTop,
    autoStart: typeof stored.autoStart === 'boolean' ? stored.autoStart : defaultSettings.autoStart,
    globalShortcut: isGlobalShortcut(stored.globalShortcut) ? stored.globalShortcut : defaultSettings.globalShortcut,
    notchEnabled: typeof stored.notchEnabled === 'boolean' ? stored.notchEnabled : defaultSettings.notchEnabled,
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
    projectStatuses,
    projectTypes,
    wellnessActions: wellnessActions.length ? wellnessActions : structuredClone(defaultSettings.wellnessActions),
    ai: { enabled: typeof storedAi.enabled === 'boolean' ? storedAi.enabled : defaultSettings.ai.enabled, model: models.includes(storedAi.model as AppSettings['ai']['model']) ? storedAi.model as AppSettings['ai']['model'] : defaultSettings.ai.model, hasApiKey: typeof storedAi.hasApiKey === 'boolean' ? storedAi.hasApiKey : false }
  }
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: Boolean(row.archived),
    statusId: row.status_id,
    typeId: row.type_id,
    sortOrder: row.sort_order,
    deadline: row.deadline,
    budgetHours: row.budget_minutes ? row.budget_minutes / 60 : null,
    createdAt: row.created_at
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

/** Per project: task count, the latest end, and closed intervals merged into sorted, disjoint ranges. */
type ClosedProjectRanges = Map<string, { taskCount: number; lastEndedAt: number | null; ranges: Array<[number, number]> }>

export class WorkBuddyDatabase {
  private readonly db: DatabaseSync
  /** Closed project ranges from the last stats scan, reused until tasks or intervals change. */
  private closedRangesCache: { version: number; grouped: ClosedProjectRanges } | null = null

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
        reminder_time TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
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

      CREATE TABLE IF NOT EXISTS ui_state (
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
    const projectColumns = this.db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
    if (!projectColumns.some((column) => column.name === 'status_id')) this.db.exec('ALTER TABLE projects ADD COLUMN status_id TEXT')
    if (!projectColumns.some((column) => column.name === 'type_id')) this.db.exec('ALTER TABLE projects ADD COLUMN type_id TEXT')
    if (!projectColumns.some((column) => column.name === 'sort_order')) this.db.exec('ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
    if (!projectColumns.some((column) => column.name === 'deadline')) this.db.exec('ALTER TABLE projects ADD COLUMN deadline TEXT')
    if (!projectColumns.some((column) => column.name === 'budget_minutes')) this.db.exec('ALTER TABLE projects ADD COLUMN budget_minutes INTEGER')
    const plannedTaskColumns = this.db.prepare('PRAGMA table_info(planned_tasks)').all() as Array<{ name: string }>
    if (!plannedTaskColumns.some((column) => column.name === 'completed_at')) this.db.exec('ALTER TABLE planned_tasks ADD COLUMN completed_at INTEGER')
    if (!plannedTaskColumns.some((column) => column.name === 'reminder_time')) this.db.exec('ALTER TABLE planned_tasks ADD COLUMN reminder_time TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_planned_tasks_open ON planned_tasks(completed_at, created_at)')
    const workdayColumns = this.db.prepare('PRAGMA table_info(workdays)').all() as Array<{ name: string }>
    if (!workdayColumns.some((column) => column.name === 'stopped_task_ids_json')) this.db.exec('ALTER TABLE workdays ADD COLUMN stopped_task_ids_json TEXT')
    if (!workdayColumns.some((column) => column.name === 'scheduled_minutes')) this.db.exec('ALTER TABLE workdays ADD COLUMN scheduled_minutes INTEGER')
    if (!workdayColumns.some((column) => column.name === 'lunch_minutes')) this.db.exec('ALTER TABLE workdays ADD COLUMN lunch_minutes INTEGER')
    const restColumns = this.db.prepare('PRAGMA table_info(rest_sessions)').all() as Array<{ name: string }>
    if (!restColumns.some((column) => column.name === 'alarm_muted')) this.db.exec('ALTER TABLE rest_sessions ADD COLUMN alarm_muted INTEGER NOT NULL DEFAULT 0')
    this.db.exec("DELETE FROM secrets WHERE key IN ('sanity_api_token', 'google_calendar_tokens'); DROP TABLE IF EXISTS processed_remote_commands;")

    const settings = this.db.prepare('SELECT json FROM app_settings WHERE id = 1').get() as { json: string } | undefined
    if (!settings) {
      this.db.prepare('INSERT INTO app_settings (id, json) VALUES (1, ?)').run(JSON.stringify(defaultSettings))
    } else if (settings.json.includes('"sanity"') || settings.json.includes('"googleCalendar"')) {
      this.db.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify(deepSettings(settings.json)))
    }

    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version < 1) {
      // Built-in statuses used to be stored in Ukrainian whatever the interface language was.
      const stored = deepSettings((this.db.prepare('SELECT json FROM app_settings WHERE id = 1').get() as { json: string }).json)
      if (stored.locale === 'en') {
        stored.projectStatuses = stored.projectStatuses.map((status) => relocalizeStatus(status, status, 'uk', 'en'))
        this.db.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify(stored))
      }
      this.db.exec('PRAGMA user_version = 1')
    }

    // Days recorded before workdays kept their own schedule take the current one, once, and keep it.
    this.backfillWorkdayPlans()

    // Project stats cache what they read from tasks and intervals; only writes there invalidate it.
    this.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS tracking_version (id INTEGER PRIMARY KEY CHECK(id = 1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO tracking_version (id, value) VALUES (1, 0);
      ${['tasks', 'time_intervals'].flatMap((table) => ['INSERT', 'UPDATE', 'DELETE'].map((event) =>
        `CREATE TEMP TRIGGER IF NOT EXISTS bump_${table}_${event.toLowerCase()} AFTER ${event} ON main.${table}
         BEGIN UPDATE tracking_version SET value = value + 1; END;`)).join('\n')}
    `)
  }

  /** The schedule length and lunch allowance a workday started now is measured against. */
  private currentWorkdayPlan(): [scheduledMinutes: number, lunchMinutes: number] {
    const settings = this.getSettings()
    return [Math.round(scheduledWorkdayDurationMs(settings) / 60_000), settings.lunch.durationMinutes]
  }

  private insertWorkday(startedAt: number): void {
    this.db.prepare('INSERT INTO workdays (id, started_at, ended_at, scheduled_minutes, lunch_minutes) VALUES (?, ?, NULL, ?, ?)').run(randomUUID(), startedAt, ...this.currentWorkdayPlan())
  }

  private backfillWorkdayPlans(): void {
    const [scheduledMinutes, lunchMinutes] = this.currentWorkdayPlan()
    this.db.prepare('UPDATE workdays SET scheduled_minutes = COALESCE(scheduled_minutes, ?), lunch_minutes = COALESCE(lunch_minutes, ?) WHERE scheduled_minutes IS NULL OR lunch_minutes IS NULL')
      .run(scheduledMinutes, lunchMinutes)
  }

  /** A workday with its own plan and the finished sessions before it on the same calendar day. */
  private workdayFromRow(row: WorkdayRow): Workday {
    const [dayStart] = localDayBounds(row.started_at)
    const earlier = this.db.prepare('SELECT started_at, ended_at FROM workdays WHERE ended_at IS NOT NULL AND started_at >= ? AND started_at < ? AND id != ? ORDER BY started_at')
      .all(dayStart, row.started_at, row.id) as Array<{ started_at: number; ended_at: number }>
    return {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      scheduledMinutes: row.scheduled_minutes,
      lunchMinutes: row.lunch_minutes,
      ...(earlier.length ? { earlierSessions: earlier.map((session) => ({ startedAt: session.started_at, endedAt: session.ended_at })) } : {})
    }
  }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT json FROM app_settings WHERE id = 1').get() as { json: string } | undefined
    const settings = deepSettings(row?.json)
    settings.ai.hasApiKey = this.hasSecret('gemini_api_key')
    return settings
  }

  /** Where the user dragged the notch to: a display and the pill centre as a share of its width. */
  getNotchPlacement(): { displayId: number; ratio: number } | null {
    const row = this.db.prepare("SELECT value FROM ui_state WHERE key = 'notch_placement'").get() as { value: string } | undefined
    try {
      const value = row ? JSON.parse(row.value) as unknown : null
      return isRecord(value) && Number.isFinite(value.displayId) && Number.isFinite(value.ratio) && (value.ratio as number) >= 0 && (value.ratio as number) <= 1
        ? { displayId: value.displayId as number, ratio: value.ratio as number }
        : null
    } catch {
      return null
    }
  }

  setNotchPlacement(placement: { displayId: number; ratio: number }): void {
    this.db.prepare("INSERT INTO ui_state (key, value) VALUES ('notch_placement', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(placement))
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
    const previous = this.getSettings()
    const safe = deepSettings(JSON.stringify(settings))
    safe.projectStatuses = safe.projectStatuses.map((status) =>
      relocalizeStatus(status, previous.projectStatuses.find((old) => old.id === status.id), previous.locale, safe.locale))
    this.transaction(() => {
      this.db.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify(safe))
      // Today follows a schedule change; finished days keep the plan they were worked under.
      const [todayStart] = localDayBounds(Date.now())
      this.db.prepare('UPDATE workdays SET scheduled_minutes = ?, lunch_minutes = ? WHERE started_at >= ? OR ended_at IS NULL').run(...this.currentWorkdayPlan(), todayStart)
    })
    return this.getSnapshot()
  }

  getSnapshot(): AppSnapshot {
    // Opening the app on a new calendar day must not leave yesterday's live
    // task in Focus until the user presses another button.
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const [dayStart, dayEnd] = localDayBounds(now)
    const projects = (this.db.prepare('SELECT * FROM projects ORDER BY archived, sort_order, created_at').all() as ProjectRow[]).map(projectFromRow)
    const plannedTasks = (this.db.prepare('SELECT * FROM planned_tasks WHERE completed_at IS NULL ORDER BY created_at DESC').all() as PlannedTaskRow[]).map(
      (row): PlannedTask => ({ id: row.id, title: row.title, projectId: row.project_id, notes: row.notes, reminderTime: row.reminder_time, createdAt: row.created_at, completedAt: row.completed_at })
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

    const workday: Workday | null = workdayRow ? this.workdayFromRow(workdayRow) : null

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

  getHistory(days?: number | null): HistoryDay[] {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    // The extension bridge serializes a missing argument as null.
    const safeDays = Math.min(730, Math.max(14, Math.round(typeof days === 'number' && Number.isFinite(days) ? days : 182)))
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
    this.normalizeStaleWorkday(Date.now())
    const settings = this.getSettings()
    const rows = this.db.prepare('SELECT * FROM workdays WHERE ended_at IS NOT NULL ORDER BY started_at').all() as Array<WorkdayRow & { ended_at: number }>
    // Every finished session of a calendar day shares one allowance, measured from the day's first start.
    const sessionsByDate = new Map<string, Array<WorkdayRow & { ended_at: number }>>()
    for (const row of rows) {
      const date = localDateKey(row.started_at)
      sessionsByDate.set(date, [...sessionsByDate.get(date) ?? [], row])
    }
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
    for (const [date, sessions] of sessionsByDate) {
      const first = sessions[0]
      const last = sessions[sessions.length - 1]
      const rests = (lunchSessions.all(last.ended_at, first.started_at) as Array<RestRow & { interval_id: string; interval_started_at: number; interval_ended_at: number }>)
        .map((row): RestSession => ({
          id: row.id, type: 'lunch', status: row.status, plannedMinutes: row.planned_minutes, alarmMuted: Boolean(row.alarm_muted), createdAt: row.created_at, endedAt: row.ended_at,
          intervals: [{ id: row.interval_id, restId: row.id, startedAt: row.interval_started_at, endedAt: row.interval_ended_at }]
        }))
      const workedIntervals = (taskIntervals.all(last.ended_at, first.started_at) as IntervalRow[]).map((interval): TimeInterval => ({
        id: interval.id, taskId: interval.task_id, startedAt: interval.started_at, endedAt: interval.ended_at
      }))
      const workday: Workday = {
        id: last.id,
        startedAt: last.started_at,
        endedAt: last.ended_at,
        scheduledMinutes: last.scheduled_minutes,
        lunchMinutes: last.lunch_minutes,
        earlierSessions: sessions.slice(0, -1).map((session) => ({ startedAt: session.started_at, endedAt: session.ended_at }))
      }
      const overtime = workdayOvertimeMs(settings, workday, rests, last.ended_at, workedIntervals)
      if (overtime > 0) dailyOvertime.set(date, overtime)
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
    this.normalizeStaleWorkday(Date.now())
    const [dayStart, dayEnd] = localDayBounds(localDateTimestamp(date))
    const projects = (this.db.prepare('SELECT * FROM projects ORDER BY archived, sort_order, created_at').all() as ProjectRow[]).map(projectFromRow)
    const plannedTasks = (this.db.prepare('SELECT * FROM planned_tasks WHERE completed_at IS NULL ORDER BY created_at DESC').all() as PlannedTaskRow[]).map(
      (row): PlannedTask => ({ id: row.id, title: row.title, projectId: row.project_id, notes: row.notes, reminderTime: row.reminder_time, createdAt: row.created_at, completedAt: row.completed_at })
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
    const workday = workdayRow ? this.workdayFromRow(workdayRow) : null
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
    const { ai: _ai, ...backupSettings } = settings
    const projects = (this.db.prepare('SELECT * FROM projects ORDER BY created_at').all() as ProjectRow[]).map(projectFromRow)
    const plannedTasks = (this.db.prepare('SELECT * FROM planned_tasks ORDER BY created_at').all() as PlannedTaskRow[]).map((row): PlannedTask => ({
      id: row.id, title: row.title, projectId: row.project_id, notes: row.notes, reminderTime: row.reminder_time, createdAt: row.created_at, completedAt: row.completed_at
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
      id: row.id, startedAt: row.started_at, endedAt: row.ended_at, scheduledMinutes: row.scheduled_minutes, lunchMinutes: row.lunch_minutes
    }))
    const restIntervals = this.db.prepare('SELECT * FROM rest_intervals WHERE rest_id = ? ORDER BY started_at')
    const rests = (this.db.prepare('SELECT * FROM rest_sessions ORDER BY created_at').all() as RestRow[]).map((row): RestSession => ({
      id: row.id,
      type: row.type,
      status: row.status,
      plannedMinutes: row.planned_minutes,
      alarmMuted: Boolean(row.alarm_muted),
      resumeTaskIds: JSON.parse(row.resume_task_ids_json) as string[],
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
    validateBackup(backup)
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
      const onConflict = (replace: string): string => mode === 'merge' ? 'DO NOTHING' : `DO UPDATE SET ${replace}`
      const project = this.db.prepare(`INSERT INTO projects (id, name, color, archived, status_id, type_id, sort_order, deadline, budget_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('name = excluded.name, color = excluded.color, archived = excluded.archived, status_id = excluded.status_id, type_id = excluded.type_id, sort_order = excluded.sort_order, deadline = excluded.deadline, budget_minutes = excluded.budget_minutes, created_at = excluded.created_at')}`)
      const plannedTask = this.db.prepare(`INSERT INTO planned_tasks (id, title, project_id, notes, reminder_time, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('title = excluded.title, project_id = excluded.project_id, notes = excluded.notes, reminder_time = excluded.reminder_time, created_at = excluded.created_at, completed_at = excluded.completed_at')}`)
      const task = this.db.prepare(`INSERT INTO tasks (id, title, project_id, planned_task_id, notes, tags_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('title = excluded.title, project_id = excluded.project_id, planned_task_id = excluded.planned_task_id, notes = excluded.notes, tags_json = excluded.tags_json, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at')}`)
      const interval = this.db.prepare(`INSERT INTO time_intervals (id, task_id, started_at, ended_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('task_id = excluded.task_id, started_at = excluded.started_at, ended_at = excluded.ended_at')}`)
      const workday = this.db.prepare(`INSERT INTO workdays (id, started_at, ended_at, scheduled_minutes, lunch_minutes) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('started_at = excluded.started_at, ended_at = excluded.ended_at, scheduled_minutes = COALESCE(excluded.scheduled_minutes, workdays.scheduled_minutes), lunch_minutes = COALESCE(excluded.lunch_minutes, workdays.lunch_minutes)')}`)
      const rest = this.db.prepare(`INSERT INTO rest_sessions (id, type, status, planned_minutes, alarm_muted, created_at, ended_at, resume_task_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('type = excluded.type, status = excluded.status, planned_minutes = excluded.planned_minutes, alarm_muted = excluded.alarm_muted, created_at = excluded.created_at, ended_at = excluded.ended_at, resume_task_ids_json = excluded.resume_task_ids_json')}`)
      const restInterval = this.db.prepare(`INSERT INTO rest_intervals (id, rest_id, started_at, ended_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) ${onConflict('rest_id = excluded.rest_id, started_at = excluded.started_at, ended_at = excluded.ended_at')}`)
      const overtimeRedemption = this.db.prepare('INSERT INTO overtime_redemptions (date, redeemed_at) VALUES (?, ?) ON CONFLICT(date) DO NOTHING')

      // Merged-in projects keep their relative priority but land after the existing ones.
      const sortOffset = mode === 'merge' ? (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM projects').get() as { next: number }).next : 0
      const legacyOrder = new Map([...backup.projects].sort((first, second) => first.createdAt - second.createdAt).map((item, index) => [item.id, index]))
      for (const item of backup.projects) project.run(item.id, item.name, item.color, Number(item.archived), item.statusId ?? null, item.typeId ?? null, sortOffset + (item.sortOrder ?? legacyOrder.get(item.id) ?? 0), item.deadline ?? null, item.budgetHours ? Math.round(item.budgetHours * 60) : null, item.createdAt)
      for (const item of backup.plannedTasks) plannedTask.run(item.id, item.title, item.projectId, item.notes, item.reminderTime ?? null, item.createdAt, item.completedAt ?? null)
      for (const item of backup.tasks) {
        task.run(item.id, item.title, item.projectId, item.plannedTaskId, item.notes, JSON.stringify(item.tags), item.status, item.createdAt, item.updatedAt)
        for (const itemInterval of item.intervals) interval.run(itemInterval.id, item.id, itemInterval.startedAt, itemInterval.endedAt)
      }
      for (const item of backup.workdays) workday.run(item.id, item.startedAt, item.endedAt, item.scheduledMinutes ?? null, item.lunchMinutes ?? null)
      for (const item of backup.rests) {
        rest.run(item.id, item.type, item.status, item.plannedMinutes, Number(item.alarmMuted ?? false), item.createdAt, item.endedAt, JSON.stringify(item.resumeTaskIds ?? []))
        for (const itemInterval of item.intervals) restInterval.run(itemInterval.id, item.id, itemInterval.startedAt, itemInterval.endedAt)
      }
      for (const date of backup.overtimeRedeemedDates ?? []) overtimeRedemption.run(date, Date.now())
      if (mode === 'replace') {
        const restoredSettings = deepSettings(JSON.stringify({ ...backup.settings, ai: existingSettings.ai }))
        this.db.prepare('UPDATE app_settings SET json = ? WHERE id = 1').run(JSON.stringify(restoredSettings))
      }
      // Older backups have no per-day plan; they take the schedule in effect after the import.
      this.backfillWorkdayPlans()
    })
    return this.getSnapshot()
  }

  createDayCalendarIcs(date: string): string {
    return this.createCalendarIcs(date, date)
  }

  /**
   * Exports every finished interval from the first date's start to the last date's end (inclusive).
   * Running intervals are left out: their end is not known yet, and exporting them cut off at
   * "now" would leave a truncated event behind in the calendar under the same UID.
   */
  createCalendarIcs(fromDate: string, toDate: string): string {
    const dayStart = localDayBounds(localDateTimestamp(fromDate))[0]
    const dayEnd = localDayBounds(localDateTimestamp(toDate))[1]
    if (dayEnd <= dayStart) throw new Error('The end date must not be before the start date')
    if (dayEnd - dayStart > 367 * 86_400_000) throw new Error('Choose a range of up to one year')
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const rows = this.db.prepare(
      `SELECT i.id, i.started_at, i.ended_at, t.title, t.notes, p.name AS project_name
       FROM time_intervals i
       JOIN tasks t ON t.id = i.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE i.started_at < ? AND i.ended_at IS NOT NULL AND i.ended_at > ?
       ORDER BY i.started_at`
    ).all(dayEnd, dayStart) as Array<{ id: string; started_at: number; ended_at: number; title: string; notes: string; project_name: string | null }>
    const taskEvents = rows.flatMap((row) => {
      const startedAt = Math.max(row.started_at, dayStart)
      const endedAt = Math.min(row.ended_at, dayEnd)
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
       WHERE i.started_at < ? AND i.ended_at IS NOT NULL AND i.ended_at > ?
       ORDER BY i.started_at`
    ).all(dayEnd, dayStart) as Array<{ id: string; started_at: number; ended_at: number; type: RestType }>
    const restEvents = restRows.flatMap((row) => {
      const startedAt = Math.max(row.started_at, dayStart)
      const endedAt = Math.min(row.ended_at, dayEnd)
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
    if (!events.length) throw new Error('There is no tracked work to export for this period')
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Work Buddy//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR', ''].map(foldIcsLine).join('\r\n')
  }

  startWorkday(): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const current = this.getOpenWorkday()
    if (!current) {
      this.insertWorkday(now)
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

  /** Reopens today's most recently ended workday. Tasks stay stopped, so the gap is not counted as work. */
  /** Undoes an accidental day start: the workday and everything tracked while it was open disappear. */
  resetWorkday(id: string): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const workday = this.db.prepare('SELECT * FROM workdays WHERE id = ?').get(id) as WorkdayRow | undefined
    if (!workday) throw new Error('Workday not found')
    const [todayStart] = localDayBounds(now)
    if (workday.ended_at !== null && workday.started_at < todayStart) throw new Error('Only today’s workday can be reset')
    const from = workday.started_at
    const until = workday.ended_at ?? now
    this.transaction(() => {
      const touched = (this.db.prepare('SELECT DISTINCT task_id FROM time_intervals WHERE started_at >= ? AND started_at <= ?').all(from, until) as Array<{ task_id: string }>)
        .map((row) => row.task_id)
      this.db.prepare('DELETE FROM time_intervals WHERE started_at >= ? AND started_at <= ?').run(from, until)
      this.db.prepare('DELETE FROM rest_sessions WHERE created_at >= ? AND created_at <= ?').run(from, until)
      const remaining = this.db.prepare('SELECT COUNT(*) AS count FROM time_intervals WHERE task_id = ?')
      for (const taskId of touched) {
        // Tasks that only existed in this day go; older tasks resumed today go back to how they were.
        if ((remaining.get(taskId) as { count: number }).count === 0) this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
        else this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE id = ?").run(now, taskId)
      }
      this.db.prepare('UPDATE planned_tasks SET completed_at = NULL WHERE completed_at >= ? AND completed_at <= ?').run(from, until)
      this.db.prepare('DELETE FROM workdays WHERE id = ?').run(id)
    })
    return this.getSnapshot()
  }

  resumeWorkday(): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    if (this.getOpenWorkday()) return this.getSnapshot()
    const [todayStart] = localDayBounds(now)
    const last = this.db.prepare('SELECT * FROM workdays WHERE ended_at IS NOT NULL AND started_at >= ? ORDER BY ended_at DESC LIMIT 1').get(todayStart) as WorkdayRow | undefined
    if (!last) throw new Error('There is no finished workday from today to continue')
    this.transaction(() => {
      // Bring the tasks that ending the day stopped back as paused so they are
      // visible in Focus, without counting the gap. Workdays ended before this was
      // recorded fall back to the tasks stopped at the same instant.
      if (last.stopped_task_ids_json !== null) {
        const pause = this.db.prepare("UPDATE tasks SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'stopped'")
        for (const id of JSON.parse(last.stopped_task_ids_json) as string[]) pause.run(now, id)
      } else {
        this.db.prepare("UPDATE tasks SET status = 'paused', updated_at = ? WHERE status = 'stopped' AND updated_at = ?").run(now, last.ended_at)
      }
      this.db.prepare('UPDATE workdays SET ended_at = NULL, stopped_task_ids_json = NULL WHERE id = ?').run(last.id)
    })
    return this.getSnapshot()
  }

  updateWorkdayStart(startedAt: number): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const workday = this.getOpenWorkday()
    if (!workday) throw new Error('Start the workday first')
    this.validateAdjustedStart(startedAt, workday.started_at, null)
    const correctedStart = Math.round(startedAt)
    const [dayStart, dayEnd] = localDayBounds(workday.started_at)
    // A second workday on the same day owns only the time after the previous one ended.
    const previous = this.db.prepare('SELECT MAX(ended_at) AS ended_at FROM workdays WHERE id != ? AND ended_at IS NOT NULL AND ended_at <= ?').get(workday.id, workday.started_at) as { ended_at: number | null }
    if (previous.ended_at !== null && correctedStart < previous.ended_at) throw new Error('Workday start cannot be before the previous workday ended')
    const trackedFrom = Math.max(dayStart, previous.ended_at ?? dayStart)
    const firstTrackedInterval = this.db.prepare('SELECT MIN(started_at) AS started_at FROM time_intervals WHERE started_at >= ? AND started_at < ?').get(trackedFrom, dayEnd) as { started_at: number | null }
    const firstRestInterval = this.db.prepare('SELECT MIN(started_at) AS started_at FROM rest_intervals WHERE started_at >= ? AND started_at < ?').get(trackedFrom, dayEnd) as { started_at: number | null }
    const firstTrackedAt = Math.min(firstTrackedInterval.started_at ?? Infinity, firstRestInterval.started_at ?? Infinity)
    if (correctedStart > firstTrackedAt) throw new Error('Workday start cannot be after tracked time')
    this.db.prepare('UPDATE workdays SET started_at = ? WHERE id = ?').run(correctedStart, workday.id)
    return this.getSnapshot()
  }

  startTask(input: StartTaskInput): AppSnapshot {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    if (this.getActiveRest()?.status === 'running') throw new Error('Pause the active break before starting a task')
    if (input.taskId) {
      const existing = this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(input.taskId) as { status: Task['status'] } | undefined
      if (!existing) throw new Error('Task not found')
    }
    const transaction = (): void => this.transaction(() => {
      if (!this.getOpenWorkday()) {
        this.insertWorkday(now)
      }
      if (input.mode === 'switch') this.pauseAll(now)

      const taskId = input.taskId ?? randomUUID()
      if (input.taskId) {
        this.db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(now, taskId)
      } else {
        this.assertPlannedTaskCanBeAttached(input.plannedTaskId)
        this.db
          .prepare(
            `INSERT INTO tasks (id, title, project_id, planned_task_id, notes, tags_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`
          )
          .run(taskId, input.title?.trim() ?? '', input.projectId ?? null, input.plannedTaskId ?? null, input.notes?.trim() ?? '', JSON.stringify(input.tags ?? []), now, now)
        if (input.plannedTaskId) this.completePlannedTask(input.plannedTaskId, now)
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
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    if (!this.getOpenWorkday()) throw new Error('Start the workday first')
    const active = this.getActiveRest()
    if (active) throw new Error('Another break is already active')
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
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    if (!this.getOpenWorkday()) throw new Error('Start the workday first')
    if (this.getActiveRest()) throw new Error('Finish the active break first')
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
    const correctedStart = Math.round(startedAt)
    const restEnd = interval.ended_at ?? Date.now()
    const overlappingRests = this.db.prepare(
      `SELECT 1 FROM rest_intervals
       WHERE rest_id != ? AND started_at < ? AND COALESCE(ended_at, ?) > ? LIMIT 1`
    ).get(id, restEnd, Date.now(), correctedStart)
    if (overlappingRests) throw new Error('Rest start cannot overlap another break')

    const overlappingTasks = this.db.prepare(
      `SELECT id, started_at, ended_at FROM time_intervals
       WHERE started_at < ? AND ended_at IS NOT NULL AND ended_at > ?`
    ).all(restEnd, correctedStart) as IntervalRow[]
    const autoTrimmedTaskIds = new Set(overlappingTasks
      .filter((taskInterval) => taskInterval.ended_at === interval.started_at && taskInterval.started_at <= correctedStart)
      .map((taskInterval) => taskInterval.id))
    if (overlappingTasks.some((taskInterval) => !autoTrimmedTaskIds.has(taskInterval.id))) {
      throw new Error('Rest start conflicts with tracked task time')
    }

    this.transaction(() => {
      this.db.prepare('UPDATE rest_intervals SET started_at = ? WHERE id = ?').run(correctedStart, interval.id)
      if (autoTrimmedTaskIds.size) {
        const updateTaskEnd = this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE id = ?')
        for (const taskIntervalId of autoTrimmedTaskIds) updateTaskEnd.run(correctedStart, taskIntervalId)
      }
    })
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
    const plannedTaskId = input.plannedTaskId === undefined ? current.planned_task_id : input.plannedTaskId
    if (plannedTaskId && plannedTaskId !== current.planned_task_id) this.assertPlannedTaskCanBeAttached(plannedTaskId)
    const updatedAt = Date.now()
    this.transaction(() => {
      this.db
        .prepare('UPDATE tasks SET title = ?, project_id = ?, planned_task_id = ?, notes = ?, tags_json = ?, updated_at = ? WHERE id = ?')
        .run(
          input.title?.trim() ?? current.title,
          input.projectId === undefined ? current.project_id : input.projectId,
          plannedTaskId,
          input.notes?.trim() ?? current.notes,
          JSON.stringify(input.tags ?? (JSON.parse(current.tags_json) as string[])),
          updatedAt,
          input.id
        )
      if (input.startedAt !== undefined && firstInterval) {
        this.db.prepare('UPDATE time_intervals SET started_at = ? WHERE id = ?').run(Math.round(input.startedAt), firstInterval.id)
      }
      if (input.endedAt !== undefined && finalInterval) {
        this.db.prepare('UPDATE time_intervals SET ended_at = ? WHERE id = ?').run(Math.round(input.endedAt), finalInterval.id)
      }
      if (plannedTaskId && plannedTaskId !== current.planned_task_id) this.completePlannedTask(plannedTaskId, updatedAt)
    })
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
    const dayIntervals = this.db.prepare(
      `SELECT task_id, started_at, ended_at FROM time_intervals
       WHERE task_id IN (${placeholders}) AND started_at < ? AND ended_at > ?`
    ).all(...taskIds, dayEnd, dayStart) as Array<{ task_id: string; started_at: number; ended_at: number }>
    const taskIdsOnDate = new Set(dayIntervals.map((interval) => interval.task_id))
    if (!taskIdsOnDate.has(input.targetId) || sourceIds.some((id) => !taskIdsOnDate.has(id))) {
      throw new Error('Every merged task must have time on the selected day')
    }
    const ranges = dayIntervals.map((interval) => ({
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
    this.db.prepare('INSERT INTO planned_tasks (id, title, project_id, notes, reminder_time, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), title, input.projectId ?? null, input.notes?.trim() ?? '', normalizeReminderTime(input.reminderTime), Date.now()
    )
    return this.getSnapshot()
  }

  updatePlannedTask(input: PlannedTaskUpdateInput): AppSnapshot {
    const title = input.title.trim()
    if (!title) throw new Error('Planned task name is required')
    const existing = this.db.prepare('SELECT reminder_time FROM planned_tasks WHERE id = ? AND completed_at IS NULL').get(input.id) as { reminder_time: string | null } | undefined
    if (!existing) throw new Error('Planned task not found')
    const reminderTime = input.reminderTime === undefined ? existing.reminder_time : normalizeReminderTime(input.reminderTime)
    const result = this.db.prepare('UPDATE planned_tasks SET title = ?, project_id = ?, notes = ?, reminder_time = ? WHERE id = ? AND completed_at IS NULL').run(
      title, input.projectId ?? null, input.notes?.trim() ?? '', reminderTime, input.id
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
    const deadline = normalizeDeadline(input.deadline)
    const budgetMinutes = normalizeBudgetMinutes(input.budgetHours)
    this.db.prepare('INSERT INTO projects (id, name, color, archived, status_id, type_id, sort_order, deadline, budget_minutes, created_at) VALUES (?, ?, ?, 0, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects), ?, ?, ?)').run(
      randomUUID(),
      name,
      input.color,
      input.statusId ?? null,
      input.typeId ?? null,
      deadline,
      budgetMinutes,
      Date.now()
    )
    return this.getSnapshot()
  }

  updateProject(input: ProjectUpdateInput): AppSnapshot {
    const name = input.name.trim()
    if (!name) throw new Error('Project name is required')
    if (this.projectNameExists(name, input.id)) throw new Error('A project with this name already exists')
    const result = this.db.prepare('UPDATE projects SET name = ?, color = ?, archived = COALESCE(?, archived), status_id = CASE WHEN ? THEN ? ELSE status_id END, type_id = CASE WHEN ? THEN ? ELSE type_id END, deadline = CASE WHEN ? THEN ? ELSE deadline END, budget_minutes = CASE WHEN ? THEN ? ELSE budget_minutes END WHERE id = ?').run(
      name,
      input.color,
      input.archived === undefined ? null : Number(input.archived),
      Number(input.statusId !== undefined),
      input.statusId ?? null,
      Number(input.typeId !== undefined),
      input.typeId ?? null,
      Number(input.deadline !== undefined),
      normalizeDeadline(input.deadline),
      Number(input.budgetHours !== undefined),
      normalizeBudgetMinutes(input.budgetHours),
      input.id
    )
    if (!result.changes) throw new Error('Project not found')
    return this.getSnapshot()
  }

  deleteProject(id: string): AppSnapshot {
    this.transaction(() => {
      this.db.prepare('UPDATE tasks SET project_id = NULL WHERE project_id = ?').run(id)
      this.db.prepare('UPDATE planned_tasks SET project_id = NULL WHERE project_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      if (!result.changes) throw new Error('Project not found')
    })
    return this.getSnapshot()
  }

  mergeProjects(sourceId: string, targetId: string): AppSnapshot {
    if (sourceId === targetId) throw new Error('Choose a different project to merge into')
    const exists = (id: string): boolean => Boolean(this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id))
    if (!exists(sourceId) || !exists(targetId)) throw new Error('Project not found')
    this.transaction(() => {
      this.db.prepare('UPDATE tasks SET project_id = ? WHERE project_id = ?').run(targetId, sourceId)
      this.db.prepare('UPDATE planned_tasks SET project_id = ? WHERE project_id = ?').run(targetId, sourceId)
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(sourceId)
    })
    return this.getSnapshot()
  }

  reorderProjects(ids: string[]): AppSnapshot {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new Error('Invalid project order')
    // The caller sends one view (active or archive). Put those projects into the slots they
    // already occupy in the full order, then renumber everything so positions never collide.
    const full = (this.db.prepare('SELECT id FROM projects ORDER BY archived, sort_order, created_at').all() as Array<{ id: string }>).map((row) => row.id)
    const known = new Set(full)
    const moved = [...new Set(ids)].filter((id) => known.has(id))
    const movedSet = new Set(moved)
    let next = 0
    const order = full.map((id) => movedSet.has(id) ? moved[next++] : id)
    this.transaction(() => {
      const update = this.db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?')
      order.forEach((id, index) => update.run(index, id))
    })
    return this.getSnapshot()
  }

  getProjectTasks(projectId: string): ProjectTaskSummary[] {
    const now = Date.now()
    this.normalizeStaleWorkday(now)
    const rows = this.db.prepare(
      `SELECT t.id, t.title, t.notes, t.status,
         COUNT(i.id) AS interval_count,
         COALESCE(SUM(MAX(0, MIN(COALESCE(i.ended_at, ?), ?) - i.started_at)), 0) AS total_ms,
         MIN(i.started_at) AS first_started_at,
         MAX(CASE WHEN i.id IS NULL THEN NULL ELSE COALESCE(i.ended_at, ?) END) AS last_ended_at
       FROM tasks t LEFT JOIN time_intervals i ON i.task_id = t.id
       WHERE t.project_id = ?
       GROUP BY t.id
       ORDER BY last_ended_at DESC, t.created_at DESC, t.id
       LIMIT 200`
    ).all(now, now, now, projectId) as Array<{ id: string; title: string; notes: string; status: Task['status']; interval_count: number; total_ms: number; first_started_at: number | null; last_ended_at: number | null }>
    return rows.map((row): ProjectTaskSummary => ({
      id: row.id,
      label: row.notes.trim() || row.title.trim(),
      status: row.status,
      totalMs: row.total_ms,
      intervalCount: row.interval_count,
      firstStartedAt: row.first_started_at,
      lastEndedAt: row.last_ended_at
    }))
  }

  getProjectStats(now = Date.now()): ProjectStats[] {
    this.normalizeStaleWorkday(now)
    const [todayStart] = localDayBounds(now)
    const weekStart = localDaysBefore(todayStart, 6)
    const closed = this.getClosedProjectRanges()
    const running = new Map<string, number[]>()
    for (const row of this.db.prepare(
      `SELECT t.project_id AS project_id, i.started_at AS started_at
       FROM time_intervals i JOIN tasks t ON t.id = i.task_id
       WHERE i.ended_at IS NULL AND t.project_id IS NOT NULL`
    ).all() as Array<{ project_id: string; started_at: number }>) {
      running.set(row.project_id, [...running.get(row.project_id) ?? [], row.started_at])
    }
    // Parallel tasks in one project overlap; count each moment only once. Closed ranges are
    // already merged, so only running intervals need folding in before clipping to now.
    const coverage = (ranges: Array<[number, number]>, starts: number[], lastEndedAt: number | null): { totalMs: number; todayMs: number; weekMs: number; lastWorkedAt: number | null } => {
      const result = { totalMs: 0, todayMs: 0, weekMs: 0, lastWorkedAt: lastEndedAt === null ? null : Math.min(lastEndedAt, now) }
      if (starts.length) result.lastWorkedAt = now
      const all = starts.length
        ? [...ranges, ...starts.map((start): [number, number] => [start, now])].sort((first, second) => first[0] - second[0])
        : ranges
      const add = (start: number, end: number): void => {
        result.totalMs += end - start
        result.weekMs += Math.max(0, end - Math.max(start, weekStart))
        result.todayMs += Math.max(0, end - Math.max(start, todayStart))
      }
      let current: [number, number] | undefined
      for (const [start, rawEnd] of all) {
        const end = Math.min(rawEnd, now)
        if (end <= start) continue
        if (current && start <= current[1]) current[1] = Math.max(current[1], end)
        else {
          if (current) add(current[0], current[1])
          current = [start, end]
        }
      }
      if (current) add(current[0], current[1])
      return result
    }
    const projects = this.db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
    return projects.map(({ id }): ProjectStats => {
      const entry = closed.get(id)
      return { projectId: id, ...coverage(entry?.ranges ?? [], running.get(id) ?? [], entry?.lastEndedAt ?? null), taskCount: entry?.taskCount ?? 0 }
    })
  }

  /**
   * Every project's closed intervals, merged. The full scan only reruns after tasks or
   * intervals change (the temp triggers bump tracking_version); running intervals are read fresh.
   */
  private getClosedProjectRanges(): ClosedProjectRanges {
    const { value: version } = this.db.prepare('SELECT value FROM tracking_version WHERE id = 1').get() as { value: number }
    if (this.closedRangesCache?.version === version) return this.closedRangesCache.grouped
    const rows = this.db.prepare(
      `SELECT t.project_id AS project_id, t.id AS task_id, i.started_at AS started_at, i.ended_at AS ended_at
       FROM tasks t LEFT JOIN time_intervals i ON i.task_id = t.id AND i.ended_at IS NOT NULL
       WHERE t.project_id IS NOT NULL ORDER BY t.project_id, i.started_at`
    ).all() as Array<{ project_id: string; task_id: string; started_at: number | null; ended_at: number | null }>
    const grouped: ClosedProjectRanges = new Map()
    const tasks = new Map<string, Set<string>>()
    for (const row of rows) {
      const entry = grouped.get(row.project_id) ?? { taskCount: 0, lastEndedAt: null, ranges: [] }
      grouped.set(row.project_id, entry)
      const projectTasks = tasks.get(row.project_id) ?? new Set<string>()
      tasks.set(row.project_id, projectTasks.add(row.task_id))
      entry.taskCount = projectTasks.size
      if (row.started_at === null || row.ended_at === null) continue
      entry.lastEndedAt = Math.max(entry.lastEndedAt ?? row.ended_at, row.ended_at)
      if (row.ended_at <= row.started_at) continue
      const last = entry.ranges.at(-1)
      if (last && row.started_at <= last[1]) last[1] = Math.max(last[1], row.ended_at)
      else entry.ranges.push([row.started_at, row.ended_at])
    }
    this.closedRangesCache = { version, grouped }
    return grouped
  }

  getWorkedCoverageToday(now = Date.now()): number {
    this.normalizeStaleWorkday(now)
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
    // Remember which tasks this stops, so continuing the day can bring exactly those back.
    const stoppedTaskIds = (this.db.prepare("SELECT id FROM tasks WHERE status != 'stopped'").all() as Array<{ id: string }>).map((task) => task.id)
    // A stale day closes at midnight, but anything opened after it (e.g. once an
    // overnight schedule was switched off) must not end before it began.
    this.db.prepare('UPDATE time_intervals SET ended_at = MAX(started_at, ?) WHERE ended_at IS NULL').run(endedAt)
    this.db.prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status != 'stopped'").run(endedAt)
    this.db.prepare('UPDATE workdays SET ended_at = MAX(started_at, ?), stopped_task_ids_json = ? WHERE ended_at IS NULL').run(endedAt, JSON.stringify(stoppedTaskIds))
    this.db.prepare('UPDATE rest_intervals SET ended_at = MAX(started_at, ?) WHERE ended_at IS NULL').run(endedAt)
    this.db.prepare("UPDATE rest_sessions SET status = 'completed', ended_at = MAX(created_at, ?), resume_task_ids_json = '[]' WHERE status IN ('running', 'paused')").run(endedAt)
  }

  private projectNameExists(name: string, excludedId?: string): boolean {
    const normalized = name.normalize('NFKC').toLocaleLowerCase()
    const projects = this.db.prepare('SELECT id, name FROM projects').all() as Array<{ id: string; name: string }>
    return projects.some((project) => project.id !== excludedId && project.name.normalize('NFKC').toLocaleLowerCase() === normalized)
  }

  private assertPlannedTaskCanBeAttached(id: string | null | undefined): void {
    if (!id) return
    const plannedTask = this.db.prepare('SELECT completed_at FROM planned_tasks WHERE id = ?').get(id) as { completed_at: number | null } | undefined
    if (!plannedTask) throw new Error('Planned task not found')
    if (plannedTask.completed_at !== null) throw new Error('This planned task is already completed')
  }

  private completePlannedTask(id: string, completedAt: number): void {
    this.db.prepare('UPDATE planned_tasks SET completed_at = ? WHERE id = ? AND completed_at IS NULL').run(completedAt, id)
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
