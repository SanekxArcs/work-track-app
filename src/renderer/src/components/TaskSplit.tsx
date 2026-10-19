import { useEffect, useState } from 'react'
import type { AppSnapshot, Task } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { formatDuration } from '../lib/time'
import { ProjectPicker } from './ProjectPicker'

const minute = 60_000
function localInput(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskSplit({ task, snapshot, t, onCancel, onSaved, onSnapshot }: {
  task: Task; snapshot: AppSnapshot; t: Translator; onCancel: () => void
  onSaved: (snapshot: AppSnapshot) => void; onSnapshot: (snapshot: AppSnapshot) => void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (task.status !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [task.status])
  const ranges = [...task.intervals].sort((a, b) => a.startedAt - b.startedAt)
  const start = ranges[0].startedAt
  const end = Math.max(...ranges.map((r) => r.endedAt ?? now))
  const min = Math.floor(start / minute) + 1
  const max = Math.ceil(end / minute) - 1
  const [point, setPoint] = useState(Math.max(min, Math.min(max, Math.round((start + end) / (2 * minute)))))
  const [first, setFirst] = useState({ projectId: task.projectId ?? '', notes: task.notes })
  const [second, setSecond] = useState({ projectId: task.projectId ?? '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const splitAt = point * minute
  const firstMs = ranges.reduce((sum, r) => sum + Math.max(0, Math.min(r.endedAt ?? now, splitAt) - r.startedAt), 0)
  const secondMs = ranges.reduce((sum, r) => sum + Math.max(0, (r.endedAt ?? now) - Math.max(r.startedAt, splitAt)), 0)
  const valid = Number.isSafeInteger(splitAt) && min <= max && firstMs > 0 && secondMs > 0
  const stamp = (value: number): string => new Date(value).toLocaleString(t.locale === 'uk' ? 'uk-UA' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const save = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      onSaved(await window.workBuddy.splitTask({ id: task.id, expectedUpdatedAt: task.updatedAt, splitAt,
        first: { ...first, projectId: first.projectId || null }, second: { ...second, projectId: second.projectId || null } }))
    } catch (cause) { setError(errorText(cause, t, 'timeUpdateError')) }
    finally { setBusy(false) }
  }
  return <div className="task-split">
    <h3>{t('splitTask')}</h3>
    <p className="time-ranges-description">{t('splitTaskBody')}</p>
    {task.status !== 'stopped' && <p className="time-ranges-description">{t('splitActiveBody')}</p>}
    <div className="split-endpoints"><span>{stamp(start)}</span><span>{stamp(end)}</span></div>
    <input className="split-slider" type="range" min={min} max={Math.max(min, max)} step={1} value={point} disabled={busy || min > max}
      aria-label={t('splitAt')} aria-valuetext={stamp(splitAt)} onChange={(e) => setPoint(Number(e.target.value))} />
    <label className="field"><span>{t('splitAt')}</span><input type="datetime-local" step={60} min={localInput(min * minute)} max={localInput(max * minute)} value={localInput(splitAt)} disabled={busy || min > max}
      onChange={(e) => { const value = new Date(e.target.value).getTime(); if (Number.isFinite(value)) setPoint(Math.round(value / minute)) }} /></label>
    {[first, second].map((part, index) => <section key={index} className="task-time-range">
      <div className="task-time-range__heading"><strong>{t(index === 0 ? 'splitFirst' : 'splitSecond')}{index === 1 && task.status !== 'stopped' ? ` · ${t(task.status === 'running' ? 'running' : 'paused')}` : ''}</strong><span>{formatDuration(index === 0 ? firstMs : secondMs)}</span></div>
      <small>{stamp(index === 0 ? start : splitAt)} – {stamp(index === 0 ? splitAt : end)}</small>
      <div className="field"><span>{t('project')}</span><ProjectPicker value={part.projectId} snapshot={snapshot} ariaLabel={t('project')} t={t}
        onChange={(projectId) => (index === 0 ? setFirst : setSecond)({ ...part, projectId })} onSnapshot={onSnapshot} onError={setError} /></div>
      <label className="field"><span>{t('notes')}</span><textarea rows={2} value={part.notes} disabled={busy} placeholder={t('notesPlaceholder')}
        onChange={(e) => (index === 0 ? setFirst : setSecond)({ ...part, notes: e.target.value })} /></label>
    </section>)}
    {!valid && <p className="form-error">{t('splitNoTime')}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>{t('cancel')}</button>
      <button className="primary-button" disabled={busy || !valid} onClick={() => void save()}>{t('splitTask')}</button></div>
  </div>
}
