import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray } from 'electron'
import { WorkBuddyDatabase } from './database'
import { GeminiService } from './gemini'
import { GoogleCalendarService } from './google-calendar'
import { ReminderService } from './reminders'
import { channels } from '../shared/channels'
import type { AppSettings, NotificationInput, PlannedTaskInput, ProjectInput, ProjectUpdateInput, RestType, StartMode, StartTaskInput, TaskUpdateInput, VoiceInput } from '../shared/types'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let database: WorkBuddyDatabase
let reminders: ReminderService
let gemini: GeminiService
let googleCalendar: GoogleCalendarService
let snapTimer: NodeJS.Timeout | undefined
let applyingSnap = false
let compactWindow = false
let manualHeight = 760
let programmaticHeight: number | undefined
let compactBottomAnchored = false

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
  let x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width)
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
  const width = 430
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
      sandbox: false
    }
  })

  if (database.getSettings().alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'pop-up-menu')

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
}

function registerIpc(): void {
  ipcMain.handle(channels.snapshot, () => database.getSnapshot())
  ipcMain.handle(channels.history, (_, days?: number) => database.getHistory(days))
  ipcMain.handle(channels.daySnapshot, (_, date: string) => database.getDaySnapshot(date))
  ipcMain.handle(channels.startWorkday, () => {
    const result = database.startWorkday()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.endWorkday, () => {
    const result = database.endWorkday()
    if (result.settings.googleCalendar.hasConnection && result.settings.googleCalendar.syncOnDayEnd) {
      void googleCalendar.sync(2).catch(() => undefined)
    }
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
  ipcMain.handle(channels.updateTask, (_, input: TaskUpdateInput) => {
    const result = database.updateTask(input)
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
    const result = database.updateSettings(settings)
    app.setLoginItemSettings({ openAtLogin: settings.autoStart })
    mainWindow?.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? 'pop-up-menu' : 'normal')
    updateTrayMenu()
    return result
  })
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
  ipcMain.handle(channels.googleConnect, async (_, clientId: string) => {
    const result = await googleCalendar.connect(clientId)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.googleDisconnect, () => {
    const result = googleCalendar.disconnect()
    emitChanged()
    return result
  })
  ipcMain.handle(channels.googleSync, () => googleCalendar.sync())
  ipcMain.handle(channels.googleSetup, () => shell.openExternal('https://console.cloud.google.com/apis/credentials'))
  ipcMain.handle(channels.suggestTask, (_, taskId: string) => gemini.suggestTask(taskId))
  ipcMain.handle(channels.interpretVoiceTask, (_, input: VoiceInput, taskId?: string) => gemini.interpretVoiceTask(input, taskId))
  ipcMain.handle(channels.transcribeVoice, (_, input: VoiceInput) => gemini.transcribeVoice(input))
  ipcMain.handle(channels.summarizeDay, () => gemini.summarizeDay())
  ipcMain.handle(channels.notify, (_, input: NotificationInput) => {
    if (Notification.isSupported()) new Notification(input).show()
  })
  ipcMain.handle(channels.windowMode, (_, mode: 'compact' | 'expanded', rows = 1) => {
    if (!mainWindow) return
    const current = mainWindow.getBounds()
    const display = screen.getDisplayMatching(current)
    const area = display.workArea
    const wasCompact = compactWindow
    const nextCompact = mode === 'compact'
    const height = nextCompact
      ? Math.min(24 + Math.max(1, rows) * 50, screen.getDisplayMatching(current).workArea.height - 24)
      : Math.min(manualHeight, screen.getDisplayMatching(current).workArea.height - 24)
    const wasAtBottom = Math.abs(current.y + current.height - (area.y + area.height)) <= 16
    if (nextCompact && !wasCompact) compactBottomAnchored = wasAtBottom
    const keepBottom = nextCompact ? compactBottomAnchored : wasCompact && (compactBottomAnchored || wasAtBottom)
    const x = Math.min(Math.max(current.x, area.x), area.x + area.width - current.width)
    const y = keepBottom
      ? area.y + area.height - height
      : Math.min(Math.max(current.y, area.y), area.y + area.height - height)
    compactWindow = nextCompact
    mainWindow.setResizable(!nextCompact)
    programmaticHeight = height
    mainWindow.setBounds({ ...current, x, y, height }, true)
  })
  ipcMain.handle(channels.windowHeight, (_, requestedHeight: number) => {
    if (!mainWindow || compactWindow) return
    const current = mainWindow.getBounds()
    const maxHeight = screen.getDisplayMatching(current).workArea.height - 16
    const height = Math.min(maxHeight, Math.max(230, Math.round(requestedHeight)))
    if (current.height !== height) {
      programmaticHeight = height
      mainWindow.setBounds({ ...current, height }, false)
    }
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
}

const singleInstance = process.env.ELECTRON_RENDERER_URL ? true : app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else {
  app.on('second-instance', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  app.whenReady().then(() => {
    database = new WorkBuddyDatabase(join(app.getPath('userData'), 'work-buddy.sqlite'))
    gemini = new GeminiService(database, () => {
      const encrypted = database.getSecret('gemini_api_key')
      if (!encrypted) return ''
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    })
    googleCalendar = new GoogleCalendarService(database)
    registerIpc()
    createWindow()
    mainWindow?.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'))
    tray = new Tray(createTrayIcon())
    tray.setToolTip('Work Buddy')
    tray.on('click', toggleWindow)
    updateTrayMenu()
    globalShortcut.register('CommandOrControl+Shift+T', toggleWindow)
    reminders = new ReminderService(database, (sound, volume) => {
      if (sound === 'system') shell.beep()
      else mainWindow?.webContents.send(channels.playSound, sound, volume)
    })
    reminders.start()
  })
}

app.on('before-quit', () => {
  isQuitting = true
  reminders?.stop()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
