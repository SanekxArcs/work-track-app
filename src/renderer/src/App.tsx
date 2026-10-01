import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, BarChart3, BriefcaseBusiness, ChevronDown, ChevronUp, Clock3, Coffee, Dumbbell, ListTodo, Minus, Pause, Pin, Play, Plus, Settings2, Sparkles, Square, Undo2 } from 'lucide-react'
import type { AppSnapshot, StartMode, Task } from '@shared/types'
import { restRemaining } from '@shared/rest'
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
import { dayIntervals, formatDuration, taskDuration, unionDuration } from './lib/time'
import { playNotificationSound } from './lib/sounds'
import { localDayBounds } from '@shared/local-date'

type Tab = 'focus' | 'day' | 'projects' | 'settings'
type NotchState = 'collapsed' | 'open' | 'closing'
type HeaderSlide = { id: string; label: string; value?: string; ms?: number; compactMs?: boolean; count?: number }

/** Matches NOTCH_SIZE in the main process: the window is exactly the pill while collapsed. */
const NOTCH_WIDTH = 300
const NOTCH_HEIGHT = 40
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

function SlideValue({ slide }: { slide: HeaderSlide }): React.JSX.Element | null {
  if (slide.ms !== undefined) return <b><AnimatedDuration ms={slide.ms} compact={slide.compactMs} /></b>
  if (slide.count !== undefined) return <b><AnimatedNumber value={slide.count} /></b>
  return slide.value ? <b>{slide.value}</b> : null
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
  const [notch, setNotchState] = useState<NotchState | null>(null)
  const [windowLeaving, setWindowLeaving] = useState(false)
  const notchRef = useRef<NotchState | null>(null)
  const notchOpenTimer = useRef<number | undefined>(undefined)
  const notchCloseTimer = useRef<number | undefined>(undefined)
  const notchDrag = useRef<{ startX: number; moved: boolean; pending: boolean } | null>(null)
  const notchHoverBlocked = useRef(false)
  const notchSuppressClick = useRef(false)
  const compactOpenTimer = useRef<number | undefined>(undefined)
  const compactCloseTimer = useRef<number | undefined>(undefined)
  const compactTasksOpen = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const setNotch = (next: NotchState | null): void => {
    notchRef.current = next
    setNotchState(next)
  }

  const [loadFailed, setLoadFailed] = useState(false)
  const [actionError, setActionError] = useState('')
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
    return () => {
      window.clearInterval(clock)
      unsubscribe()
      unsubscribeSettings()
      unsubscribeDockSide()
      unsubscribeSound()
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
  const focusTasks = workdayTasks.filter((task) => task.status !== 'stopped')
  const liveTotal = liveTasks.reduce((total, task) => total + taskDuration(task, now), 0)
  const workedMs = unionDuration(dayIntervals(workdayTasks, now), now)
  const activeRest = snapshot?.rests.find((rest) => rest.status !== 'completed')
  const restRunning = activeRest?.status === 'running'
  const lunchActive = activeRest?.type === 'lunch'
  const compactRows = compactHovered ? Math.max(1, focusTasks.length + (activeRest ? 1 : 0)) : 1
  const compactPrimaryTask = activeRest ? null : liveTasks[0] ?? focusTasks[0] ?? null
  const compactExtraTasks = compactHovered ? focusTasks.filter((task) => task.id !== compactPrimaryTask?.id) : []
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
    if (compact || docked || notch) return
    void window.workBuddy.setWindowEditor(editorOpen)
  }, [compact, docked, notch, editorOpen])

  // Editing from the open notch, or turning the notch look off, leaves it as a normal window.
  const notchEnabled = snapshot?.settings.notchEnabled ?? false
  useEffect(() => {
    if (!notch || (notchEnabled && !(editorOpen && notch === 'open'))) return
    void window.workBuddy.setWindowMode('expanded').then(() => setNotch(null))
  }, [notch, notchEnabled, editorOpen])

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
      await window.workBuddy.setWindowMode('notch')
      setCompact(false)
      setDockSide(null)
      setNotch('collapsed')
    })
  }

  /** Keeps the notch open as a normal window that can be moved and resized. */
  const pinNotch = async (): Promise<void> => {
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
    if (notchRef.current !== 'collapsed') return
    await window.workBuddy.setWindowMode('notch-open')
    if (notchRef.current === 'collapsed') setNotch('open')
  }

  const finishNotchClose = async (): Promise<void> => {
    if (notchRef.current !== 'closing') return
    await window.workBuddy.setWindowMode('notch')
    if (notchRef.current === 'closing') setNotch('collapsed')
  }

  const hoverNotch = (inside: boolean): void => {
    window.clearTimeout(notchOpenTimer.current)
    window.clearTimeout(notchCloseTimer.current)
    // A pill being dragged, or just dropped under the cursor, must not spring open.
    if (inside && (notchDrag.current || notchHoverBlocked.current)) return
    if (!inside) notchHoverBlocked.current = false
    if (inside) {
      if (notchRef.current === 'closing') setNotch('open')
      else if (notchRef.current === 'collapsed') notchOpenTimer.current = window.setTimeout(() => void openNotch(), 260)
    } else if (notchRef.current === 'open') {
      notchCloseTimer.current = window.setTimeout(() => {
        if (notchRef.current === 'open' && !editorOpen) setNotch('closing')
      }, 450)
    }
  }

  /** Dragging the collapsed pill slides it along the top edge; a click without movement pins it open. */
  const notchPointer = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      window.clearTimeout(notchOpenTimer.current)
      notchDrag.current = { startX: event.screenX, moved: false, pending: false }
      void window.workBuddy.dragNotch('start')
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>): void => {
      const drag = notchDrag.current
      if (!drag || (!drag.moved && Math.abs(event.screenX - drag.startX) < 4) || drag.pending) return
      drag.moved = true
      drag.pending = true
      void window.workBuddy.dragNotch('move').finally(() => { drag.pending = false })
    },
    onPointerUp: (): void => {
      const drag = notchDrag.current
      notchDrag.current = null
      if (!drag?.moved) return
      notchSuppressClick.current = true
      notchHoverBlocked.current = true
      void window.workBuddy.dragNotch('end')
    },
    onClick: (): void => {
      if (notchSuppressClick.current) {
        notchSuppressClick.current = false
        return
      }
      void pinNotch()
    }
  }
  const { onPointerUp: endNotchDrag } = notchPointer

  const startDayWithTask = (): Promise<void> => attempt(async () => {
    await window.workBuddy.startWorkday()
    setSnapshot(await window.workBuddy.startTask({ mode: 'parallel' }))
  })

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
    }, 2000)
  }

  const concealCompactTasks = (): void => {
    if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
    if (!compactTasksOpen.current) return
    if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
    compactCloseTimer.current = window.setTimeout(() => {
      compactTasksOpen.current = false
      setCompactHovered(false)
    }, 2000)
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

  const endDay = async (): Promise<void> => {
    const result = await window.workBuddy.endWorkday()
    setSnapshot(result)
    setTab('day')
  }

  const fitWindowToContent = (): void => {
    const content = contentRef.current
    if (!content || compact) return
    // The scroll container fills all spare window space, so its scrollHeight
    // cannot tell us whether a short page should shrink the window. Measure
    // the actual page inside it instead.
    const page = Array.from(content.children).find((element) => element.classList.contains('page-stack')) as HTMLElement | undefined
    const styles = window.getComputedStyle(content)
    const chromeHeight = window.innerHeight - content.clientHeight
    const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
    const pageHeight = page ? Math.ceil(page.getBoundingClientRect().height) : content.scrollHeight
    const requestedHeight = chromeHeight + pageHeight + verticalPadding + 8
    void window.workBuddy.fitWindowToContent(requestedHeight)
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
    const DockIcon = dockSide === 'left' ? ArrowRightToLine : ArrowLeftToLine
    const drag = (
      <div className="dock-drag drag-region" title={formatDuration(workedMs)}>
        <span className={`status-dot ${liveTasks.length ? 'status-dot--live' : ''}`} />
        <strong><AnimatedHm ms={workedMs} /></strong>
      </div>
    )
    const open = <button className="dock-open no-drag" onClick={() => void undock()} title={t('dockedOpen')} aria-label={t('dockedOpen')}><DockIcon size={15} /></button>
    return (
      <motion.main className="app-shell app-shell--docked" {...stage} style={{ transformOrigin: dockSide === 'left' ? '0% 50%' : '100% 50%' }}>
        <div className={`dock-pill dock-pill--${dockSide}`}>
          {dockSide === 'left' ? <>{drag}{open}</> : <>{open}{drag}</>}
        </div>
      </motion.main>
    )
  }

  const notchOpen = notch === 'open'
  const appHeader = (
    <header className={`app-header ${notch ? 'app-header--notch' : 'drag-region'}`} onClick={notch ? (event) => { if (!(event.target as HTMLElement).closest('button')) void pinNotch() } : undefined} title={notch ? t('notchPin') : undefined}>
      <div className="brand-lockup">
        <div className="brand-mark"><span /></div>
        <div className="brand-copy">
          <strong>{t('appName')}</strong>
          <AnimatePresence mode="wait" initial={false}>
            {headerSlide && <motion.small key={headerSlide.id} className="brand-slide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }}>
              {headerSlide.label}<SlideValue slide={headerSlide} />
            </motion.small>}
          </AnimatePresence>
        </div>
      </div>
      <div className="window-actions no-drag">
        {notch ? <>
          <button className="icon-button icon-button--quiet" onClick={() => void pinNotch()} title={t('notchPin')} aria-label={t('notchPin')}><Pin size={15} /></button>
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

  const expandedView = (
          <motion.div key="expanded" className="expanded-view" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
            <nav className="tab-bar no-drag">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button key={id} className={`${tab === id ? 'active' : ''} ${id === 'settings' ? 'tab-icon-only' : ''}`} onClick={() => setTab(id)} title={id === 'settings' ? label : undefined} aria-label={label}>
                  {tab === id && <motion.span layoutId="tab-pill" className="tab-pill" />}
                  <Icon size={15} />{id !== 'settings' && <span>{label}</span>}
                </button>
              ))}
            </nav>

            <div ref={contentRef} className="content-scroll no-drag">
              <AnimatePresence mode="wait">
                {tab === 'focus' && (
                  <motion.div key="focus" className="page-stack" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                    <RestControl snapshot={snapshot} now={now} t={t} onSnapshot={setSnapshot} />
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
                          return <span key={segment.id} title={`${segment.label} · ${formatDuration(segment.endedAt - segment.startedAt, true)}`} style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, background: segment.color }} />
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
                        {!lunchActive && snapshot.workday?.endedAt === null && <button className="secondary-button" disabled={Boolean(activeRest)} onClick={() => mutate(window.workBuddy.startRest('break'))}><Dumbbell size={15} />{t('takeBreak')}</button>}
                        <button className={`secondary-button planned-toggle ${showPlannedTasks ? 'active' : ''}`} onClick={() => setShowPlannedTasks((current) => !current)}><ListTodo size={15} />{t('plannedTasks')}</button>
                      </div>
                    </div>

                    <StackCollapse open={showFocusEndDay}><button className="end-day-button focus-end-day" onClick={endDay}><Square size={15} fill="currentColor" />{t('endDay')}</button></StackCollapse>

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

  if (notch) {
    // A dark pill hanging from the top edge; hovering grows it into the full view in place.
    return (
      <motion.main className="app-shell app-shell--notch" {...stage} onMouseEnter={() => hoverNotch(true)} onMouseLeave={() => hoverNotch(false)}>
        <motion.div
          className={`notch ${notchOpen ? 'notch--open' : ''}`}
          initial={false}
          animate={notchOpen ? { width: '100%', height: '100%' } : { width: NOTCH_WIDTH, height: NOTCH_HEIGHT }}
          transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
          onAnimationComplete={() => void finishNotchClose()}
        >
          <AnimatePresence initial={false}>
            {notchOpen
              ? <motion.div key="full" className="notch__full" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.08, duration: 0.2 } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                {appHeader}
                {expandedView}
              </motion.div>
              : <motion.button key="pill" className="notch-pill" {...notchPointer} onPointerCancel={endNotchDrag} title={t('notchPillHint')} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.18 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
                <span className={`status-dot ${liveTasks.length ? 'status-dot--live' : ''}`} />
                <AnimatePresence mode="wait" initial={false}>
                  {headerSlide && <motion.span key={headerSlide.id} className="notch-pill__slide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }}>
                    <span className="notch-pill__label">{headerSlide.label}</span><SlideValue slide={headerSlide} />
                  </motion.span>}
                </AnimatePresence>
              </motion.button>}
          </AnimatePresence>
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
            {!activeRest && <div className="compact-task-row">
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
      {!compact && <button className="resize-fit-handle no-drag" onDoubleClick={fitWindowToContent} title={t('fitWindowToContent')} aria-label={t('fitWindowToContent')}><span /></button>}
      {!compact && tab !== 'focus' && <div className="resize-corner" aria-hidden="true" />}

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
    </motion.main>
  )
}
