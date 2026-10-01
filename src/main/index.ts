import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray } from 'electron'
import { WorkBuddyDatabase } from './database'
import { GeminiService } from './gemini'
import { ReminderService } from './reminders'
import { WORK_BUDDY_LOCAL_PORT, WorkBuddyLocalServer } from './local-server'
import { fitWindowHeight, isBottomAnchored } from './window-layout'
import { localDateKey } from '../shared/local-date'
import { channels } from '../shared/channels'
import type { AppSettings, AppSnapshot, BackupData, BackupImportMode, NotificationInput, PlannedTaskInput, PlannedTaskUpdateInput, ProjectInput, ProjectUpdateInput, RestType, StartMode, StartTaskInput, TaskMergeInput, TaskUpdateInput, VoiceInput } from '../shared/types'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let database: WorkBuddyDatabase
let reminders: ReminderService
let gemini: GeminiService
let localServer: WorkBuddyLocalServer | null = null
let pendingBackup: BackupData | null = null
let snapTimer: NodeJS.Timeout | undefined
let applyingSnap = false
let compactWindow = false
let manualHeight = 760
let programmaticHeight: number | undefined
let compactBottomAnchored = false
let editorRestoreBounds: Electron.Rectangle | null = null
let registeredToggleShortcut: string | null = null
let dockedSide: 'left' | 'right' | null = null
let dockRestoreBounds: Electron.Rectangle | null = null
let dockRestoreSide: 'left' | 'right' | null = null

const WINDOW_WIDTH = 430
const DOCK_SIZE = { width: 104, height: 46 }

function overlapArea(a: Electron.Rectangle, b: Electron.Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function snapWindowToScreen(): void {
  if (!mainWindow || applyingSnap) return
  const bounds = mainWindow.getBounds()
  const displays = screen.getAllDisplays()
  const display = displays.reduce((best, candidate) =>
    overlapArea(bounds, candidate.workArea) > overlapArea(bounds, best.workArea) ? candidate : best,
  screen.getDisplayNearestPoint({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) }))
  const area = display.workArea
  const magnet = 16
  if (dockedSide) {
    // A docked pill can be dragged anywhere; on release it sticks to the nearer side edge.
    const side = bounds.x + bounds.width / 2 < area.x + area.width / 2 ? 'left' : 'right'
    if (side !== dockedSide) {
      dockedSide = side
      mainWindow.webContents.send(channels.dockSide, side)
    }
  }
  let x = dockedSide === 'left' ? area.x : dockedSide === 'right' ? area.x + area.width - bounds.width : Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width)
  let y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height)
  if (Math.abs(bounds.x - area.x) <= magnet) x = area.x
  if (Math.abs(bounds.x + bounds.width - (area.x + area.width)) <= magnet) x = area.x + area.width - bounds.width
  if (Math.abs(bounds.y - area.y) <= magnet) y = area.y
  if (Math.abs(bounds.y + bounds.height - (area.y + area.height)) <= magnet) y = area.y + area.height - bounds.height
  if (x === bounds.x && y === bounds.y) return
  applyingSnap = true
  mainWindow.setPosition(x, y, true)
  applyingSnap = false
}

function scheduleSnap(): void {
  if (applyingSnap) return
  if (snapTimer) clearTimeout(snapTimer)
  snapTimer = setTimeout(snapWindowToScreen, 110)
}

async function audioDataUrl(path: string): Promise<string> {
  const extension = extname(path).toLowerCase()
  const mime = ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac' } as Record<string, string>)[extension]
  if (!mime) throw new Error('Unsupported audio format')
  const data = await readFile(path)
  if (data.length > 15 * 1024 * 1024) throw new Error('Audio file must be smaller than 15 MB')
  return `data:${mime};base64,${data.toString('base64')}`
}

function createTrayIcon(): Electron.NativeImage {
  const size = 16
  const buffer = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const dx = x - 7.5
      const dy = y - 7.5
      const inside = dx * dx + dy * dy <= 52
      const play = x >= 6 && x <= 11 && y >= 4 && y <= 12 && x - 5 >= Math.abs(y - 8) * 0.65
      buffer[offset] = inside ? (play ? 245 : 70) : 0
      buffer[offset + 1] = inside ? (play ? 249 : 229) : 0
      buffer[offset + 2] = inside ? (play ? 238 : 175) : 0
      buffer[offset + 3] = inside ? 255 : 0
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size })
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) mainWindow.hide()
  else {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
  }
}

