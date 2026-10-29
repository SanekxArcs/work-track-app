import { surfaceRegion,notchBounds } from './window-shape'
import { ActivityLearningService } from './activity-learning'
import { AutoTrackingService } from './activity-auto'
import { acceptActivityDrafts } from './activity-import'
import { ActivityStore } from './activity-store'
import { ActivityService } from './activity'
import { activityReview } from '../shared/activity-review'
import { ConvexSyncService } from './convex-sync'
import type { ConvexSyncConfig } from '../shared/convex-sync'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, safeStorage, screen, shell, Tray } from 'electron'
import { WorkBuddyDatabase } from './database'
import { GeminiService } from './gemini'
import { ReminderService } from './reminders'
import { WORK_BUDDY_LOCAL_PORT, WorkBuddyLocalServer } from './local-server'
import { fitWindowHeight, isBottomAnchored } from './window-layout'
import { syncWindowTopmost } from './window-topmost'
import { localDateKey } from '../shared/local-date'
import { channels } from '../shared/channels'
import type { WindowMode, AppSettings, AppSnapshot, BackupData, BackupImportMode, NotificationInput, PlannedTaskInput, PlannedTaskUpdateInput, ProjectInput, ProjectUpdateInput, RestType, StartMode, StartTaskInput, TaskSplitInput, TaskMergeInput, TaskUpdateInput, VoiceInput } from '../shared/types'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let learning:ActivityLearningService
let autoTracking:AutoTrackingService
let activity: ActivityService
/** Daily activity view for the renderer: review state plus the automatic tracking journal. */
function activityDayView(day:string){return {...learning.day(day),auto:autoTracking.state(day)}}
const activityPreviews = new Map<string,{expires:number;epoch:number;review:ReturnType<typeof activityReview>}>()
let convexSync: ConvexSyncService
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
/** Where content fitting keeps the window: the spot the user chose, not wherever a tall page pushed it. */
let fitAnchor: { y: number; bottom: boolean; last: Electron.Rectangle } | null = null
let registeredToggleShortcut: string | null = null
let dockedSide: 'left' | 'right' | null = null
let dockRestoreBounds: Electron.Rectangle | null = null
let dockRestoreSide: 'left' | 'right' | null = null
let notchState: 'collapsed' | 'open' | null = null
let notchEdge:'top'|'bottom'='top'
let notchGrabStart={x:0,y:0}
let notchVerticalDrag=false
let notchGrabOffset = 0
let notchSurface:(Electron.Rectangle&{radius?:number})|null=null
function setNotchEdge(edge:'top'|'bottom'):void {if(edge===notchEdge)return;notchEdge=edge;mainWindow?.webContents.send(channels.notchEdge,edge)}
function syncNativeSurface():void {
 if(!mainWindow||mainWindow.isDestroyed())return

 if(process.platform!=='win32'&&process.platform!=='linux')return
 const {width,height}=mainWindow.getContentBounds()
 const rect=notchSurface??{x:0,y:0,width,height}
 const region=notchState?surfaceRegion(rect,notchSurface?.radius??(notchState==='open'?20:11),notchEdge==='bottom',notchEdge==='top'):dockedSide?surfaceRegion({x:0,y:0,width,height},16,true,true,dockedSide==='right',dockedSide==='left'):null
 mainWindow.setIgnoreMouseEvents(region?.length===0,{forward:true})
 mainWindow.setShape(region??[])

}
let notchDisplayId: number | null = null
let notchDragging = false
let notchFollowTimer: NodeJS.Timeout | undefined
let topmostTimer: NodeJS.Timeout | undefined
let notchTravelTimer: NodeJS.Timeout | undefined
let notchCandidate: { id: number; since: number } | null = null
const chosenSoundPaths = new Set<string>()

const WINDOW_WIDTH = 430
const DOCK_SIZE = { width: 104, height: 46 }
const NOTCH_SIZE = { width: 264, height: 30 }

/** Windows can enforce a native minimum height larger than the painted 30px pill. */
function positionNotch(area:Electron.Rectangle,center:number,size:{width:number;height:number}):void {
 if(!mainWindow)return
 mainWindow.setBounds(notchBounds(area,center,size,notchEdge),false)
 const actual=mainWindow.getBounds()
 if(notchEdge==='bottom'&&actual.y+actual.height!==area.y+area.height)mainWindow.setPosition(actual.x,area.y+area.height-actual.height,false)
 syncNativeSurface()
}

