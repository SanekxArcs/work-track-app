export type Locale = 'uk' | 'en'
export type TaskStatus = 'running' | 'paused' | 'stopped'
export type StartMode = 'parallel' | 'switch'
export type RestType = 'lunch' | 'break'
export type RestStatus = 'running' | 'paused' | 'completed'
export type NotificationSound = 'system' | 'soft' | 'bell' | 'pop' | 'custom'
/** How the collapsed notch pill expands: after hovering for a while, or only on click. */
export type NotchOpenMode = 'hover' | 'click'
/** Icon-only quick actions shown inside the collapsed notch pill. */
export type NotchAction = 'day' | 'lunch' | 'break' | 'parallel' | 'switch' | 'hide'
export interface NotchSettings {
  openOn: NotchOpenMode
  /** How long the pointer must rest on the pill before it opens (hover mode only). */
  hoverDelayMs: number
  /** How long the "hide" quick action tucks the notch away so whatever sits under it can be clicked. */
  hideSeconds: number
  actions: Record<NotchAction, boolean>
}
export type GeminiModel =
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.5-flash-lite'
  | 'gemini-3.1-flash-lite'

export interface ProjectStatus {
  id: string
  name: string
  color: string
}

export interface ProjectType {
  id: string
  name: string
  color: string
}

export interface Project {
  id: string
  name: string
  color: string
  /** A completed project. Archived projects are hidden from pickers until searched for. */
  archived: boolean
  statusId?: string | null
  typeId?: string | null
  /** Optional due date as a local YYYY-MM-DD string. */
  deadline?: string | null
  /** Optional time budget in hours. */
  budgetHours?: number | null
  /** Priority position (lower first); carried in backups so manual ordering survives a restore. */
  sortOrder?: number
  createdAt: number
}

export interface ProjectTaskSummary {
  id: string
  label: string
  status: TaskStatus
  totalMs: number
  intervalCount: number
  firstStartedAt: number | null
  lastEndedAt: number | null
}

export interface ProjectStats {
  projectId: string
  totalMs: number
  todayMs: number
  weekMs: number
  taskCount: number
  lastWorkedAt: number | null
}

export interface PlannedTask {
  id: string
  title: string
  projectId: string | null
  notes: string
  /** Local clock time (HH:MM) for a daily reminder, or null when no reminder is set. */
  reminderTime: string | null
  createdAt: number
  /** Undefined is accepted only when importing backups created before completion tracking. */
  completedAt?: number | null
}

export interface TimeInterval {
  id: string
  taskId: string
  startedAt: number
  endedAt: number | null
}

export interface Task {
  id: string
  title: string
  projectId: string | null
  plannedTaskId: string | null
  notes: string
  tags: string[]
  status: TaskStatus
  createdAt: number
  updatedAt: number
  intervals: TimeInterval[]
}

export interface Workday {
  id: string
  startedAt: number
  endedAt: number | null
  /** Schedule length and lunch allowance captured for this day, so later settings changes leave it alone. */
  scheduledMinutes?: number | null
  lunchMinutes?: number | null
  breakMinutes?: number | null
  /** Earlier finished workdays on the same calendar day; together they share one daily allowance. */
  earlierSessions?: Array<{ startedAt: number; endedAt: number }>
}

export interface RestInterval {
  id: string
  restId: string
  startedAt: number
  endedAt: number | null
}

export interface RestSession {
  id: string
  type: RestType
  status: RestStatus
  plannedMinutes: number
  alarmMuted: boolean
  /** Tasks paused automatically when this running rest began. */
  resumeTaskIds?: string[]
  createdAt: number
  endedAt: number | null
  intervals: RestInterval[]
}

export interface WellnessAction {
  id: string
  labelUk: string
  labelEn: string
  enabled: boolean
}

