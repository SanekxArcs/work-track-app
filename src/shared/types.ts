export type Locale = 'uk' | 'en'
export type TaskStatus = 'running' | 'paused' | 'stopped'
export type StartMode = 'parallel' | 'switch'
export type RestType = 'lunch' | 'break'
export type RestStatus = 'running' | 'paused' | 'completed'
export type NotificationSound = 'system' | 'soft' | 'bell' | 'pop' | 'custom'
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
  workday: {
    startReminder: boolean
    startTime: string
    endReminder: boolean
    endTime: string
  }
  breaks: {
    enabled: boolean
    everyMinutes: number
    durationMinutes: number
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

export interface StartTaskInput {
  taskId?: string
  title?: string
  projectId?: string | null
  plannedTaskId?: string | null
  notes?: string
  tags?: string[]
  mode: StartMode
}

export interface TaskUpdateInput {
  id: string
  intervalId?: string
  title?: string
  projectId?: string | null
  plannedTaskId?: string | null
  notes?: string
  tags?: string[]
  startedAt?: number
  endedAt?: number
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
  getAppVersion: () => Promise<string>
  getSnapshot: () => Promise<AppSnapshot>
  getHistory: (days?: number) => Promise<HistoryDay[]>
  getDaySnapshot: (date: string) => Promise<AppSnapshot>
  getOvertimeOverview: () => Promise<OvertimeOverview>
  setOvertimeRedeemed: (date: string, redeemed: boolean) => Promise<OvertimeOverview>
  startWorkday: () => Promise<AppSnapshot>
  endWorkday: () => Promise<AppSnapshot>
  updateWorkdayStart: (startedAt: number) => Promise<AppSnapshot>
  resumeWorkday: () => Promise<AppSnapshot>
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
  transcribeVoice: (input: VoiceInput) => Promise<string>
  summarizeDay: () => Promise<AiDaySummary>
  notify: (input: NotificationInput) => Promise<void>
  setWindowMode: (mode: 'compact' | 'expanded' | 'docked', rows?: number) => Promise<'top' | 'bottom' | 'left' | 'right' | null>
  setWindowHeight: (height: number) => Promise<void>
  setWindowEditor: (open: boolean) => Promise<void>
  fitWindowToContent: (height: number) => Promise<void>
  setWindowView: (view: 'focus' | 'manual') => Promise<void>
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
