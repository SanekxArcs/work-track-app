import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Coffee, Dumbbell, Pause, Pencil, Play, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react'
import type { AppSnapshot, RestSession, RestType } from '@shared/types'
import { dueRestTypes, restElapsed, restRemaining } from '@shared/rest'
import type { Translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { AnimatedDuration, Collapse, ease, StackItem, Swap } from './Animated'
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

  const mutate = async (promise: Promise<AppSnapshot>): Promise<void> => onSnapshot(await promise)
  const start = (type: RestType): void => { void mutate(window.workBuddy.startRest(type)) }
  const skip = (type: RestType): void => { void mutate(window.workBuddy.skipRest(type)) }

  // Due cards and the running rest grow in and shrink out, so the page below glides instead of jumping.
  return (
    <AnimatePresence initial={false}>
      {active ? (
        <StackItem key={`rest-${active.id}`}><ActiveRest rest={active} now={now} t={t} mutate={mutate} /></StackItem>
      ) : due.length > 0 ? (
        <StackItem key="due">
          <div className="rest-due-stack">
            <AnimatePresence initial={false}>
              {due.map((type) => {
                const Icon = type === 'lunch' ? Coffee : Dumbbell
                const copy = restCopy(type, t)
                return (
                  <StackItem key={type} gap={7}>
                    <section className={`rest-due rest-due--${type}`}>
                      <div className="rest-due__icon"><Icon size={18} /></div>
                      <div><strong>{type === 'lunch' ? t('lunchIsDue') : t('breakIsDue')}</strong><p>{copy.due}</p></div>
                      <div className="rest-due__actions">
                        <button className="rest-due__start" onClick={() => start(type)}><Play size={14} fill="currentColor" />{type === 'lunch' ? t('startLunch') : t('startBreak')}</button>
                        <button className="rest-due__skip" onClick={() => skip(type)}><SkipForward size={13} />{t('skipToday')}</button>
                      </div>
                    </section>
                  </StackItem>
                )
              })}
            </AnimatePresence>
          </div>
        </StackItem>
      ) : null}
    </AnimatePresence>
  )
}

function ActiveRest({ rest, now, t, mutate }: { rest: RestSession; now: number; t: Translator; mutate: (promise: Promise<AppSnapshot>) => Promise<void> }): React.JSX.Element {
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
    } catch (error) {
      setTimeError(errorText(error, t, 'timeUpdateError'))
    }
  }

  return (
    <section className={`active-rest active-rest--${rest.type}`}>
      <div className="active-rest__top">
        <div className="active-rest__identity"><span><Icon size={18} /></span><AnimatePresence initial={false}>{paused && <motion.div key="paused" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} transition={{ duration: 0.18, ease }}><small>{t('restPaused')}</small></motion.div>}</AnimatePresence></div>
        <button className={`active-rest__clock ${remaining === 0 ? 'is-done' : ''}`} onClick={() => setEditingTime(true)} title={t('editRestStart')}>{remaining === 0 ? <span>{t('restTimeUp')}</span> : <AnimatedDuration className="active-rest__time" ms={remaining} />}{overtime > 0 && <small>+<AnimatedDuration ms={overtime} compact /></small>}<Pencil size={11} /></button>
      </div>
      <Collapse open={editingTime}>
        <div className="rest-time-editor">
          <label><span>{t('restStartedAt')}</span><TimeInput autoFocus value={startTime} onChange={setStartTime} ariaLabel={t('restStartedAt')} /></label>
          <button className="confirm" onClick={saveStart}><Check size={14} /></button>
          <button onClick={() => { setEditingTime(false); setStartTime(initialTime); setTimeError('') }}><X size={14} /></button>
          <Collapse open={Boolean(timeError)} className="rest-time-editor__error"><small>{timeError}</small></Collapse>
        </div>
      </Collapse>
      <div className="active-rest__progress"><motion.span animate={{ width: `${progress}%` }} /></div>
      <motion.p key={paused ? 'paused' : 'running'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }}>{paused ? t('restPausedBody') : t('restRunningBody')}</motion.p>
      <div className={`active-rest__actions ${remaining === 0 ? 'active-rest__actions--with-sound' : ''}`}>
        {paused
          ? <button className="rest-primary" onClick={() => void mutate(window.workBuddy.resumeRest(rest.id))}><Play size={15} fill="currentColor" />{t('continueRest')}</button>
          : <button onClick={() => void mutate(window.workBuddy.pauseRest(rest.id))}><Pause size={15} fill="currentColor" />{t('pauseRest')}</button>}
        {remaining === 0 && <button className={`rest-sound-toggle ${rest.alarmMuted ? 'is-muted' : ''}`} onClick={() => void mutate(window.workBuddy.setRestAlarmMuted(rest.id, !rest.alarmMuted))} title={rest.alarmMuted ? t('unmuteRestAlarm') : t('muteRestAlarm')} aria-label={rest.alarmMuted ? t('unmuteRestAlarm') : t('muteRestAlarm')}><Swap id={rest.alarmMuted ? 'muted' : 'sound'}>{rest.alarmMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</Swap></button>}
        <button className="rest-finish" onClick={() => void mutate(window.workBuddy.completeRest(rest.id))}><Square size={13} fill="currentColor" />{t('finishRest')}</button>
      </div>
    </section>
  )
}