export interface AppSettings {
  locale: Locale
  theme: 'dark' | 'light' | 'system'
  alwaysOnTop: boolean
  autoStart: boolean
  globalShortcut: string
  /** Offers a notch-style pill at the top centre of the screen in place of the compact window. */
  notchEnabled: boolean
  /** Resizes the window to fit the page whenever its content changes. */
  autoFitHeight: boolean
  notch: NotchSettings
  /** Project that instantly started tasks belong to until they are edited; null starts them without one. */
  defaultProjectId: string | null
  compact: {
    /** How long the pointer rests on the compact window before the other tasks slide out. */
    revealDelayMs: number
  }
  pomodoro: {
    /** Shows a focus countdown to the next micro-break on the Focus tab. */
    enabled: boolean
    /** Starts the micro-break by itself when the countdown runs out. */
    autoStartBreak: boolean
  }
  workday: {
    startReminder: boolean
    startTime: string
    endReminder: boolean
    endTime: string
    /** Weekdays the start-of-day reminder applies to, as JS getDay() values (0 = Sunday). */
    days: number[]
  }
  breaks: {
    enabled: boolean
    everyMinutes: number
    durationMinutes: number
    dailyMinutes: number
  }
  lunch: {
    enabled: boolean
    mode: 'clock' | 'worked'
    time: string
    afterMinutes: number
    durationMinutes: number
    includedInWorkHours: boolean
  }
  idle: {
    enabled: boolean
    thresholdMinutes: number
  }
  notifications: {
    sound: NotificationSound
    volume: number
    customSoundPath: string
    customSoundName: string
  }
  wellnessEnabled: boolean
  wellnessActions: WellnessAction[]
  projectColors: string[]
  projectStatuses: ProjectStatus[]
  projectTypes: ProjectType[]
  ai: {
    enabled: boolean
    model: GeminiModel
    hasApiKey: boolean
  }
}

/** notch is the collapsed pill at the top or bottom edge of the screen; notch-open is it expanded on hover. */
export type WindowMode = 'compact' | 'expanded' | 'docked' | 'notch' | 'notch-open'

export interface AppSnapshot {
  projects: Project[]
  plannedTasks: PlannedTask[]
  tasks: Task[]
  workday: Workday | null
  rests: RestSession[]
  settings: AppSettings
  now: number
}

export interface HistoryDay {
  date: string
  workedMs: number
  taskCount: number
  projectCount: number
  startedAt: number | null
  endedAt: number | null
}

export interface OvertimeDay {
  date: string
  overtimeMs: number
  redeemed: boolean
}

export interface OvertimeOverview {
  balanceMs: number
  days: OvertimeDay[]
}

/** A stretch without keyboard or mouse input (or with the PC asleep) while a task was running. */
export interface IdlePeriod {
  startedAt: number
  endedAt: number
}

/** discard cuts the idle stretch out of the running tasks; break also records it as a completed micro-break. */
export type IdleResolution = 'discard' | 'break'

export interface WeekReportDay {
  date: string
  workedMs: number
  breakMs: number
  lunchMs: number
  overtimeMs: number
}

export interface WeekReportProject {
  projectId: string | null
  ms: number
}

export interface WeekReport {
  /** Monday of the week as a local YYYY-MM-DD string. */
  weekStart: string
  days: WeekReportDay[]
  /** Worked time per project, most first; null groups tasks without a project. */
  projects: WeekReportProject[]
  totalMs: number
  /** The same measure for the week before, for the trend. */
  previousTotalMs: number
  breakMs: number
  lunchMs: number
  overtimeMs: number
}

export interface StartTaskInput {
  taskId?: string
  title?: string
  projectId?: string | null
  plannedTaskId?: string | null
  notes?: string
  tags?: string[]
  mode: StartMode
}

export type TaskIntervalOperation = { type: 'delete'; id: string } | { type: 'merge'; firstId: string; secondId: string }

export interface TaskUpdateInput {
  id: string
  intervalOperations?: TaskIntervalOperation[]
  intervalUpdates?: Array<{ id: string; startedAt?: number; endedAt?: number }>
  intervalId?: string
  title?: string
  projectId?: string | null
  plannedTaskId?: string | null
  notes?: string
  tags?: string[]
  startedAt?: number
  endedAt?: number
}

export interface TaskSplitInput {
  id: string
  splitAt: number
  expectedUpdatedAt: number
  first: { projectId: string | null; notes: string }
  second: { projectId: string | null; notes: string }
}

export interface TaskMergeInput {
  targetId: string
  sourceIds: string[]
  date: string
}