function registerToggleShortcut(shortcut: string): void {
  if (registeredToggleShortcut === shortcut && globalShortcut.isRegistered(shortcut)) return
  let registered = false
  try {
    registered = globalShortcut.register(shortcut, toggleWindow)
  } catch {
    registered = false
  }
  if (!registered) throw new Error('The selected global shortcut is unavailable.')
  if (registeredToggleShortcut && registeredToggleShortcut !== shortcut) globalShortcut.unregister(registeredToggleShortcut)
  registeredToggleShortcut = shortcut
}

function applyAppSettings(settings: AppSettings, ensureGlobalShortcut = false): AppSnapshot {
  const current = database.getSettings()
  if (current.globalShortcut !== settings.globalShortcut || (ensureGlobalShortcut && !globalShortcut.isRegistered(settings.globalShortcut))) registerToggleShortcut(settings.globalShortcut)
  const result = database.updateSettings(settings)
  app.setLoginItemSettings({ openAtLogin: result.settings.autoStart })
  mainWindow?.setAlwaysOnTop(result.settings.alwaysOnTop, result.settings.alwaysOnTop ? 'pop-up-menu' : 'normal')
  updateTrayMenu()
  return result
}

function updateTrayMenu(): void {
  if (!tray) return
  const locale = database.getSettings().locale
  const labels = locale === 'uk'
    ? { show: 'Показати Work Buddy', settings: 'Налаштування', quit: 'Вийти' }
    : { show: 'Show Work Buddy', settings: 'Settings', quit: 'Quit' }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: labels.show, click: toggleWindow },
    {
      label: labels.settings,
      click: () => {
        mainWindow?.show()
        mainWindow?.webContents.send(channels.openSettings)
      }
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]))
}

