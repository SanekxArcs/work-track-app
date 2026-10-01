import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftToLine, ArrowRightToLine, BarChart3, BriefcaseBusiness, ChevronDown, ChevronUp, Clock3, Coffee, Dumbbell, ListTodo, Minus, Pause, Play, Plus, Settings2, Sparkles, Square, Undo2 } from 'lucide-react'
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
import { translator } from './lib/i18n'
import { dayIntervals, formatDuration, formatHm, taskDuration, unionDuration } from './lib/time'
import { playNotificationSound } from './lib/sounds'
import { localDayBounds } from '@shared/local-date'

type Tab = 'focus' | 'day' | 'projects' | 'settings'

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
  const compactOpenTimer = useRef<number | undefined>(undefined)
  const compactCloseTimer = useRef<number | undefined>(undefined)
  const compactTasksOpen = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const reload = async (): Promise<void> => setSnapshot(await window.workBuddy.getSnapshot())

  useEffect(() => {
    reload()
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const unsubscribe = window.workBuddy.onDataChanged(reload)
    const unsubscribeSettings = window.workBuddy.onOpenSettings(() => {
      setCompact(false)
      setDockSide(null)
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

  const headerSlides = ((): Array<{ id: string; label: string; value: string }> => {
    if (!snapshot) return []
    const todayTasks = snapshot.tasks.filter((task) => task.intervals.some((interval) => interval.startedAt < todayEnd && (interval.endedAt ?? now) > todayStart))
    const workedToday = unionDuration(dayIntervals(todayTasks, now), now)
    if (todayTasks.length === 0 && !openWorkdayStartedAt) return [{ id: 'hello', label: t('hello'), value: '' }]
    const slides = [{ id: 'worked', label: t('statWorked'), value: formatDuration(workedToday) }]
    const running = todayTasks.filter((task) => task.status === 'running').length
    if (running > 0) slides.push({ id: 'live', label: t('statLive'), value: String(running) })
    if (todayTasks.length > 0) slides.push({ id: 'tasks', label: t('statTasks'), value: String(todayTasks.length) })
    const byProject = new Map<string, Task[]>()
    for (const task of todayTasks) if (task.projectId) byProject.set(task.projectId, [...(byProject.get(task.projectId) ?? []), task])
    const top = [...byProject.entries()]
      .map(([projectId, projectTasks]) => ({ projectId, ms: unionDuration(dayIntervals(projectTasks, now), now) }))
      .sort((first, second) => second.ms - first.ms)[0]
    const topProject = top ? snapshot.projects.find((project) => project.id === top.projectId) : undefined
    if (topProject && top.ms > 0) slides.push({ id: 'top', label: `${t('statTopProject')} ${topProject.name}`, value: formatDuration(top.ms, true) })
    const breakMs = snapshot.rests.filter((rest) => rest.type === 'break').flatMap((rest) => rest.intervals)
      .reduce((total, interval) => total + Math.max(0, Math.min(interval.endedAt ?? now, todayEnd) - Math.max(interval.startedAt, todayStart)), 0)
    if (breakMs > 0) slides.push({ id: 'breaks', label: t('statBreaks'), value: formatDuration(breakMs, true) })
    if (openWorkdayStartedAt && scheduledEndAt !== null && scheduledEndAt > now) slides.push({ id: 'until-end', label: t('statUntilEnd'), value: formatDuration(scheduledEndAt - now, true) })
    return slides
  })()
  const headerSlide = headerSlides.length ? headerSlides[slideIndex % headerSlides.length] : undefined

  const docked = dockSide !== null

  useEffect(() => {
    if (!compact || docked) return
    void window.workBuddy.setWindowMode('compact', compactRows).then((anchor) => {
      if (anchor === 'top' || anchor === 'bottom') setCompactAnchor(anchor)
    })
  }, [compact, compactRows, docked])

  useEffect(() => {
    if (compact || docked) return
    void window.workBuddy.setWindowEditor(editorOpen)
  }, [compact, docked, editorOpen])

  if (!snapshot) {
    return <div className="app-shell app-shell--loading"><div className="loading-mark"><Sparkles size={22} /></div></div>
  }

  const startInstant = async (mode: StartMode): Promise<void> => {
    setSnapshot(await window.workBuddy.startTask({ mode }))
  }

  const continueDay = async (): Promise<void> => {
    setSnapshot(await window.workBuddy.resumeWorkday())
  }

  const dock = async (): Promise<void> => {
    if (editorOpen) return
    if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
    if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
    compactTasksOpen.current = false
    setCompactHovered(false)
    const side = await window.workBuddy.setWindowMode('docked')
    setDockSide(side === 'left' ? 'left' : 'right')
  }

  const undock = async (): Promise<void> => {
    setDockSide(null)
    await window.workBuddy.setWindowMode(compact ? 'compact' : 'expanded', compactRows)
  }

  const startDayWithTask = async (): Promise<void> => {
    await window.workBuddy.startWorkday()
    setSnapshot(await window.workBuddy.startTask({ mode: 'parallel' }))
  }

  const openEdit = async (task: Task, intervalId?: string): Promise<void> => {
    if (compact) {
      setCompact(false)
      await window.workBuddy.setWindowMode('expanded')
    }
    setEditingTask(task)
    setEditingIntervalId(intervalId)
    setDefaultMode('parallel')
    setEditorOpen(true)
  }

  const toggleCompact = async (): Promise<void> => {
    const next = !compact
    if (!next) {
      if (compactOpenTimer.current) window.clearTimeout(compactOpenTimer.current)
      if (compactCloseTimer.current) window.clearTimeout(compactCloseTimer.current)
      compactTasksOpen.current = false
      setCompactHovered(false)
    }
    setCompact(next)
    await window.workBuddy.setWindowMode(next ? 'compact' : 'expanded', compactRows)
  }

  const mutate = async (promise: Promise<AppSnapshot>): Promise<void> => setSnapshot(await promise)

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

  if (dockSide) {
    const DockIcon = dockSide === 'left' ? ArrowRightToLine : ArrowLeftToLine
    const drag = (
      <div className="dock-drag drag-region" title={formatDuration(workedMs)}>
        <span className={`status-dot ${liveTasks.length ? 'status-dot--live' : ''}`} />
        <strong>{formatHm(workedMs)}</strong>
      </div>
    )
    const open = <button className="dock-open no-drag" onClick={() => void undock()} title={t('dockedOpen')} aria-label={t('dockedOpen')}><DockIcon size={15} /></button>
    return (
      <main className="app-shell app-shell--docked">
        <div className={`dock-pill dock-pill--${dockSide}`}>
          {dockSide === 'left' ? <>{drag}{open}</> : <>{open}{drag}</>}
        </div>
      </main>
    )
  }

  return (
    <main className={`app-shell ${compact ? 'app-shell--compact' : ''}`}>
      {!compact && <header className="app-header drag-region">
        <div className="brand-lockup">
          <div className="brand-mark"><span /></div>
          <div className="brand-copy">
            <strong>{t('appName')}</strong>
            <AnimatePresence mode="wait" initial={false}>
              {headerSlide && <motion.small key={headerSlide.id} className="brand-slide" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
                {headerSlide.label}{headerSlide.value && <b>{headerSlide.value}</b>}
              </motion.small>}
            </AnimatePresence>
          </div>
        </div>
        <div className="window-actions no-drag">
          <button className="icon-button icon-button--quiet" onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={15} /></button>
          <button className="icon-button icon-button--quiet" onClick={toggleCompact} title={compact ? t('expand') : t('compact')}>{compact ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
          <button className="icon-button icon-button--quiet" onClick={() => void dock()} title={t('dockToEdge')} aria-label={t('dockToEdge')}><ArrowRightToLine size={15} /></button>
        </div>
      </header>}

      <AnimatePresence mode="wait">
        {compact ? (
          <motion.section key="compact" className={`compact-view compact-view--${compactAnchor}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseEnter={() => revealCompactTasks()} onMouseLeave={concealCompactTasks}>
            {compactAnchor === 'bottom' && compactExtraTasks.map((task) => (
              <div className="compact-task-row compact-task-row--extra" key={task.id}>
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${task.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div><strong>{taskLabel(task)}</strong><small>{formatDuration(taskDuration(task, now))}</small></div>
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
                  <div><strong>{activeRest.type === 'lunch' ? t('lunchInProgress') : t('breakInProgress')}</strong><small>{activeRest.status === 'paused' ? t('restPaused') : formatDuration(restRemaining(activeRest, now))}</small></div>
                </div>
                <div className="compact-task-actions no-drag">
                  {activeRest.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseRest(activeRest.id))} title={t('pauseRest')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" onClick={() => mutate(window.workBuddy.resumeRest(activeRest.id))} title={t('continueRest')}><Play size={16} fill="currentColor" /></button>}
                  <button className="stop" onClick={() => mutate(window.workBuddy.completeRest(activeRest.id))} title={t('finishRest')}><Square size={13} fill="currentColor" /></button>
                </div>
                <div className="compact-window-actions no-drag">
                  <button disabled={restRunning} onClick={() => startInstant('parallel')} title={t('addParallel')}><Plus size={17} /></button>
                  <button onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={17} /></button>
                  <button onClick={() => void dock()} title={t('dockToEdge')}><ArrowRightToLine size={17} /></button>
                  <button onMouseEnter={() => revealCompactTasks(true)} onClick={toggleCompact} title={t('expand')}><ChevronDown size={17} /></button>
                </div>
              </div>
            )}
            {!activeRest && <div className="compact-task-row">
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${compactPrimaryTask?.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div>
                    <strong>{compactPrimaryTask ? taskLabel(compactPrimaryTask) : t('noTimers')}</strong>
                    <small>{compactPrimaryTask ? formatDuration(taskDuration(compactPrimaryTask, now)) : t('noTimersBody')}</small>
                  </div>
                </div>
                {compactPrimaryTask && <div className="compact-task-actions no-drag">
                  {compactPrimaryTask.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseTask(compactPrimaryTask.id))} title={t('pause')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" disabled={restRunning} onClick={() => mutate(window.workBuddy.resumeTask(compactPrimaryTask.id, 'parallel'))} title={t('resume')}><Play size={16} fill="currentColor" /></button>}
                </div>}
                <div className="compact-window-actions no-drag">
                  <button disabled={restRunning} onClick={() => startInstant('parallel')} title={t('addParallel')}><Plus size={17} /></button>
                  <button onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={17} /></button>
                  <button onClick={() => void dock()} title={t('dockToEdge')}><ArrowRightToLine size={17} /></button>
                  <button onMouseEnter={() => revealCompactTasks(true)} onClick={toggleCompact} title={t('expand')}><ChevronDown size={17} /></button>
                </div>
              </div>}
            {compactAnchor === 'top' && compactExtraTasks.map((task) => (
              <div className="compact-task-row compact-task-row--extra" key={task.id}>
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${task.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div><strong>{taskLabel(task)}</strong><small>{formatDuration(taskDuration(task, now))}</small></div>
                </div>
                <div className="compact-task-actions no-drag">
                  {task.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseTask(task.id))} title={t('pause')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" disabled={restRunning} onClick={() => mutate(window.workBuddy.resumeTask(task.id, 'parallel'))} title={t('resume')}><Play size={16} fill="currentColor" /></button>}
                </div>
              </div>
            ))}
          </motion.section>
        ) : (
          <motion.div key="expanded" className="expanded-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
                          <strong>{formatDuration(lunchActive ? workedMs : liveTotal)}</strong>
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

                    {showFocusEndDay && <button className="end-day-button focus-end-day" onClick={endDay}><Square size={15} fill="currentColor" />{t('endDay')}</button>}

                    {showPlannedTasks && <PlannedTasksPanel snapshot={snapshot} t={t} onSnapshot={setSnapshot} />}

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
        )}
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
    </main>
  )
}