export interface ProjectInput {
  name: string
  color: string
  statusId?: string | null
  typeId?: string | null
  deadline?: string | null
  budgetHours?: number | null
}

export interface ProjectUpdateInput {
  id: string
  name: string
  color: string
  archived?: boolean
  /** Undefined keeps the current status; null clears it. */
  statusId?: string | null
  typeId?: string | null
  /** Undefined keeps the current value; null clears it. */
  deadline?: string | null
  budgetHours?: number | null
}

export interface PlannedTaskInput {
  title: string
  projectId?: string | null
  notes?: string
  reminderTime?: string | null
}

export interface PlannedTaskUpdateInput {
  id: string
  title: string
  projectId?: string | null
  notes?: string
  reminderTime?: string | null
}

export interface NotificationInput {
  title: string
  body: string
}

export interface AiTaskSuggestion {
  projectId: string | null
  notes: string
}

export interface AiDaySummary {
  summary: string
}

export interface VoiceInput {
  data: string
  mimeType: string
}

export interface VoiceTaskDraft {
  transcript: string
  projectId: string | null
  newProjectName: string | null
  notes: string | null
  startTime: string | null
  endTime: string | null
}

export type BackupImportMode = 'merge' | 'replace'

export interface BackupData {
  schemaVersion: 1
  exportedAt: number
  settings: Omit<AppSettings, 'ai'>
  projects: Project[]
  plannedTasks: PlannedTask[]
  tasks: Task[]
  workdays: Workday[]
  rests: RestSession[]
  overtimeRedeemedDates?: string[]
}

export interface BackupPreview {
  exportedAt: number
  projectCount: number
  plannedTaskCount: number
  taskCount: number
  intervalCount: number
  workdayCount: number
  restCount: number
}

export interface ExtensionServerStatus {
  running: boolean
  port: number
  connections: number
  error: string | null
}

