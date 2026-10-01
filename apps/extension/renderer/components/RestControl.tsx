import { useState } from 'react'
import { motion } from '../../lib/motion-shim'
import { Check, Coffee, Dumbbell, Pause, Pencil, Play, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react'
import type { AppSnapshot, RestSession, RestType } from '../../shared/types'
import { dueRestTypes, restElapsed, restRemaining } from '../../shared/rest'
import type { Translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { formatDuration } from '../lib/time'
import { TimeInput } from './TimeInput'

interface RestControlProps {
  snapshot: AppSnapshot
  now: number
  t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void
}

function restCopy(type: RestType, t: Translator): { title: string; due: string } {
  return type === 'lunch'
    ? { title: t('lunchInProgress'), due: t('lunchDueBody') }
    : { title: t('breakInProgress'), due: t('breakDueBody') }
}

export function RestControl({ snapshot, now, t, onSnapshot }: RestControlProps): React.JSX.Element | null {
  const active = snapshot.rests.find((rest) => rest.status !== 'completed')
  const due = dueRestTypes(snapshot.settings, snapshot.workday, snapshot.rests, snapshot.tasks, now)
  const [error, setError] = useState('')

  const mutate = async (promise: Promise<AppSnapshot>): Promise<void> => onSnapshot(await promise)
  /** Applies the result, or shows why the action failed. */
  const run = (promise: Promise<AppSnapshot>): void => {
    setError('')
    void mutate(promise).catch((reason: unknown) => setError(errorText(reason, t)))
  }
  const start = (type: RestType): void => run(window.workBuddy.startRest(type))
  const skip = (type: RestType): void => run(window.workBuddy.skipRest(type))

  if (active) return <ActiveRest rest={active} now={now} t={t} error={error} mutate={mutate} run={run} />
  if (!due.length) return null

  return (
    <div className="rest-due-stack">
      {error && <small className="form-error">{error}</small>}
      {due.map((type, index) => {
        const Icon = type === 'lunch' ? Coffee : Dumbbell
        const copy = restCopy(type, t)
        return (
          <motion.section className={`rest-due rest-due--${type}`} key={type} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .05 }}>
            <div className="rest-due__icon"><Icon size={18} /></div>
            <div><strong>{type === 'lunch' ? t('lunchIsDue') : t('breakIsDue')}</strong><p>{copy.due}</p></div>
            <div className="rest-due__actions">
              <button className="rest-due__start" onClick={() => start(type)}><Play size={14} fill="currentColor" />{type === 'lunch' ? t('startLunch') : t('startBreak')}</button>
              <button className="rest-due__skip" onClick={() => skip(type)}><SkipForward size={13} />{t('skipToday')}</button>
            </div>
          </motion.section>
        )
      })}
    </div>
  )
}

function ActiveRest({ rest, now, t, error, mutate, run }: { rest: RestSession; now: number; t: Translator; error: string; mutate: (promise: Promise<AppSnapshot>) => Promise<void>; run: (promise: Promise<AppSnapshot>) => void }): React.JSX.Element {
  const [editingTime, setEditingTime] = useState(false)
  const [timeError, setTimeError] = useState('')
  const Icon = rest.type === 'lunch' ? Coffee : Dumbbell
  const remaining = restRemaining(rest, now)
  const elapsed = restElapsed(rest, now)
  const overtime = Math.max(0, elapsed - rest.plannedMinutes * 60_000)
  const progress = Math.min(100, elapsed / (rest.plannedMinutes * 60_000) * 100)
  const paused = rest.status === 'paused'
  const copy = restCopy(rest.type, t)
  const firstStart = rest.intervals.slice().sort((a, b) => a.startedAt - b.startedAt)[0]?.startedAt
  const initialTime = firstStart ? `${String(new Date(firstStart).getHours()).padStart(2, '0')}:${String(new Date(firstStart).getMinutes()).padStart(2, '0')}` : ''
  const [startTime, setStartTime] = useState(initialTime)

  const saveStart = async (): Promise<void> => {
    if (!firstStart || !startTime) return
    const [hours, minutes] = startTime.split(':').map(Number)
    const adjusted = new Date(firstStart)
    adjusted.setHours(hours, minutes, 0, 0)
    setTimeError('')
    try {
      await mutate(window.workBuddy.updateRestStart(rest.id, adjusted.getTime()))
      setEditingTime(false)
    } catch (reason) {
      setTimeError(errorText(reason, t, 'timeUpdateError'))
    }
  }

  return (
    <motion.section className={`active-rest active-rest--${rest.type}`} layout initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="active-rest__top">
        <div className="active-rest__identity"><span><Icon size={18} /></span><div><small>{paused ? t('restPaused') : t('nowResting')}</small><strong>{copy.title}</strong></div></div>
        <button className={`active-rest__clock ${remaining === 0 ? 'is-done' : ''}`} onClick={() => setEditingTime(true)} title={t('editRestStart')}><span>{remaining === 0 ? t('restTimeUp') : formatDuration(remaining)}</span>{overtime > 0 && <small>+{formatDuration(overtime, true)}</small>}<Pencil size={11} /></button>
      </div>
      {editingTime && (
        <div className="rest-time-editor">
          <label><span>{t('restStartedAt')}</span><TimeInput autoFocus value={startTime} onChange={setStartTime} ariaLabel={t('restStartedAt')} /></label>
          <button className="confirm" onClick={saveStart}><Check size={14} /></button>
          <button onClick={() => { setEditingTime(false); setStartTime(initialTime); setTimeError('') }}><X size={14} /></button>
          {timeError && <small>{timeError}</small>}
        </div>
      )}
      <div className="active-rest__progress"><motion.span animate={{ width: `${progress}%` }} /></div>
      <p>{paused ? t('restPausedBody') : t('restRunningBody')}</p>
      {error && <small className="form-error">{error}</small>}
      <div className={`active-rest__actions ${remaining === 0 ? 'active-rest__actions--with-sound' : ''}`}>
        {paused
          ? <button className="rest-primary" onClick={() => run(window.workBuddy.resumeRest(rest.id))}><Play size={15} fill="currentColor" />{t('continueRest')}</button>
          : <button onClick={() => run(window.workBuddy.pauseRest(rest.id))}><Pause size={15} fill="currentColor" />{t('pauseRest')}</button>}
        {remaining === 0 && <button className={`rest-sound-toggle ${rest.alarmMuted ? 'is-muted' : ''}`} onClick={() => run(window.workBuddy.setRestAlarmMuted(rest.id, !rest.alarmMuted))} title={rest.alarmMuted ? t('unmuteRestAlarm') : t('muteRestAlarm')} aria-label={rest.alarmMuted ? t('unmuteRestAlarm') : t('muteRestAlarm')}>{rest.alarmMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>}
        <button className="rest-finish" onClick={() => run(window.workBuddy.completeRest(rest.id))}><Square size={13} fill="currentColor" />{t('finishRest')}</button>
      </div>
    </motion.section>
  )
}
