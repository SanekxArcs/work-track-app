import { useEffect, useState } from 'react'
import { Check, Pause, Play, RefreshCw, RotateCcw, Zap } from 'lucide-react'
import type { ActivityDay } from '@shared/activity'
import type { AppSnapshot } from '@shared/types'
import {
  AUTO_INTERVALS,
  AUTO_MINIMUMS,
  autoEntryLive,
  autoEntryMs,
  autoEntryProject,
  type AutoEntry,
  type AutoTrackingConfig
} from '@shared/activity-auto'
import { formatDuration } from '../lib/time'
import { translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { CustomSelect } from './CustomSelect'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Monitoring card for unattended tracking. Entries are journal rows built from
 * PC and browser observations; recording one creates an ordinary stopped task.
 */
export function ActivityAutoTracking({
  data,
  snapshot,
  reload,
  onRecorded
}: {
  data: ActivityDay
  snapshot: AppSnapshot
  reload: () => Promise<void>
  onRecorded: (snapshot: AppSnapshot) => Promise<void>
}): React.JSX.Element | null {
  const uk = snapshot.settings.locale === 'uk',
    l = (en: string, ua: string) => (uk ? ua : en),
    t = translator(snapshot.settings.locale)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [limit, setLimit] = useState(20)
  useEffect(() => {
    setSelected([])
    setConfirm(false)
    setError('')
    setNotice('')
    setNotes({})
    setLimit(20)
  }, [data.day])
  const auto = data.auto
  if (!auto) return null
  const call = window.workBuddy.activityAuto
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(errorText(e, t, 'actionFailed'))
    } finally {
      setBusy(false)
    }
  }
  const configure = (patch: Partial<AutoTrackingConfig>) =>
    act(() => call('configure', { day: data.day, config: { ...auto.config, ...patch } }))
  const update = (entry: AutoEntry, patch: { project?: 'auto' | string | null; notes?: string }) =>
    act(() => call('update', { day: data.day, id: entry.id, patch }))
  const now = Date.now()
  const open = auto.entries.filter((e) => e.status === 'open'),
    promoted = auto.entries.filter((e) => e.status === 'promoted'),
    dismissed = auto.entries.filter((e) => e.status === 'dismissed')
  const projects = snapshot.projects.filter((p) => !p.archived)
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? ''
  const sum = (rows: AutoEntry[]) => rows.reduce((total, e) => total + autoEntryMs(e), 0)
  const withProject = open.filter((e) => projectName(autoEntryProject(e)))
  const chosen = open.filter((e) => selected.includes(e.id))
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  const stamp = (at: number) => new Date(at).toLocaleString(uk ? 'uk-UA' : 'en-GB')
  const reason = (entry: AutoEntry) =>
    entry.chosenProjectId !== undefined
      ? l('Your project choice', 'Ваш вибір проєкту')
      : {
          correction: l('Your observation correction', 'Ваше уточнення спостереження'),
          confirmed: l('Confirmed AI match', 'Підтверджений збіг ШІ'),
          link: l('Shared browser project link', 'Спільний зв’язок із проєктом браузера'),
          rule: l('Remembered project rule', 'Збережене правило проєкту'),
          name: l('Matching project name', 'Збіг назви проєкту'),
          conflict: l('Rules disagree · choose a project', 'Правила суперечать · оберіть проєкт'),
          unassigned: l('No project matched yet', 'Проєкт ще не визначено')
        }[entry.match]
  const record = (ids: string[]) =>
    act(async () => {
      const result = await call('promote', { day: data.day, ids })
      setConfirm(false)
      setSelected([])
      setNotice(
        result.created
          ? l(`Recorded ${result.created} task entries`, `Записано завдань: ${result.created}`)
          : l('These entries were already recorded', 'Ці записи вже збережено')
      )
      if (result.snapshot) await onRecorded(result.snapshot)
    })
  return (
    <section className="activity-card activity-auto" aria-label={l('Automatic tracking', 'Автоматичний облік')}>
      <div className="activity-section-title">
        <h3>
          <Zap size={14} />
          {l('Automatic tracking', 'Автоматичний облік')}
        </h3>
        <span className={`activity-state ${auto.config.enabled ? 'is-on' : ''}`}>
          <i />
          {auto.config.enabled ? l('On', 'Увімкнено') : l('Off', 'Вимкнено')}
        </span>
      </div>
      <p>
        {l(
          'Work Buddy regularly combines PC and browser observations and journals work periods outside your timers and breaks here. This is a monitoring journal: manual timers keep working, and nothing becomes a task until you record it.',
          'Work Buddy регулярно поєднує спостереження ПК і браузера та веде тут журнал робочих періодів поза вашими таймерами й перервами. Це журнал для спостереження: ручні таймери працюють як раніше, і ніщо не стає завданням, доки ви його не запишете.'
        )}
      </p>
      <div className="activity-tools">
        <button
          className={auto.config.enabled ? 'secondary-button' : 'primary-button'}
          disabled={busy}
          onClick={() => void configure({ enabled: !auto.config.enabled })}
        >
          {auto.config.enabled ? <Pause size={13} /> : <Play size={13} />}
          {auto.config.enabled
            ? l('Pause automatic tracking', 'Призупинити автоматичний облік')
            : l('Start automatic tracking', 'Увімкнути автоматичний облік')}
        </button>
        <button
          className="icon-button"
          disabled={busy || auto.running}
          aria-label={l('Run automatic tracking now', 'Запустити автоматичний облік зараз')}
          title={l('Run now', 'Запустити зараз')}
          onClick={() => void act(() => call('run', { day: data.day }))}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="activity-setting-grid">
        <label>
          {l('Minimum period', 'Мінімальний період')}
          <CustomSelect
            value={String(auto.config.minimumMs)}
            ariaLabel={l('Minimum automatic period', 'Мінімальний автоматичний період')}
            options={AUTO_MINIMUMS.map((ms) => ({
              value: String(ms),
              label: `${ms / 60000} ${ms === 60000 ? l('minute', 'хвилина') : l('minutes', 'хвилин')}`
            }))}
            onChange={(value) => void configure({ minimumMs: Number(value) as AutoTrackingConfig['minimumMs'] })}
          />
        </label>
        <label>
          {l('Check every', 'Перевіряти кожні')}
          <CustomSelect
            value={String(auto.config.intervalMinutes)}
            ariaLabel={l('Automatic tracking interval', 'Інтервал автоматичного обліку')}
            options={AUTO_INTERVALS.map((minutes) => ({
              value: String(minutes),
              label: `${minutes} ${l('min', 'хв')}`
            }))}
            onChange={(value) =>
              void configure({ intervalMinutes: Number(value) as AutoTrackingConfig['intervalMinutes'] })
            }
          />
        </label>
      </div>
      <small className="activity-auto-status">
        {auto.running
          ? l('Reading observations…', 'Читання спостережень…')
          : `${l('Last run', 'Останній запуск')}: ${auto.lastRunAt ? stamp(auto.lastRunAt) : '—'}`}
        {auto.lastError && ` · ${auto.lastError}`}
      </small>
      {error && (
        <p className="form-error" role="status">
          {error}
        </p>
      )}
      {notice && (
        <p className="activity-import-success" role="status">
          <Check size={13} />
          {notice}
        </p>
      )}
      <div className="activity-metrics activity-auto-metrics">
        {[
          [l('Auto work', 'Автоматична робота'), formatDuration(sum(open) + sum(promoted))],
          [l('Entries', 'Записів'), String(open.length)],
          [l('With project', 'З проєктом'), formatDuration(sum(withProject))],
          [l('Recorded as tasks', 'Записано як завдання'), formatDuration(sum(promoted))]
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {chosen.length > 0 && (
        <button className="primary-button" disabled={busy} onClick={() => setConfirm(true)}>
          <Check size={13} />
          {l('Record selected as tasks', 'Записати вибране як завдання')} ({chosen.length})
        </button>
      )}
      {!open.length && (
        <p className="activity-suggestion-empty">
          {auto.config.enabled
            ? l(
                'No automatic entries for this day yet. Periods appear once observed activity outside your timers reaches the minimum.',
                'Автоматичних записів за цей день поки немає. Періоди з’являться, коли активність поза таймерами сягне мінімуму.'
              )
            : l(
                'Automatic tracking is paused. Start it to begin journaling untracked work for a few days before deciding on the next step.',
                'Автоматичний облік призупинено. Увімкніть його, щоб кілька днів вести журнал неврахованої роботи, перш ніж вирішувати наступний крок.'
              )}
        </p>
      )}
      {open.slice(0, limit).map((entry, index) => {
        const live = autoEntryLive(entry, now),
          project = autoEntryProject(entry),
          start = entry.intervals[0].start,
          end = entry.intervals[entry.intervals.length - 1].end
        return (
          <div className={`activity-suggestion activity-auto-entry ${live ? 'is-live' : ''}`} key={entry.id}>
            <label className="activity-suggestion-pick">
              <input
                type="checkbox"
                checked={selected.includes(entry.id)}
                disabled={live || busy}
                aria-label={l(`Select automatic entry ${index + 1}`, `Обрати автоматичний запис ${index + 1}`)}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id)
                  )
                }
              />
              <span>
                <strong>{projectName(project) || l('No project', 'Без проєкту')}</strong>
                <small>
                  {time(start)}–{time(end)} · {formatDuration(autoEntryMs(entry))}
                  {live && ` · ${l('still going', 'триває')}`}
                </small>
              </span>
            </label>
            <p>{entry.context.join(' · ')}</p>
            <small className="activity-match-reason">{reason(entry)}</small>
            <CustomSelect
              value={entry.chosenProjectId === undefined ? 'auto' : (entry.chosenProjectId ?? '')}
              ariaLabel={l(`Project for automatic entry ${index + 1}`, `Проєкт автоматичного запису ${index + 1}`)}
              options={[
                {
                  value: 'auto',
                  label: `${l('Follow matching', 'За збігом')}${entry.projectLabel ? ` · ${entry.projectLabel}` : ''}`
                },
                { value: '', label: l('No project', 'Без проєкту') },
                ...projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))
              ]}
              onChange={(value) => void update(entry, { project: value === 'auto' ? 'auto' : value || null })}
            />
            <input
              type="text"
              maxLength={2000}
              disabled={busy}
              aria-label={l(`Description for automatic entry ${index + 1}`, `Опис автоматичного запису ${index + 1}`)}
              placeholder={`Auto · ${entry.context.join(' · ')}`}
              value={notes[entry.id] ?? entry.notes ?? ''}
              onChange={(e) => setNotes((current) => ({ ...current, [entry.id]: e.target.value }))}
              onBlur={() => {
                const draft = notes[entry.id]
                if (draft !== undefined && draft.trim() !== (entry.notes ?? '')) void update(entry, { notes: draft })
              }}
            />
            <div className="activity-tools">
              <button
                className="secondary-button"
                disabled={busy || live}
                title={live ? l('Wait until this period settles', 'Зачекайте, поки період завершиться') : undefined}
                onClick={() => {
                  setSelected([entry.id])
                  setConfirm(true)
                }}
              >
                <Check size={12} />
                {l('Record as task', 'Записати як завдання')}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void act(() => call('dismiss', { day: data.day, id: entry.id }))}
              >
                {l('Not work', 'Не робота')}
              </button>
            </div>
          </div>
        )
      })}
      {open.length > limit && (
        <button className="secondary-button" onClick={() => setLimit((value) => value + 20)}>
          {l('Show more entries', 'Показати ще записи')}
        </button>
      )}
      {promoted.length > 0 && (
        <details>
          <summary>
            {l('Recorded as tasks', 'Записано як завдання')} ({promoted.length})
          </summary>
          {promoted.map((entry) => (
            <div className="activity-manual" key={entry.id}>
              <strong>{projectName(autoEntryProject(entry)) || l('No project', 'Без проєкту')}</strong>
              <span>{entry.notes || `Auto · ${entry.context.join(' · ')}`}</span>
              <small>
                {time(entry.intervals[0].start)}–{time(entry.intervals[entry.intervals.length - 1].end)} ·{' '}
                {formatDuration(autoEntryMs(entry))}
              </small>
            </div>
          ))}
        </details>
      )}
      {dismissed.length > 0 && (
        <details>
          <summary>
            {l('Marked as not work', 'Позначено як не робота')} ({dismissed.length})
          </summary>
          {dismissed.map((entry) => (
            <div className="activity-manual" key={entry.id}>
              <span>{entry.context.join(' · ')}</span>
              <small>
                {time(entry.intervals[0].start)}–{time(entry.intervals[entry.intervals.length - 1].end)} ·{' '}
                {formatDuration(autoEntryMs(entry))}
              </small>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void act(() => call('restore', { day: data.day, id: entry.id }))}
              >
                <RotateCcw size={12} />
                {l('Restore', 'Повернути')}
              </button>
            </div>
          ))}
        </details>
      )}
      <p>
        {l(
          'Entries follow your corrections, shared project links and remembered rules. Gaps between observations are never counted. Pausing stops new entries; existing ones stay.',
          'Записи враховують ваші уточнення, спільні зв’язки проєктів і збережені правила. Прогалини між спостереженнями не рахуються. Пауза зупиняє нові записи; наявні залишаються.'
        )}
      </p>
      <ConfirmDialog
        open={confirm}
        title={l('Record these entries as completed tasks?', 'Записати ці записи як завершені завдання?')}
        body={
          <>
            <p>
              {chosen.length} · {formatDuration(sum(chosen))}
            </p>
            {chosen.map((entry) => (
              <p key={entry.id}>
                <b>{projectName(autoEntryProject(entry)) || l('No project', 'Без проєкту')}</b> ·{' '}
                {entry.notes || `Auto · ${entry.context.join(' · ')}`}
              </p>
            ))}
          </>
        }
        confirmLabel={l('Record tasks', 'Записати завдання')}
        cancelLabel={l('Cancel', 'Скасувати')}
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void record(chosen.map((e) => e.id))}
      />
    </section>
  )
}
