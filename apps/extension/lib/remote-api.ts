import type {
  AiDaySummary,
  AiTaskSuggestion,
  AppSettings,
  AppSnapshot,
  BackupImportMode,
  BackupPreview,
  ExtensionServerStatus,
  HistoryDay,
  NotificationInput,
  NotificationSound,
  OvertimeOverview,
  PlannedTaskInput,
  PlannedTaskUpdateInput,
  ProjectInput,
  ProjectUpdateInput,
  RestType,
  StartMode,
  StartTaskInput,
  TaskMergeInput,
  TaskUpdateInput,
  VoiceInput,
  VoiceTaskDraft,
  WorkBuddyApi
} from "../shared/types"

const baseUrl = "http://127.0.0.1:49837"
const accessKeyName = "workBuddyExtensionAccessKey"

function chromeGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => chrome.storage.local.get(key, (value) => resolve(value[key] as T | undefined)))
}

export type RemoteErrorCode = "offline" | "unauthorized" | "invalidated"

export class RemoteApiError extends Error {
  constructor(message: string, readonly code?: RemoteErrorCode) {
    super(message)
  }
}

export function remoteErrorCode(error: unknown): RemoteErrorCode | undefined {
  return error instanceof RemoteApiError ? error.code : undefined
}

// After the extension is reloaded or updated, scripts already injected into
// open pages lose their runtime and every message throws. Remember that so the
// pollers stop instead of rejecting every couple of seconds.
let contextInvalidated = false

function extensionContextAlive(): boolean {
  if (!contextInvalidated && !chrome.runtime?.id) contextInvalidated = true
  return !contextInvalidated
}

type BridgeMessage =
  | { scope: "work-buddy"; kind: "health" }
  | { scope: "work-buddy"; kind: "invoke"; method: string; args: unknown[] }
  | { scope: "work-buddy"; kind: "pair"; key: string }

async function send<T>(message: BridgeMessage): Promise<T> {
  if (!extensionContextAlive()) throw new RemoteApiError("Extension context invalidated", "invalidated")
  let response: { ok: boolean; result?: T; error?: string; code?: RemoteErrorCode } | undefined
  try {
    response = await chrome.runtime.sendMessage(message) as typeof response
  } catch (error) {
    const text = error instanceof Error ? error.message : ""
    if (!chrome.runtime?.id || text.includes("Extension context invalidated")) {
      contextInvalidated = true
      throw new RemoteApiError("Extension context invalidated", "invalidated")
    }
    throw new RemoteApiError(text || "Work Buddy is not running", "offline")
  }
  if (!response?.ok) throw new RemoteApiError(response?.error ?? "Work Buddy is not running", response ? response.code : "offline")
  return response.result as T
}

export async function getAccessKey(): Promise<string> {
  return (await chromeGet<string>(accessKeyName)) ?? ""
}

/** Checks the key with the desktop app; the background stores it only if it is accepted. */
export async function pairWithKey(key: string): Promise<void> {
  await send<null>({ scope: "work-buddy", kind: "pair", key: key.trim() })
}

export async function clearAccessKey(): Promise<void> {
  await new Promise<void>((resolve) => chrome.storage.local.remove(accessKeyName, resolve))
}

export async function getServerHealth(): Promise<ExtensionServerStatus> {
  return send<ExtensionServerStatus>({ scope: "work-buddy", kind: "health" })
}

async function invoke<T>(method: string, args: unknown[] = []): Promise<T> {
  return send<T>({ scope: "work-buddy", kind: "invoke", method, args })
}

function noOp(): Promise<void> { return Promise.resolve() }