function overlapArea(a: Electron.Rectangle, b: Electron.Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

/**
 * The notch's pill centre stays at least half a full window from the screen edges, so the
 * window it opens into is always centred on it and the pill never jumps while it grows.
 */
function clampNotchCenter(center: number, area: Electron.Rectangle): number {
  return Math.min(Math.max(center, area.x + WINDOW_WIDTH / 2), area.x + area.width - WINDOW_WIDTH / 2)
}

/** The saved notch spot, or the top centre of the screen the window is on. */
function notchAnchor(): { area: Electron.Rectangle; center: number;edge:'top'|'bottom' } {
  const display = screen.getAllDisplays().find((item) => item.id === notchDisplayId)
    ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  notchDisplayId = display.id
  const placement = database.getNotchPlacement(display.id)
  const area = display.workArea
  if(!notchDragging)setNotchEdge(placement?.edge??'top')
  return { area,edge:notchEdge, center: clampNotchCenter(area.x + (placement?.ratio ?? 0.5) * area.width, area) }
}

function cancelNotchTravel(): void {
  clearTimeout(notchTravelTimer)
  notchTravelTimer = undefined
  notchCandidate = null
  mainWindow?.webContents.send(channels.notchTravel, false)
}

/** Animate inside the transparent window so the pill cannot spill onto a screen above it. */
function followNotchCursor(): void {
  if (!mainWindow || !mainWindow.isVisible() || notchState !== 'collapsed' || notchDragging || notchTravelTimer) {
    notchCandidate = null
    return
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { area, center } = notchAnchor()
  if (display.id === notchDisplayId) {
    notchCandidate = null
    // Also restore a reachable position after resolution, scale or taskbar changes.
    const x = Math.round(center - NOTCH_SIZE.width / 2)
    const current = mainWindow.getBounds()
    const y=notchEdge==='bottom'?area.y+area.height-current.height:area.y
    if (current.x !== x || current.y !== y) {
      mainWindow.setPosition(x, y, false)
      restoreWindowTopmost()
    }
    return
  }
  if (notchCandidate?.id !== display.id) {
    notchCandidate = { id: display.id, since: Date.now() }
    return
  }
  if (Date.now() - notchCandidate.since < 200) return
  mainWindow.webContents.send(channels.notchTravel, true)
  notchTravelTimer = setTimeout(() => {
    if (!mainWindow || notchState !== 'collapsed' || notchDragging || !mainWindow.isVisible()) {
      cancelNotchTravel()
      return
    }
    // Use the latest cursor location if it crossed another screen during the exit.
    notchDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    const target = notchAnchor()
    positionNotch(target.area,target.center,NOTCH_SIZE)
    restoreWindowTopmost()
    notchTravelTimer = setTimeout(cancelNotchTravel, 50)
  }, 200)
}

/** The tallest the normal window may grow: the full height of the screen it is on, not the primary one. */
function syncWindowMaxHeight(): void {
  if (!mainWindow) return
  if (notchState) {
    cancelNotchTravel()
    const { area, center } = notchAnchor()
    const size = notchState === 'collapsed' ? NOTCH_SIZE : { width: WINDOW_WIDTH, height: Math.min(manualHeight, area.height - 24) }
    mainWindow.setMinimumSize(size.width, size.height)
    mainWindow.setMaximumSize(size.width, size.height)
    positionNotch(area,center,size)
    return
  }
  if (compactWindow) return
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  const [, maxHeight] = mainWindow.getMaximumSize()
  if (maxHeight !== area.height) mainWindow.setMaximumSize(WINDOW_WIDTH, area.height)
}

function snapWindowToScreen(): void {
  if (!mainWindow || applyingSnap || notchState) return
  syncWindowMaxHeight()
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

function restoreWindowTopmost(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return
  if (!database.getSettings().alwaysOnTop) return
  // Keep native file dialogs above their owner while they are open.
  if (mainWindow.getChildWindows().some((child) => child.isVisible())) return
  syncWindowTopmost(mainWindow, true)
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

function guardCustomSoundPath(settings: AppSettings, current: AppSettings): AppSettings {
  const path = settings.notifications?.customSoundPath
  if (typeof path !== 'string' || path === '' || path === current.notifications.customSoundPath || chosenSoundPaths.has(path)) return settings
  // The sound path is read back from disk, so only a file picked in the sound dialog may be stored.
  return { ...settings, notifications: { ...settings.notifications, customSoundPath: current.notifications.customSoundPath, customSoundName: current.notifications.customSoundName } }
}

async function chooseSoundFile(): Promise<{ path: string; name: string; dataUrl: string } | null> {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: database.getSettings().locale === 'uk' ? 'Обрати звук нагадування' : 'Choose reminder sound',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }]
  })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  const dataUrl = await audioDataUrl(path)
  chosenSoundPaths.add(path)
  return { path, name: basename(path), dataUrl }
}

