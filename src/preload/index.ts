import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/channels'
import type { AppSettings, AppSnapshot, GoogleSyncResult, HistoryDay, NotificationInput, NotificationSound, PlannedTaskInput, ProjectInput, ProjectUpdateInput, RestType, StartMode, StartTaskInput, TaskUpdateInput, VoiceInput, VoiceTaskDraft, WorkBuddyApi } from '../shared/types'

const api: WorkBuddyApi = {
  getSnapshot: () => ipcRenderer.invoke(channels.snapshot),
  getHistory: (days?: number): Promise<HistoryDay[]> => ipcRenderer.invoke(channels.history, days),
  getDaySnapshot: (date: string) => ipcRenderer.invoke(channels.daySnapshot, date),
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
  updateTask: (input: TaskUpdateInput) => ipcRenderer.invoke(channels.updateTask, input),
  deleteTask: (id: string) => ipcRenderer.invoke(channels.deleteTask, id),
  createPlannedTask: (input: PlannedTaskInput): Promise<AppSnapshot> => ipcRenderer.invoke(channels.createPlannedTask, input),
  deletePlannedTask: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke(channels.deletePlannedTask, id),
  createProject: (input: ProjectInput) => ipcRenderer.invoke(channels.createProject, input),
  updateProject: (input: ProjectUpdateInput) => ipcRenderer.invoke(channels.updateProject, input),
  updateSettings: (settings: AppSettings) => ipcRenderer.invoke(channels.updateSettings, settings),
  saveAiKey: (key: string) => ipcRenderer.invoke(channels.saveAiKey, key),
  connectGoogleCalendar: (clientId: string): Promise<AppSnapshot> => ipcRenderer.invoke(channels.googleConnect, clientId),
  disconnectGoogleCalendar: (): Promise<AppSnapshot> => ipcRenderer.invoke(channels.googleDisconnect),
  syncGoogleCalendar: (): Promise<GoogleSyncResult> => ipcRenderer.invoke(channels.googleSync),
  openGoogleCalendarSetup: () => ipcRenderer.invoke(channels.googleSetup),
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
