import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BarChart3, ChevronDown, ChevronUp, Clock3, Coffee, Dumbbell, ListTodo, Minus, Pause, Play, Plus, Settings2, Sparkles, Square } from 'lucide-react'
import type { AppSnapshot, StartMode, Task } from '@shared/types'
import { restRemaining } from '@shared/rest'
import { DaySummary } from './components/DaySummary'
import { SettingsPage } from './components/Settings'
import { TaskCard } from './components/TaskCard'
import { TaskEditor } from './components/TaskEditor'
import { RestControl } from './components/RestControl'
import { PlannedTasksPanel } from './components/PlannedTasksPanel'
import { translator } from './lib/i18n'
import { dayIntervals, formatDuration, taskDuration, unionDuration } from './lib/time'
import { playNotificationSound } from './lib/sounds'

type Tab = 'focus' | 'day' | 'settings'

function isWorkdayReadyToEnd(startedAt: number | undefined, endTime: string, now: number): boolean {
  if (!startedAt) return false
  const [hours, minutes] = endTime.split(':').map(Number)
  const scheduledEnd = new Date(startedAt)
  scheduledEnd.setHours(hours || 0, minutes || 0, 0, 0)
  if (scheduledEnd.getTime() <= startedAt) scheduledEnd.setDate(scheduledEnd.getDate() + 1)
  return now >= scheduledEnd.getTime()
}

