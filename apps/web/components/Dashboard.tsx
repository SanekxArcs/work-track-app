'use client'

import { useEffect, useMemo, useState } from 'react'
import { activeWorkday, formatDuration, taskElapsed, type WebRest, type WebTask, type WebWorkspace, type WorkBuddyCommand } from '../lib/workspace'

type WorkspaceResponse = { workspace: WebWorkspace | null; error?: string }
type DashboardMode = 'dashboard' | 'focus'

function taskLabel(task: WebTask): string {
  return task.notes.trim() || task.title.trim() || 'Без опису'
}

function restElapsed(rest: WebRest, now: number): number {
  return rest.intervals.reduce((total, interval) => total + Math.max(0, (interval.endedAt ?? now) - interval.startedAt), 0)
}

function formatTime(timestamp: number, withSeconds = false): string {
  return new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false }).format(timestamp)
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }).format(timestamp)
}

export function Dashboard({ initialWorkspace, email }: { initialWorkspace: WebWorkspace | null; email: string }): React.JSX.Element {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [now, setNow] = useState(Date.now())
  const [commandStatus, setCommandStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<DashboardMode>('dashboard')
  const [focusSettingsOpen, setFocusSettingsOpen] = useState(false)
  const [focusShowSeconds, setFocusShowSeconds] = useState(true)
  const [focusShowContext, setFocusShowContext] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const savedMode = window.localStorage.getItem('work-buddy-dashboard-mode')
    if (savedMode === 'focus' || savedMode === 'dashboard') setMode(savedMode)
    setFocusShowSeconds(window.localStorage.getItem('work-buddy-focus-seconds') !== 'false')
    setFocusShowContext(window.localStorage.getItem('work-buddy-focus-context') !== 'false')
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    const refresh = async (): Promise<void> => {
      const response = await fetch('/api/workspace', { cache: 'no-store' })
      const data = await response.json().catch(() => null) as WorkspaceResponse | null
      if (response.ok && data) setWorkspace(data.workspace)
    }
    void refresh()
    const sync = window.setInterval(() => void refresh(), 1_500)
    const onFullscreenChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => { window.clearInterval(clock); window.clearInterval(sync); document.removeEventListener('fullscreenchange', onFullscreenChange) }
  }, [])

  const setDashboardMode = (nextMode: DashboardMode): void => {
    setMode(nextMode)
    window.localStorage.setItem('work-buddy-dashboard-mode', nextMode)
  }

  const projectById = useMemo(() => new Map(workspace?.projects.map((project) => [project.id, project]) ?? []), [workspace])
  const activeRest = workspace?.rests.find((rest) => rest.status !== 'completed')
  const activeTasks = workspace?.tasks.filter((task) => task.status !== 'stopped') ?? []
  const runningTasks = activeTasks.filter((task) => task.status === 'running')
  const primaryTask = runningTasks[0] ?? activeTasks[0]
  const primaryProject = primaryTask?.projectId ? projectById.get(primaryTask.projectId) : undefined
  const workday = workspace ? activeWorkday(workspace) : undefined
  const heroDuration = activeRest ? restElapsed(activeRest, now) : primaryTask ? taskElapsed(primaryTask, now) : 0
  const heroTitle = activeRest ? (activeRest.type === 'lunch' ? 'Твій обід' : 'Твоя перерва') : primaryTask ? taskLabel(primaryTask) : 'Поки тихо'
  const heroProject = activeRest ? 'Час для себе' : primaryProject?.name || 'Вільний фокус'
  const focusColor = activeRest ? '#f7a072' : primaryProject?.color || '#b8e986'
  const focusUsesWorkTimer = Boolean(workday)
  const focusMainTime = focusUsesWorkTimer ? formatDuration(heroDuration) : formatTime(now, focusShowSeconds)
  const focusTitle = focusUsesWorkTimer ? heroTitle : 'Твій час'
  const focusProject = focusUsesWorkTimer ? heroProject : 'Work Buddy'
  const focusState = focusUsesWorkTimer
    ? (activeRest ? 'Відпочинок іде' : runningTasks.length ? `${runningTasks.length} активн${runningTasks.length === 1 ? 'а задача' : 'і задачі'}` : 'Обери задачу на десктопі')
    : 'Робочий день завершено'

  const send = async (command: WorkBuddyCommand): Promise<void> => {
    setLoading(true)
    setCommandStatus('')
    try {
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
      const data = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error || 'Не вдалося надіслати команду')
      setCommandStatus('Команда надіслана — Work Buddy підхопить її за мить.')
    } catch (error) {
      setCommandStatus(error instanceof Error ? error.message : 'Не вдалося надіслати команду')
    } finally {
      setLoading(false)
    }
  }

  const restActions = (): React.JSX.Element => activeRest ? <button className="primary-button" disabled={loading} onClick={() => void send({ command: 'complete-rest', restId: activeRest.id })}>Завершити {activeRest.type === 'lunch' ? 'обід' : 'перерву'}</button> : <>
    <button disabled={loading || !workday} onClick={() => void send({ command: 'start-rest', restType: 'break' })}>Взяти перерву</button>
    <button disabled={loading || !workday} onClick={() => void send({ command: 'start-rest', restType: 'lunch' })}>Почати обід</button>
    <button className="danger-button" disabled={loading || !workday} onClick={() => void send({ command: 'end-workday' })}>Завершити день</button>
  </>

  if (!workspace) return <main className="setup-card"><p className="eyebrow">Work Buddy Web</p><h1>Чекаю першу синхронізацію</h1><p>Відкрий десктопний Work Buddy і виконай синхронізацію з Sanity. Після цього цей екран оживе сам.</p></main>

  const updateFocusSetting = (key: 'seconds' | 'context', value: boolean): void => {
    if (key === 'seconds') setFocusShowSeconds(value)
    else setFocusShowContext(value)
    window.localStorage.setItem(`work-buddy-focus-${key}`, String(value))
  }

  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setCommandStatus('Цей браузер не дозволив повноекранний режим.')
    }
  }

  return <main className={`dashboard-shell dashboard-shell--${mode}`} style={{ '--focus-color': focusColor } as React.CSSProperties}>
    {mode === 'dashboard' && <header className="dashboard-header">
      <div className="brand-block"><p className="eyebrow">Work Buddy · live</p><p className="today-label">{formatDate(now)}</p></div>
      <div className="header-actions">
        <span className="live-chip"><i />онлайн</span>
        <div className="view-switcher" aria-label="Режим дашборду">
          <button className="is-active" onClick={() => setDashboardMode('dashboard')} aria-label="Звичайний дашборд">▦<span>Дашборд</span></button>
          <button onClick={() => setDashboardMode('focus')} aria-label="Focus Clock">◷<span>Focus</span></button>
        </div>
      </div>
    </header>}

    {mode === 'focus' ? <section className="focus-clock" aria-label="Focus Clock">
      {focusUsesWorkTimer && <p className="focus-wall-clock">{formatTime(now)}</p>}
      <div className="focus-controls">
        <button className="focus-icon-button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Вийти з повного екрана' : 'На весь екран'}>{isFullscreen ? '⤢' : '⛶'}</button>
        <button className="focus-icon-button" onClick={() => setFocusSettingsOpen((open) => !open)} aria-label="Налаштування Focus Clock" aria-expanded={focusSettingsOpen}>⚙</button>
        <button className="focus-icon-button" onClick={() => setDashboardMode('dashboard')} aria-label="Відкрити дашборд">▦</button>
      </div>
      {focusSettingsOpen && <aside className="focus-settings" aria-label="Налаштування годинника">
        <div><p className="eyebrow">Focus Clock</p><button onClick={() => setFocusSettingsOpen(false)} aria-label="Закрити налаштування">×</button></div>
        <label><span>Секунди у звичайному годиннику</span><input type="checkbox" checked={focusShowSeconds} onChange={(event) => updateFocusSetting('seconds', event.target.checked)} /></label>
        <label><span>Показувати контекст задачі</span><input type="checkbox" checked={focusShowContext} onChange={(event) => updateFocusSetting('context', event.target.checked)} /></label>
      </aside>}
      <div className="focus-orbit focus-orbit--one" /><div className="focus-orbit focus-orbit--two" />
      <div className="focus-content">
        {focusShowContext && <><p className="focus-project">{focusProject}</p><h1>{focusTitle}</h1></>}
        <strong>{focusMainTime}</strong>
        {focusShowContext && <p className="focus-state">{focusState}</p>}
      </div>
      <div className="focus-dock">
        {activeRest ? restActions() : primaryTask ? <button className={primaryTask.status === 'running' ? 'primary-button' : ''} disabled={loading} onClick={() => void send(primaryTask.status === 'running' ? { command: 'pause-task', taskId: primaryTask.id } : { command: 'resume-task', taskId: primaryTask.id })}>{primaryTask.status === 'running' ? 'Ⅱ Пауза' : '▶ Продовжити'}</button> : null}
        {!activeRest && workday && <button disabled={loading} onClick={() => void send({ command: 'start-rest', restType: 'break' })}>Перерва</button>}
      </div>
      {focusUsesWorkTimer && <div className="focus-task-rail">{activeTasks.slice(0, 4).map((task) => {
        const project = task.projectId ? projectById.get(task.projectId) : undefined
        return <span key={task.id} className={task.status === 'running' ? 'is-running' : ''} style={{ '--project': project?.color ?? '#b8e986' } as React.CSSProperties}>{project?.name || taskLabel(task)}</span>
      })}</div>}
    </section> : <>
      <section className="dashboard-grid">
        <article className="hero-clock">
          <div className="hero-clock__top"><p>{activeRest ? (activeRest.type === 'lunch' ? 'Зараз обід' : 'Зараз перерва') : primaryProject?.name || (workday ? 'Поточний фокус' : 'Статус дня')}</p><span>{formatTime(now)}</span></div>
          <strong>{formatDuration(heroDuration)}</strong>
          <h1>{heroTitle}</h1>
          <div className="hero-clock__foot"><span className={runningTasks.length ? 'pulse-dot' : ''} />{activeRest ? 'Відлік твого відпочинку' : runningTasks.length ? `${runningTasks.length} задачі зараз у роботі` : workday ? 'Задачі чекають на старт' : 'День ще не почався'}</div>
        </article>
        <aside className="day-overview">
          <div className="overview-head"><p className="eyebrow">Сьогодні</p><span>{workday ? 'у процесі' : 'вільно'}</span></div>
          <div className="overview-stat"><small>Старт дня</small><strong>{workday ? formatTime(workday.startedAt) : '—'}</strong></div>
          <div className="overview-stat"><small>Активні задачі</small><strong>{runningTasks.length}</strong></div>
          <div className="overview-stat"><small>Відпочинок</small><strong>{activeRest ? formatDuration(restElapsed(activeRest, now)) : '—'}</strong></div>
          <div className="day-pulse"><i /><span>{workday ? 'Синхронізовано з десктопом' : 'Почни день у Work Buddy'}</span></div>
        </aside>
      </section>
      <section className="quick-actions" aria-label="Швидкі дії">{restActions()}</section>
      {commandStatus && <p className="command-status">{commandStatus}</p>}
      <section className="tasks-panel">
        <div className="section-heading"><div><p className="eyebrow">У роботі</p><h2>Активні задачі</h2></div><span>{activeTasks.length}</span></div>
        {activeTasks.length ? <div className="task-list">{activeTasks.map((task) => {
          const project = task.projectId ? projectById.get(task.projectId) : undefined
          const running = task.status === 'running'
          return <article className={`task-card ${running ? 'task-card--running' : ''}`} key={task.id} style={{ '--project': project?.color ?? '#b8e986' } as React.CSSProperties}>
            <div className="task-card__project-mark" />
            <div className="task-card__content"><p className="project-name">{project?.name || 'Без проєкту'}</p><h3>{taskLabel(task)}</h3><strong>{formatDuration(taskElapsed(task, now))}</strong></div>
            <button className={running ? 'pause-button' : 'play-button'} disabled={loading} onClick={() => void send(running ? { command: 'pause-task', taskId: task.id } : { command: 'resume-task', taskId: task.id })} aria-label={running ? 'Поставити на паузу' : 'Продовжити'}>{running ? 'Ⅱ' : '▶'}</button>
          </article>
        })}</div> : <p className="empty-state">Поки тихо. Запусти першу задачу на десктопі.</p>}
      </section>
    </>}
    {mode === 'dashboard' && <p className="account-label">{email}</p>}
  </main>
}