function createWindow(): void {
  const display = screen.getPrimaryDisplay()
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea
  const width = WINDOW_WIDTH
  const height = Math.min(760, areaHeight - 40)
  manualHeight = height

  mainWindow = new BrowserWindow({
    width,
    height,
    x: areaX + areaWidth - width - 22,
    y: areaY + 22,
    minWidth: width,
    minHeight: 64,
    maxWidth: width,
    maxHeight: areaHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: database.getSettings().alwaysOnTop,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (database.getSettings().alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'pop-up-menu')

  // The renderer exposes a deliberately small IPC bridge. Never let an
  // accidental link or popup replace it with untrusted web content.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('move', scheduleSnap)
  mainWindow.on('resize', () => {
    if (!compactWindow && mainWindow) {
      const nextHeight = mainWindow.getBounds().height
      if (programmaticHeight === nextHeight) {
        programmaticHeight = undefined
        return
      }
      manualHeight = nextHeight
    }
  })
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function emitChanged(): void {
  mainWindow?.webContents.send(channels.dataChanged)
  localServer?.notifyChanged()
}

function extensionAccessKey(): string {
  const stored = database.getSecret('extension_access_key')
  if (stored) {
    if (stored.startsWith('plain:')) return stored.slice('plain:'.length)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }

  const key = randomBytes(32).toString('base64url')
  database.setSecret('extension_access_key', safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString('base64')
    : `plain:${key}`)
  return key
}

function emitExtensionServerStatus(): void {
  mainWindow?.webContents.send(channels.extensionServerChanged, localServer?.getStatus() ?? {
    running: false,
    port: WORK_BUDDY_LOCAL_PORT,
    connections: 0,
    error: 'The extension server has not started.'
  })
}

async function invokeExtensionApi(method: string, args: unknown[]): Promise<unknown> {
  const [first, second] = args
  switch (method) {
    case 'getAppVersion': return app.getVersion()
    case 'getSnapshot': return database.getSnapshot()
    case 'getHistory': return database.getHistory(first as number | undefined)
    case 'getDaySnapshot': return database.getDaySnapshot(first as string)
    case 'getOvertimeOverview': return database.getOvertimeOverview()
    case 'setOvertimeRedeemed': return database.setOvertimeRedeemed(first as string, second as boolean)
    case 'startWorkday': return database.startWorkday()
    case 'endWorkday': return database.endWorkday()
    case 'resumeWorkday': return database.resumeWorkday()
    case 'getProjectStats': return database.getProjectStats()
    case 'startTask': return database.startTask(first as StartTaskInput)
    case 'pauseTask': return database.pauseTask(first as string)
    case 'resumeTask': return database.resumeTask(first as string, second as StartMode)
    case 'stopTask': return database.stopTask(first as string)
    case 'pauseAllTasks': return database.pauseAllTasks()
    case 'stopAllTasks': return database.stopAllTasks()
    case 'startRest': return database.startRest(first as RestType)
    case 'pauseRest': return database.pauseRest(first as string)
    case 'resumeRest': return database.resumeRest(first as string)
    case 'completeRest': return database.completeRest(first as string)
    case 'skipRest': return database.skipRest(first as RestType)
    case 'updateRestStart': return database.updateRestStart(first as string, second as number)
    case 'setRestAlarmMuted': return database.setRestAlarmMuted(first as string, second as boolean)
    case 'updateTask': return database.updateTask(first as TaskUpdateInput)
    case 'mergeTasks': return database.mergeTasks(first as TaskMergeInput)
    case 'deleteTask': return database.deleteTask(first as string)
    case 'createPlannedTask': return database.createPlannedTask(first as PlannedTaskInput)
    case 'updatePlannedTask': return database.updatePlannedTask(first as PlannedTaskUpdateInput)
    case 'deletePlannedTask': return database.deletePlannedTask(first as string)
    case 'createProject': return database.createProject(first as ProjectInput)
    case 'updateProject': return database.updateProject(first as ProjectUpdateInput)
    case 'updateSettings': {
      return applyAppSettings(first as AppSettings)
    }
    case 'saveAiKey': {
      const clean = (first as string).trim()
      if (!clean) database.deleteSecret('gemini_api_key')
      else {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
        database.setSecret('gemini_api_key', safeStorage.encryptString(clean).toString('base64'))
      }
      return database.getSnapshot()
    }
    case 'exportBackup': {
      if (!mainWindow) return null
      const date = localDateKey(Date.now())
      const result = await dialog.showSaveDialog(mainWindow, {
        title: database.getSettings().locale === 'uk' ? 'Зберегти резервну копію' : 'Save backup',
        defaultPath: join(app.getPath('downloads'), `work-buddy-backup-${date}.workbuddy.json`),
        filters: [{ name: 'Work Buddy backup', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, JSON.stringify(database.exportBackup(), null, 2), 'utf8')
      return { path: result.filePath }
    }
    case 'chooseBackupImport': {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        title: database.getSettings().locale === 'uk' ? 'Обрати резервну копію' : 'Choose backup',
        properties: ['openFile'],
        filters: [{ name: 'Work Buddy backup', extensions: ['json'] }]
      })
      const path = result.filePaths[0]
      if (result.canceled || !path) return null
      pendingBackup = database.parseBackup(await readFile(path, 'utf8'))
      return database.getBackupPreview(pendingBackup)
    }
    case 'applyBackupImport': {
      if (!pendingBackup) throw new Error('Choose a backup file first')
      const result = database.importBackup(pendingBackup, first as BackupImportMode)
      pendingBackup = null
      return result
    }
    case 'exportDayCalendar': {
      if (!mainWindow) return null
      const date = first as string
      const result = await dialog.showSaveDialog(mainWindow, {
        title: database.getSettings().locale === 'uk' ? 'Експортувати день у календар' : 'Export day to calendar',
        defaultPath: join(app.getPath('downloads'), `work-buddy-${date}.ics`),
        filters: [{ name: 'Calendar file', extensions: ['ics'] }]
      })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, database.createDayCalendarIcs(date), 'utf8')
      return { path: result.filePath }
    }
    case 'chooseNotificationSound': {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        title: database.getSettings().locale === 'uk' ? 'Обрати звук нагадування' : 'Choose reminder sound',
        properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }]
      })
      const path = result.filePaths[0]
      if (result.canceled || !path) return null
      return { path, name: basename(path), dataUrl: await audioDataUrl(path) }
    }
    case 'suggestTask': return gemini.suggestTask(first as string)
    case 'interpretVoiceTask': return gemini.interpretVoiceTask(first as VoiceInput, second as string | undefined)
    case 'transcribeVoice': return gemini.transcribeVoice(first as VoiceInput)
    case 'summarizeDay': return gemini.summarizeDay()
    case 'notify': {
      if (Notification.isSupported()) new Notification(first as NotificationInput).show()
      return undefined
    }
    case 'getCustomSoundData': {
      const path = database.getSettings().notifications.customSoundPath
      return path ? audioDataUrl(path) : ''
    }
    // Window controls belong to Electron. They intentionally become harmless
    // no-ops in the browser drawer, whose own shell controls visibility.
    case 'setWindowMode': return null
    case 'setWindowHeight':
    case 'setWindowEditor':
    case 'fitWindowToContent':
    case 'setWindowView':
    case 'minimizeToTray': return undefined
    default: throw new Error(`Unsupported extension action: ${method}`)
  }
}