export interface WorkBuddyApi {
  getConvexSyncStatus: () => Promise<import('./convex-sync').ConvexSyncStatus>
  configureConvexSync: (config: import('./convex-sync').ConvexSyncConfig, key?: string) => Promise<import('./convex-sync').ConvexSyncStatus>
  syncConvexNow: () => Promise<import('./convex-sync').ConvexSyncStatus>
  getAppVersion: () => Promise<string>
  /** Opens a trusted https link in the system browser; unknown hosts are refused by the main process. */
  openExternal: (url: string) => Promise<void>
  getSnapshot: () => Promise<AppSnapshot>
  getHistory: (days?: number) => Promise<HistoryDay[]>
  getDaySnapshot: (date: string) => Promise<AppSnapshot>
  getOvertimeOverview: () => Promise<OvertimeOverview>
  setOvertimeRedeemed: (date: string, redeemed: boolean) => Promise<OvertimeOverview>
  getWeekReport: (weekStart: string) => Promise<WeekReport>
  /** The idle stretch the main process noticed and the user has not answered yet. */
  getPendingIdle: () => Promise<IdlePeriod | null>
  resolveIdle: (period: IdlePeriod, resolution: IdleResolution) => Promise<AppSnapshot>
  dismissIdle: () => Promise<void>
  onIdleDetected: (callback: (period: IdlePeriod) => void) => () => void
  startWorkday: () => Promise<AppSnapshot>
  endWorkday: () => Promise<AppSnapshot>
  updateWorkdayStart: (startedAt: number) => Promise<AppSnapshot>
  resumeWorkday: () => Promise<AppSnapshot>
  resetWorkday: (workdayId: string) => Promise<AppSnapshot>
  getProjectStats: () => Promise<ProjectStats[]>
  getProjectTasks: (projectId: string) => Promise<ProjectTaskSummary[]>
  deleteProject: (id: string) => Promise<AppSnapshot>
  mergeProjects: (sourceId: string, targetId: string) => Promise<AppSnapshot>
  reorderProjects: (ids: string[]) => Promise<AppSnapshot>
  startTask: (input: StartTaskInput) => Promise<AppSnapshot>
  pauseTask: (id: string) => Promise<AppSnapshot>
  resumeTask: (id: string, mode: StartMode) => Promise<AppSnapshot>
  stopTask: (id: string) => Promise<AppSnapshot>
  pauseAllTasks: () => Promise<AppSnapshot>
  stopAllTasks: () => Promise<AppSnapshot>
  startRest: (type: RestType) => Promise<AppSnapshot>
  pauseRest: (id: string) => Promise<AppSnapshot>
  resumeRest: (id: string) => Promise<AppSnapshot>
  completeRest: (id: string) => Promise<AppSnapshot>
  skipRest: (type: RestType) => Promise<AppSnapshot>
  updateRestStart: (id: string, startedAt: number) => Promise<AppSnapshot>
  setRestAlarmMuted: (id: string, muted: boolean) => Promise<AppSnapshot>
  updateTask: (input: TaskUpdateInput) => Promise<AppSnapshot>
  splitTask: (input: TaskSplitInput) => Promise<AppSnapshot>
  mergeTasks: (input: TaskMergeInput) => Promise<AppSnapshot>
  deleteTask: (id: string) => Promise<AppSnapshot>
  createPlannedTask: (input: PlannedTaskInput) => Promise<AppSnapshot>
  updatePlannedTask: (input: PlannedTaskUpdateInput) => Promise<AppSnapshot>
  deletePlannedTask: (id: string) => Promise<AppSnapshot>
  createProject: (input: ProjectInput) => Promise<AppSnapshot>
  updateProject: (input: ProjectUpdateInput) => Promise<AppSnapshot>
  updateSettings: (settings: AppSettings) => Promise<AppSnapshot>
  setGlobalShortcut: (shortcut: string) => Promise<AppSnapshot>
  saveAiKey: (key: string) => Promise<AppSnapshot>
  exportBackup: () => Promise<{ path: string } | null>
  chooseBackupImport: () => Promise<BackupPreview | null>
  applyBackupImport: (mode: BackupImportMode) => Promise<AppSnapshot>
  exportDayCalendar: (date: string) => Promise<{ path: string } | null>
  exportRangeCalendar: (from: string, to: string) => Promise<{ path: string } | null>
  suggestTask: (taskId: string) => Promise<AiTaskSuggestion>
  interpretVoiceTask: (input: VoiceInput, taskId?: string) => Promise<VoiceTaskDraft>
  interpretPlannedVoice: (input: VoiceInput) => Promise<VoiceTaskDraft>
  transcribeVoice: (input: VoiceInput) => Promise<string>
  summarizeDay: () => Promise<AiDaySummary>
  notify: (input: NotificationInput) => Promise<void>
  /** For the collapsed notch, pillWidth is the painted pill width the window must fit (plus its flared corners). */
  setWindowMode: (mode: WindowMode, rows?: number, pillWidth?: number) => Promise<'top' | 'bottom' | 'left' | 'right' | null>
  /** Drags the notch along the top or bottom edge; the main process follows the cursor. */
  dragNotch: (phase: 'start' | 'move' | 'end') => Promise<void>
  setNotchSurface: (rect: { x: number; y: number; width: number; height: number; radius?: number }) => Promise<void>
  onNotchEdge:(callback:(edge:'top'|'bottom')=>void)=>()=>void
  onNotchTravel: (callback: (hidden: boolean) => void) => () => void
  /** Whether the cursor is over the open notch, watched by the main process so leaving always registers. */
  onNotchPointer: (callback: (inside: boolean) => void) => () => void
  setWindowHeight: (height: number) => Promise<void>
  setWindowEditor: (open: boolean) => Promise<void>
  fitWindowToContent: (height: number) => Promise<void>
  chooseNotificationSound: () => Promise<{ path: string; name: string; dataUrl: string } | null>
  getCustomSoundData: () => Promise<string>
  minimizeToTray: () => Promise<void>
  getExtensionServerStatus: () => Promise<ExtensionServerStatus>
  getExtensionAccessKey: () => Promise<string>
  onExtensionServerStatus: (callback: (status: ExtensionServerStatus) => void) => () => void
  onDataChanged: (callback: () => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  onDockSide: (callback: (side: 'left' | 'right') => void) => () => void
  onPlaySound: (callback: (sound: NotificationSound, volume: number) => void) => () => void
}
