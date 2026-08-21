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

export interface Project {
  id: string
  name: string
  color: string
  archived: boolean
  createdAt: number
}

export interface PlannedTask {
  id: string
  title: string
  projectId: string | null
  notes: string
  createdAt: number
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
  ai: {
    enabled: boolean
    model: GeminiModel
    hasApiKey: boolean
  }
  googleCalendar: {
    clientId: string
    calendarId: string
    calendarName: string
    hasConnection: boolean
    syncOnDayEnd: boolean
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
  title?: string
  projectId?: string | null
  plannedTaskId?: string | null
  notes?: string
  tags?: string[]
  startedAt?: number
  endedAt?: number
}

export interface ProjectInput {
  name: string
  color: string
}

export interface ProjectUpdateInput {
  id: string
  name: string
  color: string
}

export interface PlannedTaskInput {
  title: string
  projectId?: string | null
  notes?: string
}

export interface NotificationInput {
  title: string
  body: string
}

export interface AiTaskSuggestion {
  title: string
  projectId: string | null
  tags: string[]
  note: string
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
  title: string | null
  projectId: string | null
  newProjectName: string | null
  notes: string | null
  tags: string[] | null
  startTime: string | null
  endTime: string | null
}

export interface GoogleSyncResult {
  created: number
  updated: number
  calendarName: string
}

export interface WorkBuddyApi {
  getSnapshot: () => Promise<AppSnapshot>
  getHistory: (days?: number) => Promise<HistoryDay[]>
  getDaySnapshot: (date: string) => Promise<AppSnapshot>
  startWorkday: () => Promise<AppSnapshot>
  endWorkday: () => Promise<AppSnapshot>
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
  updateTask: (input: TaskUpdateInput) => Promise<AppSnapshot>
  deleteTask: (id: string) => Promise<AppSnapshot>
  createPlannedTask: (input: PlannedTaskInput) => Promise<AppSnapshot>
  deletePlannedTask: (id: string) => Promise<AppSnapshot>
  createProject: (input: ProjectInput) => Promise<AppSnapshot>
  updateProject: (input: ProjectUpdateInput) => Promise<AppSnapshot>
  updateSettings: (settings: AppSettings) => Promise<AppSnapshot>
  saveAiKey: (key: string) => Promise<AppSnapshot>
  connectGoogleCalendar: (clientId: string) => Promise<AppSnapshot>
  disconnectGoogleCalendar: () => Promise<AppSnapshot>
  syncGoogleCalendar: () => Promise<GoogleSyncResult>
  openGoogleCalendarSetup: () => Promise<void>
  suggestTask: (taskId: string) => Promise<AiTaskSuggestion>
  interpretVoiceTask: (input: VoiceInput, taskId?: string) => Promise<VoiceTaskDraft>
  transcribeVoice: (input: VoiceInput) => Promise<string>
  summarizeDay: () => Promise<AiDaySummary>
  notify: (input: NotificationInput) => Promise<void>
  setWindowMode: (mode: 'compact' | 'expanded', rows?: number) => Promise<void>
  setWindowHeight: (height: number) => Promise<void>
  setWindowView: (view: 'focus' | 'manual') => Promise<void>
  chooseNotificationSound: () => Promise<{ path: string; name: string; dataUrl: string } | null>
  getCustomSoundData: () => Promise<string>
  minimizeToTray: () => Promise<void>
  onDataChanged: (callback: () => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  onPlaySound: (callback: (sound: NotificationSound, volume: number) => void) => () => void
}
