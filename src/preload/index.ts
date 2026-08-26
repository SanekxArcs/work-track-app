import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/channels'
import type { AppSettings, AppSnapshot, BackupImportMode, BackupPreview, GoogleSyncResult, HistoryDay, NotificationInput, NotificationSound, OvertimeOverview, PlannedTaskInput, PlannedTaskUpdateInput, ProjectInput, ProjectUpdateInput, RestType, SanitySyncResult, StartMode, StartTaskInput, TaskMergeInput, TaskUpdateInput, VoiceInput, VoiceTaskDraft, WorkBuddyApi } from '../shared/types'

const api: WorkBuddyApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(channels.appVersion),
  getSnapshot: () => ipcRenderer.invoke(channels.snapshot),
  getHistory: (days?: number): Promise<HistoryDay[]> => ipcRenderer.invoke(channels.history, days),
  getDaySnapshot: (date: string) => ipcRenderer.invoke(channels.daySnapshot, date),
  getOvertimeOverview: (): Promise<OvertimeOverview> => ipcRenderer.invoke(channels.overtimeOverview),
  setOvertimeRedeemed: (date: string, redeemed: boolean): Promise<OvertimeOverview> => ipcRenderer.invoke(channels.overtimeRedeemed, date, redeemed),
  startWorkday: () => ipcRenderer.invoke(channels.startWorkday),
  endWorkday: () => ipcRenderer.invoke(channels.endWorkday),
  startTask: (input: StartTaskInput) => ipcRenderer.invoke(channels.startTask, input),
  pauseTask: (id: string) => ipcRenderer.invoke(channels.pauseTask, id),
  resumeTask: (id: string, mode: StartMode) => ipcRenderer.invoke(channels.resumeTask, id, mode),
  stopTask: (id: string) => ipcRenderer.invoke(channels.stopTask, id),
  pauseAllTasks: () => ipcRenderer.invoke(channels.pauseAllTasks),
  stopAllTasks: () => ipcRenderer.invoke(channels.stopAllTasks),
  startRest: (type: RestType) => ipcRenderer.invoke(channels.startRest, type),
  pauseRest: (id: string) => ipcRenderer.invoke(channels.pauseRest, id),
  resumeRest: (id: string) => ipcRenderer.invoke(channels.resumeRest, id),
  completeRest: (id: string) => ipcRenderer.invoke(channels.completeRest, id),
  skipRest: (type: RestType) => ipcRenderer.invoke(channels.skipRest, type),
  updateRestStart: (id: string, startedAt: number) => ipcRenderer.invoke(channels.updateRestStart, id, startedAt),
  setRestAlarmMuted: (id: string, muted: boolean): Promise<AppSnapshot> => ipcRenderer.invoke(channels.setRestAlarmMuted, id, muted),
  updateTask: (input: TaskUpdateInput) => ipcRenderer.invoke(channels.updateTask, input),
  mergeTasks: (input: TaskMergeInput): Promise<AppSnapshot> => ipcRenderer.invoke(channels.mergeTasks, input),
  deleteTask: (id: string) => ipcRenderer.invoke(channels.deleteTask, id),
  createPlannedTask: (input: PlannedTaskInput): Promise<AppSnapshot> => ipcRenderer.invoke(channels.createPlannedTask, input),
  updatePlannedTask: (input: PlannedTaskUpdateInput): Promise<AppSnapshot> => ipcRenderer.invoke(channels.updatePlannedTask, input),
  deletePlannedTask: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke(channels.deletePlannedTask, id),
  createProject: (input: ProjectInput) => ipcRenderer.invoke(channels.createProject, input),
  updateProject: (input: ProjectUpdateInput) => ipcRenderer.invoke(channels.updateProject, input),
  updateSettings: (settings: AppSettings) => ipcRenderer.invoke(channels.updateSettings, settings),
  saveAiKey: (key: string) => ipcRenderer.invoke(channels.saveAiKey, key),
  connectGoogleCalendar: (clientId: string): Promise<AppSnapshot> => ipcRenderer.invoke(channels.googleConnect, clientId),
  disconnectGoogleCalendar: (): Promise<AppSnapshot> => ipcRenderer.invoke(channels.googleDisconnect),
  syncGoogleCalendar: (): Promise<GoogleSyncResult> => ipcRenderer.invoke(channels.googleSync),
  openGoogleCalendarSetup: () => ipcRenderer.invoke(channels.googleSetup),
  syncSanity: (): Promise<SanitySyncResult> => ipcRenderer.invoke(channels.sanitySync),
  loadSanityEnvironment: (): Promise<AppSnapshot | null> => ipcRenderer.invoke(channels.sanityLoadEnvironment),
  exportBackup: (): Promise<{ path: string } | null> => ipcRenderer.invoke(channels.backupExport),
  chooseBackupImport: (): Promise<BackupPreview | null> => ipcRenderer.invoke(channels.backupChoose),
  applyBackupImport: (mode: BackupImportMode): Promise<AppSnapshot> => ipcRenderer.invoke(channels.backupApply, mode),
  exportDayCalendar: (date: string): Promise<{ path: string } | null> => ipcRenderer.invoke(channels.calendarExportDay, date),
  suggestTask: (taskId: string) => ipcRenderer.invoke(channels.suggestTask, taskId),
  interpretVoiceTask: (input: VoiceInput, taskId?: string): Promise<VoiceTaskDraft> => ipcRenderer.invoke(channels.interpretVoiceTask, input, taskId),
  transcribeVoice: (input: VoiceInput): Promise<string> => ipcRenderer.invoke(channels.transcribeVoice, input),
  summarizeDay: () => ipcRenderer.invoke(channels.summarizeDay),
  notify: (input: NotificationInput) => ipcRenderer.invoke(channels.notify, input),
  setWindowMode: (mode, rows) => ipcRenderer.invoke(channels.windowMode, mode, rows),
  setWindowHeight: (height: number) => ipcRenderer.invoke(channels.windowHeight, height),
  setWindowView: (view) => ipcRenderer.invoke(channels.windowView, view),
  chooseNotificationSound: () => ipcRenderer.invoke(channels.chooseSound),
  getCustomSoundData: () => ipcRenderer.invoke(channels.soundData),
  minimizeToTray: () => ipcRenderer.invoke(channels.minimize),
  onDataChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(channels.dataChanged, listener)
    return () => ipcRenderer.removeListener(channels.dataChanged, listener)
  },
  onOpenSettings: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(channels.openSettings, listener)
    return () => ipcRenderer.removeListener(channels.openSettings, listener)
  },
  onPlaySound: (callback: (sound: NotificationSound, volume: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sound: NotificationSound, volume: number): void => callback(sound, volume)
    ipcRenderer.on(channels.playSound, listener)
    return () => ipcRenderer.removeListener(channels.playSound, listener)
  }
}

contextBridge.exposeInMainWorld('workBuddy', api)
