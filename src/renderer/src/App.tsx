import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRightLeft, ArrowRightToLine, ArrowUpToLine, ArrowDownFromLine, BarChart3, BriefcaseBusiness, ChevronDown, ChevronUp, Clock3, Coffee, Dumbbell, GripVertical, Hourglass, ListTodo, Minus, Pause, Play, Plus, Settings2, EyeOff, Sparkles, Square, Sunrise, Sunset, Undo2, UserRoundX } from 'lucide-react'
import type { AppSnapshot, IdlePeriod, IdleResolution, Locale, NotchSettings, StartMode, Task } from '@shared/types'
import { restRemaining, workSinceLastRest } from '@shared/rest'
import { scheduledWorkdayEndAt } from '@shared/workday'
import { DaySummary } from './components/DaySummary'
import { SettingsPage } from './components/Settings'
import { TaskCard } from './components/TaskCard'
import { TaskEditor } from './components/TaskEditor'
import { RestControl } from './components/RestControl'
import { PlannedTasksPanel } from './components/PlannedTasksPanel'
import { ProjectsPage } from './components/ProjectsPage'
import { AnimatedDuration, AnimatedHm, AnimatedNumber, StackCollapse, ease } from './components/Animated'
import { translator } from './lib/i18n'
import { errorText } from './lib/errors'
import { dayIntervals, formatClock, formatDuration, taskDuration, unionDuration } from './lib/time'
import { playNotificationSound } from './lib/sounds'
import { localDayBounds } from '@shared/local-date'

type Tab = 'focus' | 'day' | 'projects' | 'settings'
type NotchState = 'collapsed' | 'open' | 'closing'
type HeaderSlide = { id: string; label: string; value?: string; ms?: number; compactMs?: boolean; count?: number }