function registerIpc(): void {
  ipcMain.handle(channels.appVersion, () => app.getVersion())
  ipcMain.handle(channels.snapshot, () => database.getSnapshot())
  ipcMain.handle(channels.history, (_, days?: number) => database.getHistory(days))
  ipcMain.handle(channels.daySnapshot, (_, date: string) => database.getDaySnapshot(date))
  ipcMain.handle(channels.overtimeOverview, () => database.getOvertimeOverview())
  ipcMain.handle(channels.overtimeRedeemed, (_, date: string, redeemed: boolean) => {
    const result = database.setOvertimeRedeemed(date, redeemed)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.startWorkday, () => {
    const result = database.startWorkday()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.endWorkday, () => {
    const result = database.endWorkday()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.resumeWorkday, () => {
    const result = database.resumeWorkday()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.projectStats, () => database.getProjectStats())
  ipcMain.handle(channels.projectTasks, (_, projectId: string) => database.getProjectTasks(projectId))
  ipcMain.handle(channels.deleteProject, (_, id: string) => {
    const result = database.deleteProject(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.mergeProjects, (_, sourceId: string, targetId: string) => {
    const result = database.mergeProjects(sourceId, targetId)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.reorderProjects, (_, ids: string[]) => {
    const result = database.reorderProjects(ids)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.updateWorkdayStart, (_, startedAt: number) => {
    const result = database.updateWorkdayStart(startedAt)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.startTask, (_, input: StartTaskInput) => {
    const result = database.startTask(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.pauseTask, (_, id: string) => {
    const result = database.pauseTask(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.resumeTask, (_, id: string, mode: StartMode) => {
    const result = database.resumeTask(id, mode)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.stopTask, (_, id: string) => {
    const result = database.stopTask(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.pauseAllTasks, () => {
    const result = database.pauseAllTasks()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.stopAllTasks, () => {
    const result = database.stopAllTasks()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.startRest, (_, type: RestType) => {
    const result = database.startRest(type)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.pauseRest, (_, id: string) => {
    const result = database.pauseRest(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.resumeRest, (_, id: string) => {
    const result = database.resumeRest(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.completeRest, (_, id: string) => {
    const result = database.completeRest(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.skipRest, (_, type: RestType) => {
    const result = database.skipRest(type)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.updateRestStart, (_, id: string, startedAt: number) => {
    const result = database.updateRestStart(id, startedAt)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.setRestAlarmMuted, (_, id: string, muted: boolean) => {
    const result = database.setRestAlarmMuted(id, muted)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.updateTask, (_, input: TaskUpdateInput) => {
    const result = database.updateTask(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.mergeTasks, (_, input: TaskMergeInput) => {
    const result = database.mergeTasks(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.deleteTask, (_, id: string) => {
    const result = database.deleteTask(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.createPlannedTask, (_, input: PlannedTaskInput) => {
    const result = database.createPlannedTask(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.updatePlannedTask, (_, input: PlannedTaskUpdateInput) => {
    const result = database.updatePlannedTask(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.deletePlannedTask, (_, id: string) => {
    const result = database.deletePlannedTask(id)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.createProject, (_, input: ProjectInput) => {
    const result = database.createProject(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.updateProject, (_, input: ProjectUpdateInput) => {
    const result = database.updateProject(input)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.updateSettings, (_, settings: AppSettings) => {
    return applyAppSettings(settings)
  })
  ipcMain.handle(channels.setGlobalShortcut, (_, shortcut: string) => applyAppSettings({ ...database.getSettings(), globalShortcut: shortcut }, true))
  ipcMain.handle(channels.saveAiKey, (_, key: string) => {
    const clean = key.trim()
    if (!clean) database.deleteSecret('gemini_api_key')
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
      database.setSecret('gemini_api_key', safeStorage.encryptString(clean).toString('base64'))
    }
    emitChanged()
    return database.getSnapshot()
  })
  ipcMain.handle(channels.backupExport, async () => {
    if (!mainWindow) return null
    const date = localDateKey(Date.now())
    const result = await dialog.showSaveDialog(mainWindow, {
      title: database.getSettings().locale === 'uk' ? 'Зберегти резервну копію' : 'Save backup',
      defaultPath: join(app.getPath('downloads'), `work-buddy-backup-${date}.workbuddy.json`),
      filters: [{ name: 'Work Buddy backup', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(database.exportBackup(), null, 2), 'utf8')
    return { path: result.filePath }
  })
  ipcMain.handle(channels.backupChoose, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: database.getSettings().locale === 'uk' ? 'Обрати резервну копію' : 'Choose backup',
      properties: ['openFile'],
      filters: [{ name: 'Work Buddy backup', extensions: ['json'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    pendingBackup = database.parseBackup(await readFile(path, 'utf8'))
    return database.getBackupPreview(pendingBackup)
  })
  ipcMain.handle(channels.backupApply, (_, mode: BackupImportMode) => {
    if (!pendingBackup) throw new Error('Choose a backup file first')
    const result = database.importBackup(pendingBackup, mode)
    pendingBackup = null
    emitChanged()
    return result
  })
  ipcMain.handle(channels.calendarExportRange, async (_, from: string, to: string) => {
    if (!mainWindow) return null
    const ics = database.createCalendarIcs(from, to)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: database.getSettings().locale === 'uk' ? 'Експортувати період у календар' : 'Export period to calendar',
      defaultPath: join(app.getPath('downloads'), from === to ? `work-buddy-${from}.ics` : `work-buddy-${from}_${to}.ics`),
      filters: [{ name: 'Calendar file', extensions: ['ics'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, ics, 'utf8')
    return { path: result.filePath }
  })
  ipcMain.handle(channels.calendarExportDay, async (_, date: string) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: database.getSettings().locale === 'uk' ? 'Експортувати день у календар' : 'Export day to calendar',
      defaultPath: join(app.getPath('downloads'), `work-buddy-${date}.ics`),
      filters: [{ name: 'Calendar file', extensions: ['ics'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, database.createDayCalendarIcs(date), 'utf8')
    return { path: result.filePath }
  })
  ipcMain.handle(channels.suggestTask, (_, taskId: string) => gemini.suggestTask(taskId))
  ipcMain.handle(channels.interpretVoiceTask, (_, input: VoiceInput, taskId?: string) => gemini.interpretVoiceTask(input, taskId))
  ipcMain.handle(channels.transcribeVoice, (_, input: VoiceInput) => gemini.transcribeVoice(input))
  ipcMain.handle(channels.summarizeDay, () => gemini.summarizeDay())
  ipcMain.handle(channels.notify, (_, input: NotificationInput) => {
    if (Notification.isSupported()) new Notification(input).show()
  })
  ipcMain.handle(channels.windowMode, (_, mode: 'compact' | 'expanded' | 'docked', rows = 1) => {
    if (!mainWindow) return null
    const current = mainWindow.getBounds()
    if (mode === 'docked') {
      const area = screen.getDisplayMatching(current).workArea
      const centerX = current.x + current.width / 2
      // Stick to whichever side edge of the screen is closer.
      const side = centerX - area.x < area.x + area.width - centerX ? 'left' : 'right'
      if (!dockedSide) {
        dockRestoreBounds = current
        dockRestoreSide = side
      }
      dockedSide = side
      compactWindow = true
      editorRestoreBounds = null
      mainWindow.setResizable(false)
      mainWindow.setMinimumSize(DOCK_SIZE.width, DOCK_SIZE.height)
      mainWindow.setMaximumSize(DOCK_SIZE.width, DOCK_SIZE.height)
      const y = Math.min(Math.max(current.y, area.y), area.y + area.height - DOCK_SIZE.height)
      programmaticHeight = DOCK_SIZE.height
      mainWindow.setBounds({ x: side === 'left' ? area.x : area.x + area.width - DOCK_SIZE.width, y, ...DOCK_SIZE }, true)
      return side
    }
    if (dockedSide) {
      const area = screen.getDisplayMatching(current).workArea
      const wasRight = dockedSide === 'right'
      // The pill may have been dragged to the other edge or another screen since docking;
      // only reuse the pre-dock x while it is still on the same edge of the same screen.
      const restore = dockRestoreBounds && dockRestoreSide === dockedSide && overlapArea(dockRestoreBounds, area) > 0 ? dockRestoreBounds : null
      dockedSide = null
      dockRestoreBounds = null
      dockRestoreSide = null
      const nextCompact = mode === 'compact'
      const height = nextCompact
        ? Math.min(24 + Math.max(1, rows) * 50, area.height - 24)
        : Math.min(manualHeight, area.height - 24)
      compactWindow = nextCompact
      mainWindow.setMinimumSize(WINDOW_WIDTH, 64)
      mainWindow.setMaximumSize(WINDOW_WIDTH, area.height)
      mainWindow.setResizable(!nextCompact)
      // Reopen where the window came from horizontally, but at the height the dock was dragged to.
      const preferredX = restore?.x ?? (wasRight ? area.x + area.width - WINDOW_WIDTH - 22 : area.x + 22)
      const x = Math.min(Math.max(preferredX, area.x), area.x + area.width - WINDOW_WIDTH)
      const y = Math.min(Math.max(current.y, area.y), area.y + area.height - height)
      compactBottomAnchored = false
      programmaticHeight = height
      mainWindow.setBounds({ x, y, width: WINDOW_WIDTH, height }, true)
      return nextCompact ? 'top' : null
    }
    const display = screen.getDisplayMatching(current)
    const area = display.workArea
    const wasCompact = compactWindow
    const nextCompact = mode === 'compact'
    const height = nextCompact
      ? Math.min(24 + Math.max(1, rows) * 50, screen.getDisplayMatching(current).workArea.height - 24)
      : Math.min(manualHeight, screen.getDisplayMatching(current).workArea.height - 24)
    const currentBottom = current.y + current.height
    const wasAtBottom = Math.abs(currentBottom - (area.y + area.height)) <= 16
    const extraHeight = Math.max(0, height - current.height)
    const spaceAbove = Math.max(0, current.y - area.y)
    const spaceBelow = Math.max(0, area.y + area.height - currentBottom)
    const keepBottom = nextCompact
      ? (wasAtBottom || (extraHeight > spaceBelow && spaceAbove >= extraHeight))
      : wasCompact && (compactBottomAnchored || wasAtBottom)
    if (nextCompact) compactBottomAnchored = keepBottom
    const x = Math.min(Math.max(current.x, area.x), area.x + area.width - current.width)
    const y = keepBottom
      ? Math.min(Math.max(currentBottom - height, area.y), area.y + area.height - height)
      : Math.min(Math.max(current.y, area.y), area.y + area.height - height)
    compactWindow = nextCompact
    mainWindow.setResizable(!nextCompact)
    programmaticHeight = height
    mainWindow.setBounds({ ...current, x, y, height }, true)
    return nextCompact ? (keepBottom ? 'bottom' : 'top') : null
  })
  ipcMain.handle(channels.windowHeight, (_, requestedHeight: number) => {
    if (!mainWindow || compactWindow) return
    const current = mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    const next = fitWindowHeight(current, area, requestedHeight, isBottomAnchored(current, area), 230)
    if (current.height !== next.height || current.y !== next.y || current.x !== next.x) {
      programmaticHeight = next.height
      mainWindow.setBounds(next, false)
    }
  })
  ipcMain.handle(channels.windowEditor, (_, open: boolean) => {
    if (!mainWindow || compactWindow) return
    const current = mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    if (open) {
      if (!editorRestoreBounds) editorRestoreBounds = current
      const requestedHeight = Math.max(current.height, Math.min(700, area.height - 16))
      const next = fitWindowHeight(current, area, requestedHeight, isBottomAnchored(current, area), 230)
      programmaticHeight = next.height
      mainWindow.setBounds(next, false)
      return
    }
    if (!editorRestoreBounds) return
    const restore = editorRestoreBounds
    editorRestoreBounds = null
    const next = fitWindowHeight(restore, area, restore.height, isBottomAnchored(restore, area), 230)
    programmaticHeight = next.height
    mainWindow.setBounds(next, false)
  })
  ipcMain.handle(channels.windowFit, (_, requestedHeight: number) => {
    if (!mainWindow || compactWindow || !Number.isFinite(requestedHeight)) return
    const current = mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    const next = fitWindowHeight(current, area, requestedHeight, isBottomAnchored(current, area), 230)
    manualHeight = next.height
    programmaticHeight = next.height
    mainWindow.setBounds(next, false)
  })
  ipcMain.handle(channels.windowView, () => {
    if (!mainWindow || compactWindow) return
  })
  ipcMain.handle(channels.chooseSound, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: database.getSettings().locale === 'uk' ? 'Обрати звук нагадування' : 'Choose reminder sound',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return { path, name: basename(path), dataUrl: await audioDataUrl(path) }
  })
  ipcMain.handle(channels.soundData, async () => {
    const path = database.getSettings().notifications.customSoundPath
    return path ? audioDataUrl(path) : ''
  })
  ipcMain.handle(channels.minimize, () => mainWindow?.hide())
  ipcMain.handle(channels.extensionServerStatus, () => localServer?.getStatus() ?? {
    running: false,
    port: WORK_BUDDY_LOCAL_PORT,
    connections: 0,
    error: 'The extension server has not started.'
  })
  ipcMain.handle(channels.extensionAccessKey, () => extensionAccessKey())
}

const singleInstance = process.env.ELECTRON_RENDERER_URL ? true : app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else {
  app.on('second-instance', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  void app.whenReady().then(async () => {
    database = new WorkBuddyDatabase(join(app.getPath('userData'), 'work-buddy.sqlite'))
    gemini = new GeminiService(database, () => {
      const encrypted = database.getSecret('gemini_api_key')
      if (!encrypted) return ''
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    })
    registerIpc()
    localServer = new WorkBuddyLocalServer(extensionAccessKey(), invokeExtensionApi, emitChanged)
    localServer.onStatusChange(emitExtensionServerStatus)
    await localServer.start().catch(() => {
      // A port conflict must not block the time tracker. The settings page
      // surfaces the precise status for diagnosis.
      emitExtensionServerStatus()
    })
    createWindow()
    mainWindow?.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'))
    tray = new Tray(createTrayIcon())
    tray.setToolTip('Work Buddy')
    tray.on('click', toggleWindow)
    updateTrayMenu()
    try {
      registerToggleShortcut(database.getSettings().globalShortcut)
    } catch {
      // Another app can reserve a global shortcut. Work Buddy remains usable
      // through its tray until the user chooses an available combination.
    }
    reminders = new ReminderService(database, (sound, volume) => {
      if (sound === 'system') shell.beep()
      else mainWindow?.webContents.send(channels.playSound, sound, volume)
    })
    reminders.start()
  }).catch((error: unknown) => {
    const details = error instanceof Error ? error.message : 'Unexpected startup error'
    dialog.showErrorBox('Work Buddy could not start', details)
    app.quit()
  })
}

app.on('before-quit', () => {
  isQuitting = true
  reminders?.stop()
  void localServer?.stop()
  database?.close()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