export const remoteApi: WorkBuddyApi = {
  getAppVersion: () => invoke<string>("getAppVersion"),
  getSnapshot: () => invoke<AppSnapshot>("getSnapshot"),
  getHistory: (days?: number) => invoke<HistoryDay[]>("getHistory", days === undefined ? [] : [days]),
  getDaySnapshot: (date) => invoke<AppSnapshot>("getDaySnapshot", [date]),
  getOvertimeOverview: () => invoke<OvertimeOverview>("getOvertimeOverview"),
  setOvertimeRedeemed: (date, redeemed) => invoke<OvertimeOverview>("setOvertimeRedeemed", [date, redeemed]),
  startWorkday: () => invoke<AppSnapshot>("startWorkday"),
  endWorkday: () => invoke<AppSnapshot>("endWorkday"),
  startTask: (input: StartTaskInput) => invoke<AppSnapshot>("startTask", [input]),
  pauseTask: (id) => invoke<AppSnapshot>("pauseTask", [id]),
  resumeTask: (id, mode: StartMode) => invoke<AppSnapshot>("resumeTask", [id, mode]),
  stopTask: (id) => invoke<AppSnapshot>("stopTask", [id]),
  pauseAllTasks: () => invoke<AppSnapshot>("pauseAllTasks"),
  stopAllTasks: () => invoke<AppSnapshot>("stopAllTasks"),
  startRest: (type: RestType) => invoke<AppSnapshot>("startRest", [type]),
  pauseRest: (id) => invoke<AppSnapshot>("pauseRest", [id]),
  resumeRest: (id) => invoke<AppSnapshot>("resumeRest", [id]),
  completeRest: (id) => invoke<AppSnapshot>("completeRest", [id]),
  skipRest: (type: RestType) => invoke<AppSnapshot>("skipRest", [type]),
  updateRestStart: (id, startedAt) => invoke<AppSnapshot>("updateRestStart", [id, startedAt]),
  setRestAlarmMuted: (id, muted) => invoke<AppSnapshot>("setRestAlarmMuted", [id, muted]),
  updateTask: (input: TaskUpdateInput) => invoke<AppSnapshot>("updateTask", [input]),
  mergeTasks: (input: TaskMergeInput) => invoke<AppSnapshot>("mergeTasks", [input]),
  deleteTask: (id) => invoke<AppSnapshot>("deleteTask", [id]),
  createPlannedTask: (input: PlannedTaskInput) => invoke<AppSnapshot>("createPlannedTask", [input]),
  updatePlannedTask: (input: PlannedTaskUpdateInput) => invoke<AppSnapshot>("updatePlannedTask", [input]),
  deletePlannedTask: (id) => invoke<AppSnapshot>("deletePlannedTask", [id]),
  createProject: (input: ProjectInput) => invoke<AppSnapshot>("createProject", [input]),
  updateProject: (input: ProjectUpdateInput) => invoke<AppSnapshot>("updateProject", [input]),
  updateSettings: (settings: AppSettings) => invoke<AppSnapshot>("updateSettings", [settings]),
  saveAiKey: (key) => invoke<AppSnapshot>("saveAiKey", [key]),
  exportBackup: () => invoke<{ path: string } | null>("exportBackup"),
  chooseBackupImport: () => invoke<BackupPreview | null>("chooseBackupImport"),
  applyBackupImport: (mode: BackupImportMode) => invoke<AppSnapshot>("applyBackupImport", [mode]),
  exportDayCalendar: (date) => invoke<{ path: string } | null>("exportDayCalendar", [date]),
  suggestTask: (taskId) => invoke<AiTaskSuggestion>("suggestTask", [taskId]),
  interpretVoiceTask: (input: VoiceInput, taskId?: string) => invoke<VoiceTaskDraft>("interpretVoiceTask", [input, taskId]),
  transcribeVoice: (input: VoiceInput) => invoke<string>("transcribeVoice", [input]),
  summarizeDay: () => invoke<AiDaySummary>("summarizeDay"),
  notify: (input: NotificationInput) => invoke<void>("notify", [input]),
  setWindowMode: () => Promise.resolve(null),
  setWindowHeight: noOp,
  setWindowEditor: noOp,
  fitWindowToContent: noOp,
  setWindowView: noOp,
  chooseNotificationSound: () => invoke<{ path: string; name: string; dataUrl: string } | null>("chooseNotificationSound"),
  getCustomSoundData: () => invoke<string>("getCustomSoundData"),
  minimizeToTray: async () => { window.dispatchEvent(new Event("work-buddy-extension-hide")) },
  getExtensionServerStatus: getServerHealth,
  getExtensionAccessKey: getAccessKey,
  onExtensionServerStatus: (callback) => {
    const timer = window.setInterval(() => {
      if (!extensionContextAlive()) {
        window.clearInterval(timer)
        return
      }
      void getServerHealth().then(callback).catch(() => undefined)
    }, 8_000)
    return () => window.clearInterval(timer)
  },
  onDataChanged: (callback) => {
    const timer = window.setInterval(() => {
      if (!extensionContextAlive()) {
        window.clearInterval(timer)
        return
      }
      callback()
    }, 2_000)
    return () => window.clearInterval(timer)
  },
  onOpenSettings: () => () => undefined,
  onPlaySound: (_callback: (sound: NotificationSound, volume: number) => void) => () => undefined
}