/** Matches NOTCH_HEIGHT in the main process: the window is exactly the pill while collapsed. */
const NOTCH_HEIGHT = 30
/** The pill with only the stats carousel inside; each quick action adds a button's width. */
const NOTCH_BASE_WIDTH = 264
const NOTCH_ACTION_WIDTH = 26
/** The quick actions the collapsed pill offers right now, in display order. */
type NotchQuickActionId = 'start-day' | 'end-day' | 'finish-rest' | 'lunch' | 'break' | 'parallel' | 'switch' | 'hide'
function notchQuickActionIds(settings: NotchSettings | undefined, workdayOpen: boolean, workdayDue: boolean, resting: boolean): NotchQuickActionId[] {
  if (!settings) return []
  const ids: NotchQuickActionId[] = []
  const { actions } = settings
  // End day appears only once the planned workday is over; a closed day only offers starting a new one.
  if (actions.day) {
    if (!workdayOpen) ids.push('start-day')
    else if (workdayDue) ids.push('end-day')
  }
  if (resting && (actions.lunch || actions.break)) ids.push('finish-rest')
  else if (workdayOpen) {
    if (actions.lunch) ids.push('lunch')
    if (actions.break) ids.push('break')
  }
  if (workdayOpen) {
    if (actions.parallel) ids.push('parallel')
    if (actions.switch) ids.push('switch')
  }
  if (actions.hide) ids.push('hide')
  return ids
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

function SlideValue({ slide, locale }: { slide: HeaderSlide; locale: Locale }): React.JSX.Element | null {
  if (slide.ms !== undefined) return <b><AnimatedDuration ms={slide.ms} compact={slide.compactMs} locale={locale} /></b>
  if (slide.count !== undefined) return <b><AnimatedNumber value={slide.count} /></b>
  return slide.value ? <b>{slide.value}</b> : null
}

/** The window height that shows the whole current page without scrolling. */
function contentFitHeight(content: HTMLElement): number {
  // The scroll container fills all spare window space, so its scrollHeight
  // cannot tell us whether a short page should shrink the window. Measure
  // the actual page inside it instead.
  const page = Array.from(content.children).find((element) => element.classList.contains('page-stack')) as HTMLElement | undefined
  const styles = window.getComputedStyle(content)
  const chromeHeight = window.innerHeight - content.clientHeight
  const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
  const pageHeight = page ? Math.ceil(page.getBoundingClientRect().height) : content.scrollHeight
  return chromeHeight + pageHeight + verticalPadding + 8
}

function taskTouchesWorkday(task: Task, workdayStartedAt: number, now: number): boolean {
  return task.intervals.some((interval) => interval.startedAt <= now && (interval.endedAt ?? now) >= workdayStartedAt)
}

export default function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [tab, setTab] = useState<Tab>('focus')
  const [compact, setCompact] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | undefined>()
  const [editingIntervalId, setEditingIntervalId] = useState<string | undefined>()
  const [defaultMode, setDefaultMode] = useState<StartMode>('parallel')
  const [showPlannedTasks, setShowPlannedTasks] = useState(false)
  const [compactHovered, setCompactHovered] = useState(false)
  const [compactAnchor, setCompactAnchor] = useState<'top' | 'bottom'>('top')
  const [dockSide, setDockSide] = useState<'left' | 'right' | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [notchEdge,setNotchEdge]=useState<'top'|'bottom'>('top')
  const notchElement=useRef<HTMLDivElement>(null)
  useEffect(()=>window.workBuddy.onNotchEdge(setNotchEdge),[])
  const [notch, setNotchState] = useState<NotchState | null>(null)
  /** True once the open notch finished growing; fitting the window before that would fight the motion. */
  const [notchSettled, setNotchSettled] = useState(false)
  const [notchTravelHidden, setNotchTravelHidden] = useState(false)
  const notchTravelling = useRef(false)
  useEffect(() => window.workBuddy.onNotchTravel((hidden) => {
    notchTravelling.current = hidden
    setNotchTravelHidden(hidden)
    if (hidden) window.clearTimeout(notchOpenTimer.current)
  }), [])
  const [windowLeaving, setWindowLeaving] = useState(false)
  /** The pill tucked itself away on request; it slides back when the timer runs out. */
  const [notchSnoozed, setNotchSnoozed] = useState(false)
  const notchSnoozedRef = useRef(false)
  const notchSnoozeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(notchSnoozeTimer.current), [])
  // The main process watches the cursor so a notch opened by click still closes when the pointer leaves.
  useEffect(() => window.workBuddy.onNotchPointer((inside) => { if (notchRef.current === 'open') hoverNotchRef.current(inside) }), [])
  const snoozeNotch = (seconds: number): void => {
    window.clearTimeout(notchOpenTimer.current)
    window.clearTimeout(notchSnoozeTimer.current)
    notchSnoozedRef.current = true
    setNotchSnoozed(true)
    notchSnoozeTimer.current = window.setTimeout(() => {
      notchSnoozedRef.current = false
      setNotchSnoozed(false)
      // Coming back under a resting pointer must not spring it open.
      notchHoverBlocked.current = true
    }, Math.max(1, seconds) * 1000)
  }
  useEffect(()=>{
    if(!notch)return
    let frame=0,last='',stable=0
    const update=()=>{
      frame=0
      const element=notchElement.current
      if(element){
        const face=(element.firstElementChild as HTMLElement|null)??element
        const r=element.getBoundingClientRect(),style=getComputedStyle(face)
        const rect={x:r.x,y:r.y,width:r.width,height:r.height,radius:Math.max(parseFloat(style.borderTopLeftRadius)||0,parseFloat(style.borderBottomLeftRadius)||0)}
        const key=JSON.stringify(rect)
        if(key!==last){last=key;stable=0;void window.workBuddy.setNotchSurface(rect)}else stable++
      }else stable++
      if(stable<8)frame=requestAnimationFrame(update)
    }
    const sample=()=>{stable=0;if(!frame)frame=requestAnimationFrame(update)}
    const observer=new ResizeObserver(sample)
    if(notchElement.current)observer.observe(notchElement.current)
    window.addEventListener('resize',sample)
    sample()
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',sample)}
  },[notch,notchEdge,notchTravelHidden,notchSnoozed,windowLeaving])
  const notchRef = useRef<NotchState | null>(null)
  const hoverNotchRef = useRef<(inside: boolean) => void>(() => {})
  const notchOpenTimer = useRef<number | undefined>(undefined)
  const notchCloseTimer = useRef<number | undefined>(undefined)
  const notchDrag = useRef<{ startX: number; startY:number; moved: boolean; pending: boolean } | null>(null)
  const notchHoverBlocked = useRef(false)
  const notchHovered = useRef(false)
  const notchCloseFinishing = useRef(false)
  const notchSuppressClick = useRef(false)
  const compactOpenTimer = useRef<number | undefined>(undefined)
  const compactCloseTimer = useRef<number | undefined>(undefined)
  const compactTasksOpen = useRef(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null)
  // The active-tab pill slides between buttons on its own measured track: a shared-layout
  // animation would scale it through the move and smear its corners.
  const tabBarRef = useRef<HTMLElement | null>(null)
  const [tabPill, setTabPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const nav = tabBarRef.current
    if (!nav) return
    const measure = (): void => {
      const active = nav.querySelector<HTMLElement>('button.active')
      if (active) setTabPill({ left: active.offsetLeft, width: active.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [tab, compact, dockSide, notch, snapshot?.settings.locale])
  const attachContent = useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element
    setContentElement(element)
  }, [])

  const setNotch = (next: NotchState | null): void => {
    notchRef.current = next
    setNotchState(next)
    setNotchSettled(false)
  }

  const [loadFailed, setLoadFailed] = useState(false)
  const [actionError, setActionError] = useState('')
  /** An absence the main process noticed while a task ran; stays until the user decides what it was. */
  const [idlePeriod, setIdlePeriod] = useState<IdlePeriod | null>(null)
  const [idleBusy, setIdleBusy] = useState(false)
  const actionErrorTimer = useRef<number | undefined>(undefined)

  const reload = async (): Promise<void> => {
    try {
      setSnapshot(await window.workBuddy.getSnapshot())
      setLoadFailed(false)
    } catch (error) {
      console.error(error)
      setLoadFailed(true)
    }
  }

  /** Runs a user action; on failure shows a short message and resyncs, since local state may be stale. */
  const attempt = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      setActionError(errorText(error, translator(snapshot?.settings.locale ?? 'uk'), 'saveFailed'))
      window.clearTimeout(actionErrorTimer.current)
      actionErrorTimer.current = window.setTimeout(() => setActionError(''), 5000)
      void reload()
    }
  }

  useEffect(() => {
    void reload()
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const unsubscribe = window.workBuddy.onDataChanged(reload)
    const unsubscribeSettings = window.workBuddy.onOpenSettings(() => {
      setCompact(false)
      setDockSide(null)
      setNotch(null)
      window.workBuddy.setWindowMode('expanded')
      setTab('settings')
    })
    const unsubscribeDockSide = window.workBuddy.onDockSide(setDockSide)
    const unsubscribeSound = window.workBuddy.onPlaySound((sound, volume) => { void playNotificationSound(sound, undefined, volume).catch(() => undefined) })
    const unsubscribeIdle = window.workBuddy.onIdleDetected(setIdlePeriod)
    void window.workBuddy.getPendingIdle().then((period) => { if (period) setIdlePeriod(period) }).catch(() => undefined)
    return () => {
      window.clearInterval(clock)
      unsubscribe()
      unsubscribeSettings()
      unsubscribeDockSide()
      unsubscribeSound()
      unsubscribeIdle()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setSlideIndex((index) => index + 1), 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    window.clearTimeout(actionErrorTimer.current)
    window.clearTimeout(notchOpenTimer.current)
    window.clearTimeout(notchCloseTimer.current)
    if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
    if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
  }, [])

  useEffect(() => {
    if (!snapshot) return
    document.documentElement.lang = snapshot.settings.locale
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme = snapshot.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : snapshot.settings.theme
    document.documentElement.dataset.theme = theme
  }, [snapshot?.settings])

  const t = useMemo(() => translator(snapshot?.settings.locale ?? 'uk'), [snapshot?.settings.locale])
  const taskLabel = (task: Task): string => task.notes.trim() || task.title.trim()
  const openWorkdayStartedAt = snapshot?.workday?.endedAt === null ? snapshot.workday.startedAt : undefined
  const workdayTasks = snapshot && openWorkdayStartedAt
    ? snapshot.tasks.filter((task) => taskTouchesWorkday(task, openWorkdayStartedAt, now))
    : []
  const liveTasks = workdayTasks.filter((task) => task.status === 'running')
  const focusTasks = workdayTasks
  const activeFocusTasks = focusTasks.filter((task) => task.status !== 'stopped')
  const liveTotal = liveTasks.reduce((total, task) => total + taskDuration(task, now), 0)
  const workedMs = unionDuration(dayIntervals(workdayTasks, now), now)
  const activeRest = snapshot?.rests.find((rest) => rest.status !== 'completed')
  const restRunning = activeRest?.status === 'running'
  const lunchActive = restRunning && activeRest?.type === 'lunch'
  const compactRows = compactHovered ? Math.max(1, activeFocusTasks.length + (activeRest ? 1 : 0)) : activeRest && !restRunning ? 2 : 1
  const compactPrimaryTask = restRunning ? null : liveTasks[0] ?? activeFocusTasks[0] ?? null
  const compactExtraTasks = compactHovered ? activeFocusTasks.filter((task) => task.id !== compactPrimaryTask?.id) : []
  const scheduledEndAt = snapshot ? scheduledWorkdayEndAt(snapshot.settings, snapshot.workday, snapshot.rests, now) : null
  const showFocusEndDay = scheduledEndAt !== null && now >= scheduledEndAt
  const [todayStart, todayEnd] = localDayBounds(now)
  const focusTimelineSegments = workdayTasks.flatMap((task) => {
    const project = snapshot?.projects.find((item) => item.id === task.projectId)
    const label = taskLabel(task)
    return task.intervals.flatMap((interval) => {
      const startedAt = Math.max(interval.startedAt, todayStart)
      const endedAt = Math.min(interval.endedAt ?? now, todayEnd)
      return endedAt > startedAt ? [{ id: interval.id, startedAt, endedAt, color: project?.color ?? '#b8e986', label }] : []
    })
  })
  const focusTimelineStart = focusTimelineSegments.length ? Math.min(...focusTimelineSegments.map((segment) => segment.startedAt)) : now
  const focusTimelineEnd = focusTimelineSegments.length
    ? Math.max(focusTimelineStart + 60_000, ...focusTimelineSegments.map((segment) => segment.endedAt))
    : now
  const focusTimelineSpan = focusTimelineEnd - focusTimelineStart
  const canContinueDay = Boolean(snapshot?.workday && snapshot.workday.endedAt !== null && snapshot.workday.startedAt >= todayStart)

  const headerSlides = ((): HeaderSlide[] => {
    if (!snapshot) return []
    const todayTasks = snapshot.tasks.filter((task) => task.intervals.some((interval) => interval.startedAt < todayEnd && (interval.endedAt ?? now) > todayStart))
    const workedToday = unionDuration(dayIntervals(todayTasks, now), now)
    if (todayTasks.length === 0 && !openWorkdayStartedAt) return [{ id: 'hello', label: t('hello') }]
    const slides: HeaderSlide[] = [{ id: 'worked', label: t('statWorked'), ms: workedToday }]
    const running = todayTasks.filter((task) => task.status === 'running').length
    if (running > 0) slides.push({ id: 'live', label: t('statLive'), count: running })
    if (todayTasks.length > 0) slides.push({ id: 'tasks', label: t('statTasks'), count: todayTasks.length })
    const byProject = new Map<string, Task[]>()
    for (const task of todayTasks) if (task.projectId) byProject.set(task.projectId, [...(byProject.get(task.projectId) ?? []), task])
    const top = [...byProject.entries()]
      .map(([projectId, projectTasks]) => ({ projectId, ms: unionDuration(dayIntervals(projectTasks, now), now) }))
      .sort((first, second) => second.ms - first.ms)[0]
    const topProject = top ? snapshot.projects.find((project) => project.id === top.projectId) : undefined
    if (topProject && top.ms > 0) slides.push({ id: 'top', label: `${t('statTopProject')} ${topProject.name}`, ms: top.ms, compactMs: true })
    const breakMs = snapshot.rests.filter((rest) => rest.type === 'break').flatMap((rest) => rest.intervals)
      .reduce((total, interval) => total + Math.max(0, Math.min(interval.endedAt ?? now, todayEnd) - Math.max(interval.startedAt, todayStart)), 0)
    if (breakMs > 0) slides.push({ id: 'breaks', label: t('statBreaks'), ms: breakMs, compactMs: true })
    if (openWorkdayStartedAt && scheduledEndAt !== null && scheduledEndAt > now) slides.push({ id: 'until-end', label: t('statUntilEnd'), ms: scheduledEndAt - now, compactMs: true })
    return slides
  })()
  const headerSlide = headerSlides.length ? headerSlides[slideIndex % headerSlides.length] : undefined

  const docked = dockSide !== null

  useEffect(() => {
    if (!compact || docked || notch) return
    void window.workBuddy.setWindowMode('compact', compactRows).then((anchor) => {
      if (anchor === 'top' || anchor === 'bottom') setCompactAnchor(anchor)
    })
  }, [compact, compactRows, docked, notch])

  useEffect(() => {
    if (compact || docked || (notch&&notch!=='open')) return
    void window.workBuddy.setWindowEditor(editorOpen)
  }, [compact, docked, notch, editorOpen])

  // Only explicitly disabling the notch setting leaves this mode automatically.
  const notchEnabled = snapshot?.settings.notchEnabled ?? false
  useEffect(() => {
    if (!notch || notchEnabled) return
    void window.workBuddy.setWindowMode('expanded').then(() => setNotch(null))
  }, [notch, notchEnabled])

  const notchSettings = snapshot?.settings.notch
  const notchOpenOn = notchSettings?.openOn ?? 'hover'
  const notchHoverDelay = notchSettings?.hoverDelayMs ?? 400
  const notchActionIds = notchQuickActionIds(notchSettings, snapshot?.workday?.endedAt === null, showFocusEndDay, Boolean(activeRest))
  const notchPillWidth = NOTCH_BASE_WIDTH + NOTCH_ACTION_WIDTH * notchActionIds.length
  // The collapsed window is exactly the pill, so it follows the pill as actions come and go.
  const sentPillWidth = useRef(0)
  useEffect(() => {
    if (notch !== 'collapsed' || sentPillWidth.current === notchPillWidth || notchDrag.current) return
    sentPillWidth.current = notchPillWidth
    void window.workBuddy.setWindowMode('notch', 1, notchPillWidth)
  }, [notch, notchPillWidth])

  // With auto height on, every change in the page's size (a tab switch, a new or edited task,
  // a panel opening) refits the window, after the motion settles. The task editor sizes the
  // window itself, so fitting waits until it closes.
  const autoFitHeight = snapshot?.settings.autoFitHeight ?? false
  useEffect(() => {
    const content = contentElement
    // The open notch always fits its content, including expanding planned-task panels.
    if ((!autoFitHeight && notch !== 'open') || !content || compact || docked || (notch && (notch !== 'open' || !notchSettled)) || editorOpen) return
    let timer: number | undefined
    const schedule = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void window.workBuddy.fitWindowToContent(contentFitHeight(content)), 60)
    }
    const resize = new ResizeObserver(schedule)
    const observePages = (): void => {
      resize.disconnect()
      for (const child of Array.from(content.children)) resize.observe(child)
      schedule()
    }
    const pages = new MutationObserver(observePages)
    pages.observe(content, { childList: true })
    observePages()
    return () => {
      window.clearTimeout(timer)
      resize.disconnect()
      pages.disconnect()
    }
  }, [autoFitHeight, contentElement, compact, docked, notch, notchSettled, editorOpen])

  if (!snapshot) {
    const loadingT = translator(navigator.language.toLowerCase().startsWith('uk') ? 'uk' : 'en')
    return <div className="app-shell app-shell--loading">
      {loadFailed
        ? <div className="load-error"><p className="form-error">{loadingT('loadError')}</p><button className="secondary-button" onClick={() => void reload()}>{loadingT('retry')}</button></div>
        : <div className="loading-mark"><Sparkles size={22} /></div>}
    </div>
  }

  const startInstant = (mode: StartMode): Promise<void> => attempt(async () => setSnapshot(await window.workBuddy.startTask({ mode })))

  const continueDay = (): Promise<void> => attempt(async () => setSnapshot(await window.workBuddy.resumeWorkday()))

  /**
   * Windows cannot animate a window resize, so the view fades out first, the window changes
   * size while nothing is visible, and the new view fades in: no clipped or jumping content.
   */
  const switchWindow = async (change: () => Promise<void>): Promise<void> => {
    setWindowLeaving(true)
    await sleep(170)
    try {
      await change()
    } finally {
      setWindowLeaving(false)
    }
  }

  const resetCompactHover = (): void => {
    if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
    if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
    compactTasksOpen.current = false
    setCompactHovered(false)
  }

  const dock = (): Promise<void> => {
    if (editorOpen) return Promise.resolve()
    return switchWindow(async () => {
      resetCompactHover()
      const side = await window.workBuddy.setWindowMode('docked')
      setNotch(null)
      setDockSide(side === 'left' ? 'left' : 'right')
    })
  }

  const undock = (): Promise<void> => switchWindow(async () => {
    await window.workBuddy.setWindowMode(compact ? 'compact' : 'expanded', compactRows)
    setDockSide(null)
  })

  const enterNotch = (): Promise<void> => {
    if (editorOpen) return Promise.resolve()
    return switchWindow(async () => {
      resetCompactHover()
      sentPillWidth.current = notchPillWidth
      const edge=await window.workBuddy.setWindowMode('notch', 1, notchPillWidth)
      setNotchEdge(edge==='bottom'?'bottom':'top')
      setCompact(false)
      setDockSide(null)
      setNotch('collapsed')
    })
  }

  /** Explicitly leaves notch mode for a normal movable window. */
  const exitNotch = async (): Promise<void> => {
    window.clearTimeout(notchOpenTimer.current)
    window.clearTimeout(notchCloseTimer.current)
    if (notchRef.current === 'open') {
      await window.workBuddy.setWindowMode('expanded')
      setNotch(null)
      return
    }
    await switchWindow(async () => {
      await window.workBuddy.setWindowMode('expanded')
      setNotch(null)
    })
  }

  const openNotch = async (): Promise<void> => {
    if (notchRef.current !== 'collapsed' || notchTravelling.current) return
    await window.workBuddy.setWindowMode('notch-open')
    if (notchRef.current === 'collapsed') setNotch('open')
  }

  const finishNotchClose = async (): Promise<void> => {
    if (notchRef.current !== 'closing' || notchCloseFinishing.current) return
    notchCloseFinishing.current = true
    try {
      sentPillWidth.current = notchPillWidth
      await window.workBuddy.setWindowMode('notch', 1, notchPillWidth)
      if (notchRef.current === 'closing') {
        // Re-entry during the exit cannot queue an opening. Leave the pill first.
        notchHoverBlocked.current = notchHovered.current
        setNotch('collapsed')
      }
    } finally {
      notchCloseFinishing.current = false
    }
  }

  const hoverNotch = (inside: boolean): void => {
    notchHovered.current = inside
    window.clearTimeout(notchOpenTimer.current)
    window.clearTimeout(notchCloseTimer.current)
    // Once the exit starts it must finish, even if the pointer comes back.
    if (notchRef.current === 'closing') return
    // A pill being dragged, or just dropped under the cursor, must not spring open.
    if (notchTravelling.current || notchSnoozedRef.current || notchDrag.current || (inside && notchHoverBlocked.current)) return
    if (!inside) notchHoverBlocked.current = false
    if (inside) {
      if (notchRef.current === 'collapsed' && notchOpenOn === 'hover') notchOpenTimer.current = window.setTimeout(() => void openNotch(), notchHoverDelay)
    } else if (notchRef.current === 'open') {
      notchCloseTimer.current = window.setTimeout(() => {
        if (notchRef.current === 'open' && !editorOpen) setNotch('closing')
      }, 450)
    }
  }
  hoverNotchRef.current = hoverNotch

  /** Drag the pill to either edge; clicking only expands it within notch mode. */
  const notchPointer = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      window.clearTimeout(notchOpenTimer.current)
      window.clearTimeout(notchCloseTimer.current)
      notchDrag.current = { startX: event.screenX,startY:event.screenY, moved: false, pending: false }
      void window.workBuddy.dragNotch('start')
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>): void => {
      const drag = notchDrag.current
      if (!drag || (!drag.moved && Math.hypot(event.screenX-drag.startX,event.screenY-drag.startY)<4) || drag.pending) return
      drag.moved = true
      drag.pending = true
      void window.workBuddy.dragNotch('move').finally(() => { drag.pending = false })
    },
    onPointerUp: (): void => {
      const drag = notchDrag.current
      notchDrag.current = null
      if(!drag)return
      void window.workBuddy.dragNotch('end')
      if (!drag.moved) return
      notchSuppressClick.current = true
      notchHoverBlocked.current = true
    },
    onClick: (): void => {
      if (notchSuppressClick.current) {
        notchSuppressClick.current = false
        return
      }
      void openNotch()
    }
  }
  const { onPointerUp: endNotchDrag } = notchPointer
  const notchDragButton = (
    <button
      className="icon-button icon-button--quiet notch-drag-handle no-drag"
      {...notchPointer}
      onPointerCancel={endNotchDrag}
      onLostPointerCapture={endNotchDrag}
      onClick={(event) => { event.stopPropagation(); notchSuppressClick.current = false }}
      onMouseEnter={() => { window.clearTimeout(notchOpenTimer.current); notchHoverBlocked.current = true }}
      onMouseLeave={() => { if (!notchDrag.current) { notchHoverBlocked.current = false; hoverNotch(true) } }}
      title={t('notchDrag')}
      aria-label={t('notchDrag')}
    ><GripVertical size={16} /></button>
  )

  const startDayWithTask = (): Promise<void> => attempt(async () => {
    await window.workBuddy.startWorkday()
    setSnapshot(await window.workBuddy.startTask({ mode: 'parallel' }))
  })

  /** Icon-only shortcuts inside the collapsed pill; hovering them never springs the notch open. */
  const notchQuickActions = notchActionIds.map((id) => {
    switch (id) {
      case 'start-day': return { id, icon: <Sunrise size={14} />, title: t('startDay'), disabled: false, live: false, run: () => mutate(window.workBuddy.startWorkday()) }
      case 'end-day': return { id, icon: <Sunset size={14} />, title: t('endDay'), disabled: false, live: false, run: () => void endDay() }
      case 'finish-rest': return { id, icon: <Square size={11} fill="currentColor" />, title: t('finishRest'), disabled: !activeRest, live: true, run: () => { if (activeRest) void mutate(window.workBuddy.completeRest(activeRest.id)) } }
      case 'lunch': return { id, icon: <Coffee size={14} />, title: t('startLunch'), disabled: false, live: false, run: () => mutate(window.workBuddy.startRest('lunch')) }
      case 'break': return { id, icon: <Dumbbell size={14} />, title: t('takeBreak'), disabled: false, live: false, run: () => mutate(window.workBuddy.startRest('break')) }
      case 'parallel': return { id, icon: <Plus size={15} />, title: snapshot.workday?.endedAt === null ? t('addParallel') : t('startDay'), disabled: restRunning, live: false, run: () => snapshot.workday?.endedAt === null ? startInstant('parallel') : startDayWithTask() }
      case 'switch': return { id, icon: <ArrowRightLeft size={14} />, title: t('switchTask'), disabled: restRunning || liveTasks.length === 0, live: false, run: () => startInstant('switch') }
      case 'hide': return { id, icon: <EyeOff size={14} />, title: `${t('notchActionHide')} · ${snapshot.settings.notch.hideSeconds} ${t('secondsShort')}`, disabled: false, live: false, run: () => snoozeNotch(snapshot.settings.notch.hideSeconds) }
    }
  })
  const notchActionBar = notchQuickActions.length > 0 && (
    <div
      className="notch-actions no-drag"
      onMouseEnter={() => { window.clearTimeout(notchOpenTimer.current); notchHoverBlocked.current = true }}
      onMouseLeave={() => { if (!notchDrag.current) { notchHoverBlocked.current = false; hoverNotch(true) } }}
    >
      {notchQuickActions.map((action) => (
        <button key={action.id} className={`notch-action ${action.live ? 'notch-action--live' : ''}`} disabled={action.disabled} title={action.title} aria-label={action.title} onClick={(event) => { event.stopPropagation(); void action.run() }}>{action.icon}</button>
      ))}
    </div>
  )

  const openEdit = async (task: Task, intervalId?: string): Promise<void> => {
    if (compact) {
      await switchWindow(async () => {
        await window.workBuddy.setWindowMode('expanded')
        setCompact(false)
      })
    }
    setEditingTask(task)
    setEditingIntervalId(intervalId)
    setDefaultMode('parallel')
    setEditorOpen(true)
  }

  const toggleCompact = (): Promise<void> => switchWindow(async () => {
    const next = !compact
    if (!next) resetCompactHover()
    const anchor = await window.workBuddy.setWindowMode(next ? 'compact' : 'expanded', next ? 1 : compactRows)
    if (anchor === 'top' || anchor === 'bottom') setCompactAnchor(anchor)
    setNotch(null)
    setCompact(next)
  })

  const mutate = (promise: Promise<AppSnapshot>): Promise<void> => attempt(async () => setSnapshot(await promise))

  const revealCompactTasks = (immediate = false): void => {
    if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
    if (compactTasksOpen.current) return
    if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
    if (immediate) {
      compactTasksOpen.current = true
      setCompactHovered(true)
    } else compactOpenTimer.current = window.setTimeout(() => {
      compactTasksOpen.current = true
      setCompactHovered(true)
    }, snapshot.settings.compact.revealDelayMs)
  }

  const concealCompactTasks = (): void => {
    if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
    if (!compactTasksOpen.current) return
    if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
    compactCloseTimer.current = window.setTimeout(() => {
      compactTasksOpen.current = false
      setCompactHovered(false)
    }, Math.max(500, snapshot.settings.compact.revealDelayMs))
  }

  const keepIdle = (): void => {
    setIdlePeriod(null)
    void window.workBuddy.dismissIdle().catch(() => undefined)
  }

  const resolveIdle = (resolution: IdleResolution): Promise<void> => {
    if (!idlePeriod) return Promise.resolve()
    setIdleBusy(true)
    return attempt(async () => {
      setSnapshot(await window.workBuddy.resolveIdle(idlePeriod, resolution))
      setIdlePeriod(null)
    }).finally(() => setIdleBusy(false))
  }

  const handleEditorSaved = (result: AppSnapshot): void => {
    setSnapshot(result)
    setEditingTask(undefined)
    setEditingIntervalId(undefined)
    setEditorOpen(false)
  }

  const handleEditorClose = (): void => {
    setEditingTask(undefined)
    setEditingIntervalId(undefined)
    setEditorOpen(false)
  }

  const endDay = (): Promise<void> => attempt(async () => {
    setSnapshot(await window.workBuddy.endWorkday())
    setTab('day')
  })

  const fitWindowToContent = (): void => {
    const content = contentRef.current
    if (!content || compact) return
    void window.workBuddy.fitWindowToContent(contentFitHeight(content))
  }

  const navItems: Array<{ id: Tab; label: string; icon: typeof Clock3 }> = [
    { id: 'focus', label: t('focus'), icon: Clock3 },
    { id: 'day', label: t('day'), icon: BarChart3 },
    { id: 'projects', label: t('projectsTab'), icon: BriefcaseBusiness },
    { id: 'settings', label: t('settings'), icon: Settings2 }
  ]

  const stage = {
    initial: false,
    animate: { opacity: windowLeaving ? 0 : 1, scale: windowLeaving ? 0.97 : 1 },
    transition: { duration: 0.17, ease },
    style: { transformOrigin: compact && compactAnchor === 'bottom' ? '50% 100%' : '50% 0%' }
  } as const

  if (dockSide) {
    return (
      <motion.main className="app-shell app-shell--docked" {...stage} style={{ transformOrigin: dockSide === 'left' ? '0% 50%' : '100% 50%' }}>
        <div className={`dock-pill dock-pill--${dockSide}`}>
          <div className="dock-grip drag-region" title={t('dockDrag')} />
          <button className="dock-timer no-drag" onClick={()=>void undock()} title={t('dockedOpen')} aria-label={t('dockedOpen')}>
            <span className={`status-dot ${liveTasks.length ? 'status-dot--live' : ''}`} />
            <strong><AnimatedHm ms={workedMs}/></strong>
          </button>
        </div>
      </motion.main>
    )
  }

  const notchOpen = notch === 'open'
  const appHeader = (
    <header className={`app-header ${notch ? 'app-header--notch' : 'drag-region'}`}>
      <div className="brand-lockup">
        <div className="brand-mark"><span /></div>
        <div className="brand-copy">
          <strong>{t('appName')}</strong>
          <AnimatePresence mode="wait" initial={false}>
            {headerSlide && <motion.small key={headerSlide.id} className="brand-slide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }}>
              <span className="brand-slide__label">{headerSlide.label}</span><SlideValue slide={headerSlide} locale={t.locale} />
            </motion.small>}
          </AnimatePresence>
        </div>
      </div>
      <div className="window-actions no-drag">
        {notch ? <>
          {notchDragButton}
          <button className="icon-button icon-button--quiet" onClick={() => void exitNotch()} title={t('notchPin')} aria-label={t('notchPin')}><ArrowDownFromLine size={15} /></button>
          <button className="icon-button icon-button--quiet" onClick={()=>void dock()} title={t('dockToEdge')} aria-label={t('dockToEdge')}><ArrowRightToLine size={15}/></button>
          <button className="icon-button icon-button--quiet" onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={15} /></button>
        </> : <>
          {notchEnabled && <button className="icon-button icon-button--quiet" onClick={() => void enterNotch()} title={t('notchMode')} aria-label={t('notchMode')}><ArrowUpToLine size={15} /></button>}
          <button className="icon-button icon-button--quiet" onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={15} /></button>
          <button className="icon-button icon-button--quiet" onClick={() => void toggleCompact()} title={compact ? t('expand') : t('compact')}>{compact ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
          <button className="icon-button icon-button--quiet" onClick={() => void dock()} title={t('dockToEdge')} aria-label={t('dockToEdge')}><ArrowRightToLine size={15} /></button>
        </>}
      </div>
    </header>
  )

  const idleBanner = (
    <StackCollapse open={Boolean(idlePeriod)}>
      {idlePeriod && <section className="idle-banner no-drag" role="alertdialog" aria-labelledby="idle-banner-title">
        <div className="idle-banner__icon"><UserRoundX size={17} /></div>
        <div className="idle-banner__copy">
          <strong id="idle-banner-title">{t('idleReturnTitle')}</strong>
          <p>{t('idleReturnBody').replace('{from}', formatClock(idlePeriod.startedAt, t.locale)).replace('{to}', formatClock(idlePeriod.endedAt, t.locale)).replace('{duration}', formatDuration(idlePeriod.endedAt - idlePeriod.startedAt, true, t.locale))}</p>
        </div>
        <div className="idle-banner__actions">
          <button type="button" className="secondary-button" disabled={idleBusy} onClick={keepIdle}>{t('idleKeep')}</button>
          <button type="button" className="secondary-button" disabled={idleBusy} onClick={() => void resolveIdle('discard')}>{t('idleDiscard')}</button>
          <button type="button" className="primary-button" disabled={idleBusy} onClick={() => void resolveIdle('break')}><Dumbbell size={13} />{t('idleToBreak')}</button>
        </div>
      </section>}
    </StackCollapse>
  )

  const pomodoroTotalMs = snapshot.settings.breaks.everyMinutes * 60_000
  const pomodoroWorkedMs = snapshot.settings.pomodoro.enabled && snapshot.settings.breaks.enabled && snapshot.workday?.endedAt === null && !activeRest
    ? Math.min(pomodoroTotalMs, workSinceLastRest(snapshot.workday, snapshot.rests, snapshot.tasks, now))
    : null
  const pomodoroCard = pomodoroWorkedMs !== null && (
    <section className={`pomodoro-card ${pomodoroWorkedMs >= pomodoroTotalMs ? 'is-due' : ''} ${liveTasks.length ? 'is-live' : ''}`} aria-live="polite">
      <div className="pomodoro-card__top">
        <span className="pomodoro-card__icon"><Hourglass size={14} /></span>
        <div><span className="eyebrow">{pomodoroWorkedMs >= pomodoroTotalMs ? t('pomodoroBreakNow') : t('pomodoroUntilBreak')}</span><strong><AnimatedDuration ms={Math.max(0, pomodoroTotalMs - pomodoroWorkedMs)} /></strong></div>
        <small>{snapshot.settings.breaks.everyMinutes} {t('minutes')} · {snapshot.settings.breaks.durationMinutes} {t('minutes')}</small>
      </div>
      <div className="pomodoro-card__bar"><span style={{ width: `${Math.min(100, pomodoroWorkedMs / pomodoroTotalMs * 100)}%` }} /></div>
    </section>
  )

  const expandedView = (
          <motion.div key="expanded" className="expanded-view" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
            <nav ref={tabBarRef} className="tab-bar no-drag">
              {tabPill && <motion.span className="tab-pill" initial={false} animate={{ left: tabPill.left, width: tabPill.width }} transition={{ type: 'tween', duration: 0.22, ease }} />}
              {navItems.map(({ id, label, icon: Icon }) => (
                <button key={id} className={`${tab === id ? 'active' : ''} ${id === 'settings' ? 'tab-icon-only' : ''}`} onClick={() => setTab(id)} title={id === 'settings' ? label : undefined} aria-label={label}>
                  <Icon size={15} />{id !== 'settings' && <span>{label}</span>}
                </button>
              ))}
            </nav>

            {idleBanner}
            <div ref={attachContent} className="content-scroll no-drag">
              <AnimatePresence mode="wait">
                {tab === 'focus' && (
                  <motion.div key="focus" className="page-stack" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.16, ease }}>
                    <RestControl snapshot={snapshot} now={now} t={t} onSnapshot={setSnapshot} attempt={attempt} />
                    {pomodoroCard}
                    {openWorkdayStartedAt && <section className="focus-hero">
                      <div className="focus-hero__top">
                        <div>
                          <span className="eyebrow">{lunchActive ? t('workedToday') : liveTasks.length ? `${liveTasks.length} ${t('activeNow')}` : t('today')}</span>
                          <strong><AnimatedDuration ms={lunchActive ? workedMs : liveTotal} /></strong>
                        </div>
                        {!lunchActive && <div className="focus-hero__actions no-drag">
                          <button disabled={!liveTasks.length} onClick={() => mutate(window.workBuddy.pauseAllTasks())}><Pause size={17} fill="currentColor" /><span>{t('pauseAll')}</span></button>
                        </div>}
                      </div>
                      {(lunchActive || focusTimelineSegments.length > 0) && <div className="focus-timeline" aria-label={t('timeline')}>
                        {focusTimelineSegments.map((segment) => {
                          const left = ((segment.startedAt - focusTimelineStart) / focusTimelineSpan) * 100
                          const width = ((segment.endedAt - segment.startedAt) / focusTimelineSpan) * 100
                          return <span key={segment.id} title={`${segment.label} · ${formatDuration(segment.endedAt - segment.startedAt, true, t.locale)}`} style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, background: segment.color }} />
                        })}
                      </div>}
                    </section>}

                    <div className="focus-actions">
                      {!lunchActive && <div className="focus-actions__primary">
                        <button className="primary-button" disabled={restRunning} onClick={() => snapshot.workday?.endedAt === null ? startInstant('parallel') : startDayWithTask()}><Plus size={17} />{snapshot.workday?.endedAt === null ? (liveTasks.length ? t('addParallel') : t('startTask')) : t('startDay')}</button>
                        {liveTasks.length > 0 && <button className="secondary-button" disabled={restRunning} onClick={() => startInstant('switch')}>{t('switchTask')}</button>}
                        {!openWorkdayStartedAt && canContinueDay && <button className="secondary-button" onClick={() => void continueDay()} title={t('continueDayHint')}><Undo2 size={15} />{t('continueDay')}</button>}
                      </div>}
                      <div className={`focus-actions__tools ${openWorkdayStartedAt && !lunchActive ? '' : 'focus-actions__tools--planned-only'}`}>
                        {!lunchActive && snapshot.workday?.endedAt === null && <button className="secondary-button" disabled={restRunning} onClick={() => mutate(window.workBuddy.startRest('break'))}><Dumbbell size={15} />{t('takeBreak')}</button>}
                        <button className={`secondary-button planned-toggle ${showPlannedTasks ? 'active' : ''}`} onClick={() => setShowPlannedTasks((current) => !current)}><ListTodo size={15} />{t('plannedTasks')}</button>
                      </div>
                    </div>

                    <StackCollapse open={showFocusEndDay}><button className="end-day-button focus-end-day" onClick={() => void endDay()}><Square size={15} fill="currentColor" />{t('endDay')}</button></StackCollapse>

                    <StackCollapse open={showPlannedTasks}><PlannedTasksPanel snapshot={snapshot} t={t} onSnapshot={setSnapshot} /></StackCollapse>

                    {focusTasks.length === 0 ? (
                      <section className="empty-state">
                        <div className="empty-state__art"><span /><span /><span /></div>
                        <h2>{t('noTimers')}</h2>
                        <p>{t('noTimersBody')}</p>
                      </section>
                    ) : (
                      <div className="task-list">
                        <AnimatePresence initial={false}>
                          {focusTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              projects={snapshot.projects}
                              now={now}
                              t={t}
                              controlsDisabled={restRunning}
                              onPause={() => mutate(window.workBuddy.pauseTask(task.id))}
                              onResume={(mode) => mutate(window.workBuddy.resumeTask(task.id, mode))}
                              onEdit={() => openEdit(task)}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                )}

                {tab === 'day' && (
                  <DaySummary
                    key="day"
                    snapshot={snapshot}
                    now={now}
                    t={t}
                    onStartDay={() => mutate(window.workBuddy.startWorkday())}
                    onContinueDay={continueDay}
                    onEndDay={endDay}
                    onEdit={openEdit}
                    onSnapshot={setSnapshot}
                  />
                )}

                {tab === 'projects' && <ProjectsPage key="projects" snapshot={snapshot} now={now} t={t} onSnapshot={setSnapshot} />}

                {tab === 'settings' && <SettingsPage key="settings" snapshot={snapshot} t={t} onSnapshot={setSnapshot} />}
              </AnimatePresence>
            </div>
          </motion.div>
  )

  const actionErrorToast = (
    <AnimatePresence>
      {actionError && <motion.p className="form-error app-action-error no-drag" role="alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18, ease }}>{actionError}</motion.p>}
    </AnimatePresence>
  )

  const taskEditor=(
      <TaskEditor
        open={editorOpen}
        task={editingTask}
        intervalId={editingIntervalId}
        defaultMode={defaultMode}
        snapshot={snapshot}
        t={t}
        onClose={handleEditorClose}
        onSnapshot={setSnapshot}
        onSaved={handleEditorSaved}
      />
  )

  if (notch) {
    // A dark pill joined to the screen edge by concave corners, like a hardware notch; hovering
    // or clicking grows it into the full view in place. The frame carries the size, the corner
    // radius and the colour so the pill, its flared ears and the page all move as one.
    return (
      <motion.main className={`app-shell app-shell--notch app-shell--notch-${notchEdge}`} {...stage}>
        <motion.div
          data-notch-state={notch}
          ref={notchElement}
          className={`notch-frame ${notchTravelHidden || notchSnoozed ? 'notch-frame--travelling' : ''}`}
          aria-hidden={notchSnoozed}
          title={notchSnoozed ? t('notchHidden') : undefined}
          onMouseEnter={() => hoverNotch(true)}
          onMouseLeave={() => hoverNotch(false)}
          initial={false}
          animate={notchOpen
            ? { width: '100%', height: '100%', '--notch-r': '22px', '--notch-bg': 'rgba(12, 15, 12, 0.86)' }
            : { width: notchPillWidth, height: NOTCH_HEIGHT, '--notch-r': '13px', '--notch-bg': 'rgba(11, 12, 11, 1)' }}
          transition={notchOpen
            // Growing may overshoot a touch; folding back must land crisply with no creeping tail.
            ? { type: 'spring', stiffness: 520, damping: 44, mass: 0.8, '--notch-bg': { duration: 0.2, ease }, '--notch-r': { duration: 0.24, ease } }
            : { type: 'tween', duration: 0.3, ease: [0.32, 0.72, 0, 1], '--notch-bg': { duration: 0.24, ease }, '--notch-r': { duration: 0.3, ease } }}
          onAnimationComplete={() => { if (notchRef.current === 'open') setNotchSettled(true); void finishNotchClose() }}
        >
          <div className={`notch ${notchOpen ? 'notch--open' : ''}`}>
            <AnimatePresence initial={false}>
              {notchOpen
                ? <motion.div key="full" className="notch__full" style={{ transformOrigin: notchEdge === 'bottom' ? '50% 100%' : '50% 0%' }} initial={{ opacity: 0, x: '-50%', scale: 0.98 }} animate={{ opacity: 1, x: '-50%', scale: 1, transition: { duration: 0.2, ease } }} exit={{ opacity: 0, x: '-50%', scale: 0.97, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}>
                  {appHeader}
                  {expandedView}
                  {taskEditor}
                </motion.div>
                : <motion.div key="pill" className="notch-pill-row" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.14, delay: notch === 'closing' ? 0.16 : 0, ease } }} exit={{ opacity: 0, transition: { duration: 0.06 } }}>
                  {notchDragButton}
                  <button className="notch-pill" {...notchPointer} onPointerCancel={endNotchDrag} title={t('notchPillHint')}>
                  <span className={`status-dot ${liveTasks.length ? 'status-dot--live' : ''}`} />
                  <AnimatePresence mode="wait" initial={false}>
                    {headerSlide && <motion.span key={headerSlide.id} className="notch-pill__slide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }}>
                      <span className="notch-pill__label">{headerSlide.label}</span><SlideValue slide={headerSlide} locale={t.locale} />
                    </motion.span>}
                  </AnimatePresence>
                  </button>
                  {notchActionBar}
                  {notchDragButton}
                </motion.div>}
            </AnimatePresence>
          </div>
        </motion.div>
        {actionErrorToast}
      </motion.main>
    )
  }

  return (
    <motion.main className={`app-shell ${compact ? 'app-shell--compact' : ''}`} {...stage}>
      {actionErrorToast}
      {!compact && appHeader}

      <AnimatePresence mode="wait" initial={false}>
        {compact ? (
          <motion.section key="compact" className={`compact-view compact-view--${compactAnchor}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseEnter={() => revealCompactTasks()} onMouseLeave={concealCompactTasks}>
            {compactAnchor === 'bottom' && compactExtraTasks.map((task) => (
              <div className="compact-task-row compact-task-row--extra" key={task.id}>
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${task.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div><strong>{taskLabel(task)}</strong><small><AnimatedDuration ms={taskDuration(task, now)} /></small></div>
                </div>
                <div className="compact-task-actions no-drag">
                  {task.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseTask(task.id))} title={t('pause')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" disabled={restRunning} onClick={() => mutate(window.workBuddy.resumeTask(task.id, 'parallel'))} title={t('resume')}><Play size={16} fill="currentColor" /></button>}
                </div>
              </div>
            ))}
            {activeRest && (
              <div className={`compact-task-row compact-rest-row compact-rest-row--${activeRest.type}`}>
                <div className="compact-task-info drag-region">
                  {activeRest.type === 'lunch' ? <Coffee size={15} /> : <Dumbbell size={15} />}
                  <div><strong>{activeRest.type === 'lunch' ? t('lunchInProgress') : t('breakInProgress')}</strong><small>{activeRest.status === 'paused' ? t('restPaused') : <AnimatedDuration ms={restRemaining(activeRest, now)} />}</small></div>
                </div>
                <div className="compact-task-actions no-drag">
                  {activeRest.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseRest(activeRest.id))} title={t('pauseRest')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" onClick={() => mutate(window.workBuddy.resumeRest(activeRest.id))} title={t('continueRest')}><Play size={16} fill="currentColor" /></button>}
                  <button className="stop" onClick={() => mutate(window.workBuddy.completeRest(activeRest.id))} title={t('finishRest')}><Square size={13} fill="currentColor" /></button>
                </div>
                <div className="compact-window-actions no-drag">
                  <button disabled={restRunning} onClick={() => startInstant('parallel')} title={t('addParallel')}><Plus size={17} /></button>
                  {notchEnabled && <button onClick={() => void enterNotch()} title={t('notchMode')}><ArrowUpToLine size={17} /></button>}
                  <button onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={17} /></button>
                  <button onClick={() => void dock()} title={t('dockToEdge')}><ArrowRightToLine size={17} /></button>
                  <button onMouseEnter={() => revealCompactTasks(true)} onClick={() => void toggleCompact()} title={t('expand')}><ChevronDown size={17} /></button>
                </div>
              </div>
            )}
            {!restRunning && <div className="compact-task-row">
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${compactPrimaryTask?.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div>
                    <strong>{compactPrimaryTask ? taskLabel(compactPrimaryTask) : t('noTimers')}</strong>
                    <small>{compactPrimaryTask ? <AnimatedDuration ms={taskDuration(compactPrimaryTask, now)} /> : t('noTimersBody')}</small>
                  </div>
                </div>
                {compactPrimaryTask && <div className="compact-task-actions no-drag">
                  {compactPrimaryTask.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseTask(compactPrimaryTask.id))} title={t('pause')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" disabled={restRunning} onClick={() => mutate(window.workBuddy.resumeTask(compactPrimaryTask.id, 'parallel'))} title={t('resume')}><Play size={16} fill="currentColor" /></button>}
                </div>}
                <div className="compact-window-actions no-drag">
                  <button disabled={restRunning} onClick={() => startInstant('parallel')} title={t('addParallel')}><Plus size={17} /></button>
                  {notchEnabled && <button onClick={() => void enterNotch()} title={t('notchMode')}><ArrowUpToLine size={17} /></button>}
                  <button onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={17} /></button>
                  <button onClick={() => void dock()} title={t('dockToEdge')}><ArrowRightToLine size={17} /></button>
                  <button onMouseEnter={() => revealCompactTasks(true)} onClick={() => void toggleCompact()} title={t('expand')}><ChevronDown size={17} /></button>
                </div>
              </div>}
            {compactAnchor === 'top' && compactExtraTasks.map((task) => (
              <div className="compact-task-row compact-task-row--extra" key={task.id}>
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${task.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div><strong>{taskLabel(task)}</strong><small><AnimatedDuration ms={taskDuration(task, now)} /></small></div>
                </div>
                <div className="compact-task-actions no-drag">
                  {task.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseTask(task.id))} title={t('pause')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" disabled={restRunning} onClick={() => mutate(window.workBuddy.resumeTask(task.id, 'parallel'))} title={t('resume')}><Play size={16} fill="currentColor" /></button>}
                </div>
              </div>
            ))}
          </motion.section>
        ) : expandedView}
      </AnimatePresence>

      {!compact && <div className="window-bottom-edge" aria-hidden="true" />}
      {!compact && <button className="resize-fit-handle no-drag" onDoubleClick={fitWindowToContent} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fitWindowToContent() } }} title={t('fitWindowToContent')} aria-label={t('fitWindowToContent')}><span /></button>}
      {!compact && tab !== 'focus' && <div className="resize-corner" aria-hidden="true" />}

      {taskEditor}
    </motion.main>
  )
}