function showNotification(input: unknown): void {
  // Callers include the extension bridge; never pass its object through to Electron.
  const value = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<keyof NotificationInput, unknown>>
  if (Notification.isSupported()) new Notification({ title: String(value.title ?? ''), body: String(value.body ?? '') }).show()
}

function applyAppSettings(settings: AppSettings, ensureGlobalShortcut = false): AppSnapshot {
  const current = database.getSettings()
  settings = guardCustomSoundPath(settings, current)
  if (current.globalShortcut !== settings.globalShortcut || (ensureGlobalShortcut && !globalShortcut.isRegistered(settings.globalShortcut))) registerToggleShortcut(settings.globalShortcut)
  const result = database.updateSettings(settings)
  app.setLoginItemSettings({ openAtLogin: result.settings.autoStart })
  syncWindowTopmost(mainWindow, result.settings.alwaysOnTop)
  syncNativeSurface()
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
    // Follows the screen the window is on (see syncWindowMaxHeight), so a taller second monitor can be used.
    maxHeight: Math.max(...screen.getAllDisplays().map((item) => item.workArea.height)),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow:false,
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

  syncWindowTopmost(mainWindow, database.getSettings().alwaysOnTop)

  // The renderer exposes a deliberately small IPC bridge. Never let an
  // accidental link or popup replace it with untrusted web content.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('show', ()=>{restoreWindowTopmost();syncNativeSurface()})
  mainWindow.on('restore', restoreWindowTopmost)
  mainWindow.on('move', ()=>{scheduleSnap();if(notchState)syncNativeSurface()})
  mainWindow.on('resize', () => {
    if(notchState||dockedSide)syncNativeSurface()
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
  if (stored?.startsWith('plain:')) return stored.slice('plain:'.length)
  if (stored && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      // An unreadable key (e.g. a changed OS profile) must not stop the
      // tracker; a fresh one only means pairing the extension again.
    }
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
    case 'splitTask': return database.splitTask(first as TaskSplitInput)
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
    case 'chooseNotificationSound': return chooseSoundFile()
    case 'suggestTask': return gemini.suggestTask(first as string)
    case 'interpretVoiceTask': return gemini.interpretVoiceTask(first as VoiceInput, second as string | undefined)
    case 'interpretPlannedVoice': return gemini.interpretVoiceTask(first as VoiceInput, undefined, true)
    case 'transcribeVoice': return gemini.transcribeVoice(first as VoiceInput)
    case 'summarizeDay': return gemini.summarizeDay()
    case 'notify': {
      showNotification(first)
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
  ipcMain.handle(channels.activityLearning,(_,action,input)=>learning.run(action,input))
  ipcMain.handle(channels.activityAcceptDrafts,(_,input)=>{const result=acceptActivityDrafts(activity,database,input);emitChanged();return result})
  ipcMain.handle(channels.activityAuto,async(_,action:string,input:unknown)=>{
    const value=(input&&typeof input==='object'?input:{}) as Record<string,unknown>
    const day=typeof value.day==='string'?value.day:localDateKey(Date.now())
    if(action==='configure')autoTracking.configure(value.config)
    else if(action==='run')await autoTracking.run([day])
    else if(action==='dismiss')autoTracking.dismiss(day,value.id)
    else if(action==='restore')autoTracking.restore(day,value.id)
    else if(action==='update')autoTracking.update(day,value.id,value.patch as {project?:'auto'|string|null;notes?:string})
    else if(action==='promote'){
      const result=autoTracking.promote(day,value.ids)
      return {data:activityDayView(day),snapshot:result.snapshot,created:result.created}
    }
    else throw new Error('Unknown automatic tracking action')
    return {data:activityDayView(day)}
  })
  ipcMain.handle(channels.activityDay,(_,day:string)=>activityDayView(day))
  ipcMain.handle(channels.activityConfigure,(_,config,writeKey,readKey)=>activity.configure(config,writeKey,readKey))
  ipcMain.handle(channels.activitySyncNow,async()=>{await activity.resync();return activity.status()})
  ipcMain.handle(channels.activityImport,async()=>{
    const result=await dialog.showOpenDialog({title:'Import Work Buddy connection',properties:['openFile']})
    if(result.canceled||!result.filePaths[0])return null
    const contents=await readFile(result.filePaths[0],'utf8')
    if(contents.length>16384)throw new Error('Connection file is too large')
    return activity.importConnection(contents)
  })
  ipcMain.handle(channels.activityRefresh,async(_,day:string)=>{await activity.refresh(day);if(autoTracking.config().enabled)autoTracking.reconcile(day);return activityDayView(day)})
  ipcMain.handle(channels.activityAssign,(_,value)=>activity.assign(value))
  ipcMain.handle(channels.activityRemember,(_,rule)=>{
    if(!database.getSnapshot().projects.some(p=>p.id===rule?.projectId))throw new Error('Choose an existing Work Buddy project')
    activity.remember(rule)
  })
  ipcMain.handle(channels.activityForgetRules,()=>activity.forgetRules())
  ipcMain.handle(channels.activityDelete,async(_,day:string)=>{activity.deleteDay(day);await activity.resync()})
  ipcMain.handle(channels.activityPreview,(_,day:string)=>{
    const data=activity.day(day),snapshot=database.getDaySnapshot(day)
    const review=activityReview(data,snapshot,data.assignments,data.rules)
    if(!review.report.segments.length&&!review.tasks.length)throw new Error('No activity or tracked tasks for this day')
    const id=randomBytes(16).toString('hex')
    activityPreviews.clear();activityPreviews.set(id,{expires:Date.now()+300000,epoch:activity.privacyEpoch,review})
    return {id,review}
  })
  ipcMain.handle(channels.activityRecap,async(_,id:string)=>{
    const preview=activityPreviews.get(id);activityPreviews.delete(id)
    if(!preview||preview.expires<Date.now()||preview.epoch!==activity.privacyEpoch)throw new Error('Preview expired or privacy settings changed. Review the data again.')
    const result=await gemini.summarizeActivity(preview.review)
    if(preview.epoch!==activity.privacyEpoch)throw new Error('Activity privacy settings changed during generation. Review the data again.')
    activity.store.saveRecap(preview.review.day,{summary:result.summary,generatedAt:Date.now(),through:preview.review.through,evidence:preview.review.evidence})
    return result
  })
  ipcMain.handle(channels.convexSyncStatus, () => convexSync.status())
  ipcMain.handle(channels.convexSyncConfigure, (_, config: ConvexSyncConfig, key?: string) => convexSync.configure(config, key))
  ipcMain.handle(channels.convexSyncNow, () => convexSync.sync())
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
  ipcMain.handle(channels.resetWorkday, (_, workdayId: string) => {
    if (typeof workdayId !== 'string') throw new Error('Workday not found')
    const result = database.resetWorkday(workdayId)
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
  ipcMain.handle(channels.splitTask, (_, input: TaskSplitInput) => {
    const result = database.splitTask(input)
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
    const result = applyAppSettings(settings)
    emitChanged()
    return result
  })
  ipcMain.handle(channels.setGlobalShortcut, (_, shortcut: string) => {
    const result = applyAppSettings({ ...database.getSettings(), globalShortcut: shortcut }, true)
    emitChanged()
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
  ipcMain.handle(channels.interpretPlannedVoice, (_, input: VoiceInput) => gemini.interpretVoiceTask(input, undefined, true))
  ipcMain.handle(channels.transcribeVoice, (_, input: VoiceInput) => gemini.transcribeVoice(input))
  ipcMain.handle(channels.summarizeDay, () => gemini.summarizeDay())
  ipcMain.handle(channels.notify, (_, input: NotificationInput) => showNotification(input))
  ipcMain.handle(channels.windowMode, (_, mode: WindowMode, rows = 1) => {
    if (!mainWindow) return null
    cancelNotchTravel()
    clearTimeout(snapTimer)
    applyingSnap=true
    notchSurface=null
    try {
    let current = mainWindow.getBounds()
    if (mode === 'notch' || mode === 'notch-open') {
      if (!notchState) notchDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
      // The notch hangs from the top edge where the user left it; hovering opens it in place.
      const { area, center } = notchAnchor()
      const size = mode === 'notch' ? NOTCH_SIZE : { width: WINDOW_WIDTH, height: Math.min(manualHeight, area.height - 24) }
      notchState = mode === 'notch' ? 'collapsed' : 'open'
      dockedSide = null
      dockRestoreBounds = null
      dockRestoreSide = null
      compactWindow = true
      editorRestoreBounds = null
      mainWindow.setResizable(false)
      mainWindow.setMovable(false)
      mainWindow.setMinimumSize(size.width, size.height)
      mainWindow.setMaximumSize(size.width, size.height)
      programmaticHeight = size.height
      positionNotch(area,center,size)
      restoreWindowTopmost()
      return notchEdge
    }
    if (notchState) {
      // Leaving the notch (pinning it open, compact or dock) starts from right under it.
      const { area, center } = notchAnchor()
      notchState = null
      compactWindow = false
      mainWindow.setMovable(true)
      mainWindow.setMinimumSize(WINDOW_WIDTH, 64)
      mainWindow.setMaximumSize(WINDOW_WIDTH, area.height)
      current = notchBounds(area,center,{width:WINDOW_WIDTH,height:Math.min(manualHeight,area.height-24)},notchEdge)
    }
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
      mainWindow.setBounds({ x: side === 'left' ? area.x : area.x + area.width - DOCK_SIZE.width, y, ...DOCK_SIZE }, false)
      restoreWindowTopmost()
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
    syncWindowMaxHeight()
    mainWindow.setResizable(!nextCompact)
    programmaticHeight = height
    mainWindow.setBounds({ ...current, x, y, height }, true)
    return nextCompact ? (keepBottom ? 'bottom' : 'top') : null
    }finally{applyingSnap=false;syncNativeSurface()}
  })
  ipcMain.handle(channels.notchSurface,(_,rect:Electron.Rectangle&{radius?:number})=>{
    if(!mainWindow||!notchState||!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite))return
    const bounds=mainWindow.getContentBounds()
    if(rect.radius!==undefined&&(!Number.isFinite(rect.radius)||rect.radius<0||rect.radius>30))return
    if(rect.width<0||rect.height<0||rect.width>bounds.width+2||rect.height>bounds.height+2)return
    notchSurface=rect;syncNativeSurface()
  })
  ipcMain.handle(channels.notchDrag, (_, phase: 'start' | 'move' | 'end') => {
    if (!mainWindow || !notchState||!['start','move','end'].includes(phase)) return
    const cursor = screen.getCursorScreenPoint(),bounds = mainWindow.getBounds()
    if (phase === 'start') {
      cancelNotchTravel();notchDragging = true;notchVerticalDrag=false;notchGrabStart=cursor
      notchGrabOffset = cursor.x - (bounds.x + bounds.width / 2)
      return
    }
    if(!notchDragging)return
    if(phase==='end'&&Math.hypot(cursor.x-notchGrabStart.x,cursor.y-notchGrabStart.y)<4){notchDragging=false;syncNativeSurface();return}
    const display=screen.getDisplayNearestPoint(cursor),area=display.workArea
    notchDisplayId=display.id
    if(Math.abs(cursor.y-notchGrabStart.y)>24)notchVerticalDrag=true
    if(notchVerticalDrag)setNotchEdge(cursor.y<area.y+area.height/2?'top':'bottom')
    const center = clampNotchCenter(cursor.x - notchGrabOffset, area)
    positionNotch(area,center,bounds)
    syncNativeSurface()
    if (phase === 'end') {
      notchDragging = false
      database.setNotchPlacement({displayId:display.id,ratio:(center-area.x)/area.width,edge:notchEdge})
      syncNativeSurface()
    }
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
    if (!mainWindow || (compactWindow&&!notchState)) return
    const current = mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    if(notchState==='open'){
      if(open){if(!editorRestoreBounds)editorRestoreBounds=current;mainWindow.setMinimumSize(WINDOW_WIDTH,230);mainWindow.setMaximumSize(WINDOW_WIDTH,area.height);programmaticHeight=Math.min(Math.max(current.height,700),area.height-16);mainWindow.setBounds(notchBounds(area,current.x+current.width/2,{width:WINDOW_WIDTH,height:programmaticHeight},notchEdge),false)}
      else if(editorRestoreBounds){mainWindow.setBounds(editorRestoreBounds,false);editorRestoreBounds=null}
      syncNativeSurface();return
    }
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
    if (!mainWindow || !Number.isFinite(requestedHeight)) return
    if (notchState === 'open') {
      const { area, center } = notchAnchor()
      const current = mainWindow.getBounds()
      const next = fitWindowHeight({ ...current, x: Math.round(center - WINDOW_WIDTH / 2), y: area.y }, area, requestedHeight, notchEdge==='bottom', 230)
      if(notchEdge==='bottom')next.y=area.y+area.height-next.height
      // Opening the notch fixes its native size; release those constraints before fitting.
      mainWindow.setMinimumSize(WINDOW_WIDTH, 230)
      mainWindow.setMaximumSize(WINDOW_WIDTH, Math.max(230, area.height - 16))
      programmaticHeight = next.height
      mainWindow.setBounds(next, false)
      return
    }
    if (compactWindow) return
    const current = mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    // Re-read the anchor only after the user moved or resized the window (a snap nudges it by
    // at most the magnet distance). Otherwise a page that grew the window up against the bottom
    // edge would make every shorter page shrink towards the bottom of the screen.
    const last = fitAnchor?.last
    const userMoved = !last || last.x !== current.x || last.height !== current.height || Math.abs(last.y - current.y) > 16
    if (!fitAnchor || userMoved) fitAnchor = { y: current.y, bottom: isBottomAnchored(current, area), last: current }
    const next = fitWindowHeight({ ...current, y: fitAnchor.bottom ? current.y : fitAnchor.y }, area, requestedHeight, fitAnchor.bottom, 230)
    fitAnchor.last = next
    manualHeight = next.height
    programmaticHeight = next.height
    mainWindow.setBounds(next, false)
  })
  // Kept for preload compatibility: the renderer no longer drives window views through IPC.
  ipcMain.handle(channels.windowView, () => undefined)
  ipcMain.handle(channels.chooseSound, () => chooseSoundFile())
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
    convexSync = new ConvexSyncService(database, {
      encrypt: (key) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
        return safeStorage.encryptString(key).toString('base64')
      },
      decrypt: (key) => safeStorage.decryptString(Buffer.from(key, 'base64'))
    })
    activity = new ActivityService(new ActivityStore(join(app.getPath('userData'),'activity.sqlite'),convexSync.status().sourceId),{
      encrypt:(key)=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Secure storage is unavailable');return safeStorage.encryptString(key).toString('base64')},
      decrypt:(key)=>safeStorage.decryptString(Buffer.from(key,'base64'))
    },()=>powerMonitor.getSystemIdleTime())
    activity.setProjectProvider(()=>database.getSnapshot().projects.map(({id,name,color,archived})=>({id,name,color,archived:!!archived})))
    learning=new ActivityLearningService(activity,database,gemini)
    autoTracking=new AutoTrackingService(activity,database,emitChanged)
    activity.start()
    autoTracking.start()
    powerMonitor.on('suspend',()=>activity.system('suspend'))
    powerMonitor.on('resume',()=>{activity.system('resume');autoTracking.soon()})
    powerMonitor.on('lock-screen',()=>activity.system('lock'))
    powerMonitor.on('unlock-screen',()=>activity.system('unlock'))
    convexSync.start()
    registerIpc()
    try {
      localServer = new WorkBuddyLocalServer(extensionAccessKey(), invokeExtensionApi, emitChanged, {
        pairing: () => activity.pairing(),
        deliver: (raw) => {
          const receipt = activity.deliver(raw)
          // Fresh browser evidence may extend or settle automatic entries; do not wait for the interval.
          autoTracking.soon()
          return receipt
        }
      })
      localServer.onStatusChange(emitExtensionServerStatus)
      await localServer.start().catch(() => {
        // A port conflict must not block the time tracker. The settings page
        // surfaces the precise status for diagnosis.
        emitExtensionServerStatus()
      })
    } catch (error) {
      // Without a key the bridge stays off; status reports it as not started.
      localServer = null
      console.error('Extension server could not start', error)
    }
    createWindow()
    notchFollowTimer = setInterval(followNotchCursor, 80)
    // Other applications can change the native z-order after our window loses focus.
    topmostTimer = setInterval(restoreWindowTopmost, 2000)
    screen.on('display-added', syncWindowMaxHeight)
    screen.on('display-removed', syncWindowMaxHeight)
    screen.on('display-metrics-changed', syncWindowMaxHeight)
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
  clearInterval(notchFollowTimer)
  clearInterval(topmostTimer)
  clearTimeout(notchTravelTimer)
  reminders?.stop()
  void localServer?.stop()
  convexSync?.stop()
  autoTracking?.stop()
  activity?.stop()
  activity?.store.close()
  database?.close()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
