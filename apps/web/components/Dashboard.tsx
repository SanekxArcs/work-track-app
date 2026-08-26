'use client'

import { useEffect, useMemo, useState } from 'react'
import { activeWorkday, formatDuration, taskElapsed, type WebRest, type WebTask, type WebWorkspace, type WorkBuddyCommand } from '../lib/workspace'

type WorkspaceResponse = { workspace: WebWorkspace | null; error?: string }

function taskLabel(task: WebTask): string {
  return task.notes.trim() || task.title.trim() || 'Без опису'
}

function restElapsed(rest: WebRest, now: number): number {
  return rest.intervals.reduce((total, interval) => total + Math.max(0, (interval.endedAt ?? now) - interval.startedAt), 0)
}

export function Dashboard({ initialWorkspace, email }: { initialWorkspace: WebWorkspace | null; email: string }): React.JSX.Element {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [now, setNow] = useState(Date.now())
  const [commandStatus, setCommandStatus] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    const refresh = async (): Promise<void> => {
      const response = await fetch('/api/workspace', { cache: 'no-store' })
      const data = await response.json().catch(() => null) as WorkspaceResponse | null
      if (response.ok && data) setWorkspace(data.workspace)
    }
    void refresh()
    const sync = window.setInterval(() => void refresh(), 1_500)
    return () => { window.clearInterval(clock); window.clearInterval(sync) }
  }, [])

  const projectById = useMemo(() => new Map(workspace?.projects.map((project) => [project.id, project]) ?? []), [workspace])
  const activeRest = workspace?.rests.find((rest) => rest.status !== 'completed')
  const activeTasks = workspace?.tasks.filter((task) => task.status !== 'stopped') ?? []
  const runningTasks = activeTasks.filter((task) => task.status === 'running')
  const workday = workspace ? activeWorkday(workspace) : undefined

  const send = async (command: WorkBuddyCommand): Promise<void> => {
    setLoading(true)
    setCommandStatus('')
    try {
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
      const data = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error || 'Не вдалося надіслати команду')
      setCommandStatus('Команда надіслана на Work Buddy — зміни з’являться за мить.')
    } catch (error) {
      setCommandStatus(error instanceof Error ? error.message : 'Не вдалося надіслати команду')
    } finally {
      setLoading(false)
    }
  }

  if (!workspace) return <main className="setup-card"><p className="eyebrow">Work Buddy Web</p><h1>Чекаю першу синхронізацію</h1><p>Відкрий десктопний Work Buddy і виконай синхронізацію з Sanity. Після цього цей екран оживе сам.</p></main>

  return <main className="dashboard-shell">
    <header className="dashboard-header"><div><p className="eyebrow">Work Buddy · live dashboard</p><h1>{workday ? 'День у процесі' : 'День ще не почався'}</h1></div><span className="live-chip"><i />онлайн</span></header>

    <section className="hero-clock">
      <p>{activeRest ? (activeRest.type === 'lunch' ? 'Зараз обід' : 'Зараз перерва') : `${runningTasks.length} активних задач`}</p>
      <strong>{activeRest ? formatDuration(restElapsed(activeRest, now)) : formatDuration(runningTasks.reduce((sum, task) => sum + taskElapsed(task, now), 0))}</strong>
      <small>{email}</small>
    </section>

    <section className="quick-actions" aria-label="Швидкі дії">
      {activeRest ? <button className="primary-button" disabled={loading} onClick={() => void send({ command: 'complete-rest', restId: activeRest.id })}>Завершити {activeRest.type === 'lunch' ? 'обід' : 'перерву'}</button> : <>
        <button disabled={loading || !workday} onClick={() => void send({ command: 'start-rest', restType: 'break' })}>Взяти перерву</button>
        <button disabled={loading || !workday} onClick={() => void send({ command: 'start-rest', restType: 'lunch' })}>Почати обід</button>
        <button className="danger-button" disabled={loading || !workday} onClick={() => void send({ command: 'end-workday' })}>Завершити день</button>
      </>}
    </section>
    {commandStatus && <p className="command-status">{commandStatus}</p>}

    <section className="tasks-panel"><div className="section-heading"><h2>Задачі</h2><span>{activeTasks.length}</span></div>{activeTasks.length ? <div className="task-list">{activeTasks.map((task) => {
      const project = task.projectId ? projectById.get(task.projectId) : undefined
      const running = task.status === 'running'
      return <article className={`task-card ${running ? 'task-card--running' : ''}`} key={task.id} style={{ '--project': project?.color ?? '#b8e986' } as React.CSSProperties}>
        <div><p className="project-name">{project?.name || 'Без проєкту'}</p><h3>{taskLabel(task)}</h3><strong>{formatDuration(taskElapsed(task, now))}</strong></div>
        <button className={running ? 'pause-button' : 'play-button'} disabled={loading} onClick={() => void send(running ? { command: 'pause-task', taskId: task.id } : { command: 'resume-task', taskId: task.id })}>{running ? 'Ⅱ' : '▶'}</button>
      </article>
    })}</div> : <p className="empty-state">Поки тихо. Запусти першу задачу на десктопі.</p>}</section>
  </main>
}