export default function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [tab, setTab] = useState<Tab>('focus')
  const [compact, setCompact] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | undefined>()
  const [defaultMode, setDefaultMode] = useState<StartMode>('parallel')
  const [promptReason, setPromptReason] = useState<'endday' | undefined>()
  const [reviewQueue, setReviewQueue] = useState<string[]>([])
  const [showPlannedTasks, setShowPlannedTasks] = useState(false)
  const focusRef = useRef<HTMLDivElement>(null)

  const reload = async (): Promise<void> => setSnapshot(await window.workBuddy.getSnapshot())

  useEffect(() => {
    reload()
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const unsubscribe = window.workBuddy.onDataChanged(reload)
    const unsubscribeSettings = window.workBuddy.onOpenSettings(() => {
      setCompact(false)
      window.workBuddy.setWindowMode('expanded')
      setTab('settings')
    })
    const unsubscribeSound = window.workBuddy.onPlaySound((sound, volume) => { void playNotificationSound(sound, undefined, volume).catch(() => undefined) })
    return () => {
      window.clearInterval(clock)
      unsubscribe()
      unsubscribeSettings()
      unsubscribeSound()
    }
  }, [])

  useEffect(() => {
    if (!snapshot) return
    document.documentElement.lang = snapshot.settings.locale
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme = snapshot.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : snapshot.settings.theme
    document.documentElement.dataset.theme = theme
  }, [snapshot?.settings])

  const t = useMemo(() => translator(snapshot?.settings.locale ?? 'uk'), [snapshot?.settings.locale])
  const liveTasks = snapshot?.tasks.filter((task) => task.status === 'running') ?? []
  const focusTasks = snapshot?.tasks.filter((task) => task.status !== 'stopped') ?? []
  const liveTotal = liveTasks.reduce((total, task) => total + taskDuration(task, now), 0)
  const workedMs = snapshot ? unionDuration(dayIntervals(snapshot.tasks, now), now) : 0
  const activeRest = snapshot?.rests.find((rest) => rest.status !== 'completed')
  const restRunning = activeRest?.status === 'running'
  const compactRows = Math.max(1, focusTasks.length) + (activeRest ? 1 : 0)
  const showFocusEndDay = snapshot?.workday?.endedAt === null && isWorkdayReadyToEnd(snapshot.workday.startedAt, snapshot.settings.workday.endTime, now)

  useEffect(() => {
    if (compact) window.workBuddy.setWindowMode('compact', compactRows)
  }, [compact, focusTasks.length, activeRest?.id])

  useLayoutEffect(() => {
    if (compact) return
    void window.workBuddy.setWindowView(tab === 'focus' ? 'focus' : 'manual')
    if (tab !== 'focus') return
    if (editorOpen) {
      void window.workBuddy.setWindowHeight(700)
      return
    }
    const element = focusRef.current
    if (!element) return
    let frame = 0
    const measure = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => void window.workBuddy.setWindowHeight(element.scrollHeight + 147))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [compact, tab, editorOpen, snapshot])

  if (!snapshot) {
    return <div className="app-shell app-shell--loading"><div className="loading-mark"><Sparkles size={22} /></div></div>
  }

  const startInstant = async (mode: StartMode): Promise<void> => {
    setSnapshot(await window.workBuddy.startTask({ mode }))
  }

  const startDayWithTask = async (): Promise<void> => {
    await window.workBuddy.startWorkday()
    setSnapshot(await window.workBuddy.startTask({ mode: 'parallel' }))
  }

  const openEdit = async (task: Task): Promise<void> => {
    if (compact) {
      setCompact(false)
      await window.workBuddy.setWindowMode('expanded')
    }
    setPromptReason(undefined)
    setReviewQueue([])
    setEditingTask(task)
    setDefaultMode('parallel')
    setEditorOpen(true)
  }

  const toggleCompact = async (): Promise<void> => {
    const next = !compact
    setCompact(next)
    await window.workBuddy.setWindowMode(next ? 'compact' : 'expanded', compactRows)
  }

  const mutate = async (promise: Promise<AppSnapshot>): Promise<void> => setSnapshot(await promise)

  const openUnnamedReview = (result: AppSnapshot, ids: string[], reason: 'endday'): void => {
    const queue = ids.filter((id) => !result.tasks.find((task) => task.id === id)?.title.trim())
    if (!queue.length) return
    setPromptReason(reason)
    setReviewQueue(queue)
    setEditingTask(result.tasks.find((task) => task.id === queue[0]))
    setEditorOpen(true)
  }

  const advanceReview = (result: AppSnapshot): void => {
    const remaining = reviewQueue.filter((id) => id !== editingTask?.id)
    setReviewQueue(remaining)
    if (remaining.length) {
      setEditingTask(result.tasks.find((task) => task.id === remaining[0]))
      return
    }
    setPromptReason(undefined)
    setEditingTask(undefined)
    setEditorOpen(false)
  }

  const handleEditorSaved = (result: AppSnapshot): void => {
    setSnapshot(result)
    if (promptReason) advanceReview(result)
    else {
      setEditingTask(undefined)
      setEditorOpen(false)
    }
  }

  const handleEditorClose = (): void => {
    if (promptReason) advanceReview(snapshot)
    else {
      setEditingTask(undefined)
      setEditorOpen(false)
    }
  }

  const endDay = async (): Promise<void> => {
    const result = await window.workBuddy.endWorkday()
    setSnapshot(result)
    setTab('day')
    openUnnamedReview(result, result.tasks.filter((task) => !task.title.trim() && task.intervals.length > 0).map((task) => task.id), 'endday')
  }

  const navItems: Array<{ id: Tab; label: string; icon: typeof Clock3 }> = [
    { id: 'focus', label: t('focus'), icon: Clock3 },
    { id: 'day', label: t('day'), icon: BarChart3 },
    { id: 'settings', label: t('settings'), icon: Settings2 }
  ]

  return (
    <main className={`app-shell ${compact ? 'app-shell--compact' : ''}`}>
      {!compact && <header className="app-header drag-region">
        <div className="brand-lockup">
          <div className="brand-mark"><span /></div>
          <div><strong>{t('appName')}</strong><small>{t('hello')}</small></div>
        </div>
        <div className="window-actions no-drag">
          <button className="icon-button icon-button--quiet" onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={15} /></button>
          <button className="icon-button icon-button--quiet" onClick={toggleCompact} title={compact ? t('expand') : t('compact')}>{compact ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
        </div>
      </header>}

      <AnimatePresence mode="wait">
        {compact ? (
          <motion.section key="compact" className="compact-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
              </div>
            )}
            {(focusTasks.length ? focusTasks : [null]).map((task, index) => (
              <div className="compact-task-row" key={task?.id ?? 'empty'}>
                <div className="compact-task-info drag-region">
                  <span className={`status-dot ${task?.status === 'running' ? 'status-dot--live' : ''}`} />
                  <div>
                    <strong>{task ? task.title || 'Untitled flow' : t('noTimers')}</strong>
                    <small>{task ? formatDuration(taskDuration(task, now)) : t('noTimersBody')}</small>
                  </div>
                </div>
                {task && <div className="compact-task-actions no-drag">
                  {task.status === 'running'
                    ? <button onClick={() => mutate(window.workBuddy.pauseTask(task.id))} title={t('pause')}><Pause size={16} fill="currentColor" /></button>
                    : <button className="play" disabled={restRunning} onClick={() => mutate(window.workBuddy.resumeTask(task.id, 'parallel'))} title={t('resume')}><Play size={16} fill="currentColor" /></button>}
                </div>}
                {index === 0 && <div className="compact-window-actions no-drag">
                  <button disabled={restRunning} onClick={() => startInstant('parallel')} title={t('addParallel')}><Plus size={17} /></button>
                  <button onClick={() => window.workBuddy.minimizeToTray()} title={t('tray')}><Minus size={17} /></button>
                  <button onClick={toggleCompact} title={t('expand')}><ChevronDown size={17} /></button>
                </div>}
              </div>
            ))}
          </motion.section>
        ) : (
          <motion.div key="expanded" className="expanded-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <nav className="tab-bar no-drag">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  {tab === id && <motion.span layoutId="tab-pill" className="tab-pill" />}
                  <Icon size={15} /><span>{label}</span>
                </button>
              ))}
            </nav>

            <div className="content-scroll no-drag">
              <AnimatePresence mode="wait">
                {tab === 'focus' && (
                  <motion.div ref={focusRef} key="focus" className="page-stack" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                    <RestControl snapshot={snapshot} now={now} workedMs={workedMs} t={t} onSnapshot={setSnapshot} />
                    <section className="focus-hero">
                      <div>
                        <span className="eyebrow">{liveTasks.length ? `${liveTasks.length} ${t('activeNow')}` : t('today')}</span>
                        <strong>{formatDuration(liveTotal)}</strong>
                      </div>
                      <div className="focus-hero__actions no-drag">
                        <button disabled={!liveTasks.length} onClick={() => mutate(window.workBuddy.pauseAllTasks())}><Pause size={17} fill="currentColor" /><span>{t('pauseAll')}</span></button>
                      </div>
                    </section>

                    <div className="focus-actions">
                      <div className="focus-actions__primary">
                        <button className="primary-button" disabled={restRunning} onClick={() => snapshot.workday?.endedAt === null ? startInstant('parallel') : startDayWithTask()}><Plus size={17} />{snapshot.workday?.endedAt === null ? (liveTasks.length ? t('addParallel') : t('startTask')) : t('startDay')}</button>
                        {liveTasks.length > 0 && <button className="secondary-button" disabled={restRunning} onClick={() => startInstant('switch')}>{t('switchTask')}</button>}
                      </div>
                      <div className="focus-actions__tools">
                        {snapshot.workday?.endedAt === null && <button className="secondary-button" disabled={Boolean(activeRest)} onClick={() => mutate(window.workBuddy.startRest('break'))}><Dumbbell size={15} />{t('takeBreak')}</button>}
                        <button className={`secondary-button planned-toggle ${showPlannedTasks ? 'active' : ''}`} onClick={() => setShowPlannedTasks((current) => !current)}><ListTodo size={15} />{t('plannedTasks')}</button>
                      </div>
                    </div>

                    {showFocusEndDay && <button className="end-day-button focus-end-day" disabled={restRunning} onClick={endDay}><Square size={15} fill="currentColor" />{t('endDay')}</button>}

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
                    onEndDay={endDay}
                    onEdit={openEdit}
                  />
                )}

                {tab === 'settings' && <SettingsPage key="settings" snapshot={snapshot} t={t} onSnapshot={setSnapshot} />}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!compact && <div className="window-bottom-edge" aria-hidden="true" />}
      {!compact && tab !== 'focus' && <div className="resize-corner" aria-hidden="true" />}

      <TaskEditor
        open={editorOpen}
        task={editingTask}
        defaultMode={defaultMode}
        snapshot={snapshot}
        t={t}
        promptReason={promptReason}
        onClose={handleEditorClose}
        onSnapshot={setSnapshot}
        onSaved={handleEditorSaved}
      />
    </main>
  )
}
