import { useEffect, useMemo, useState } from 'react'
import { Check, GitMerge, Scissors, X } from 'lucide-react'
import type { ActivityDay } from '@shared/activity'
import type { AppSnapshot } from '@shared/types'
import {
  activitySuggestions,
  draftFromSuggestions,
  mergeActivityDrafts,
  splitActivityDraft,
  trimActivityDraft,
  type ActivityDraft
} from '@shared/activity-drafts'
import { localDateTimestamp } from '@shared/local-date'
import { formatDuration } from '../lib/time'
import { translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { CustomSelect } from './CustomSelect'
import { TimeInput } from './TimeInput'
import { ConfirmDialog } from './ConfirmDialog'

export function ActivityWorkSuggestions({
  data,
  snapshot,
  onRecorded
}: {
  data: ActivityDay
  snapshot: AppSnapshot
  onRecorded: (snapshot: AppSnapshot) => Promise<void>
}): React.JSX.Element {
  const uk = snapshot.settings.locale === 'uk',
    l = (en: string, ua: string) => (uk ? ua : en),
    t = translator(snapshot.settings.locale)
  const [minimum, setMinimum] = useState(60000),
    [selected, setSelected] = useState<string[]>([]),
    [drafts, setDrafts] = useState<ActivityDraft[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState(false),
    [limit, setLimit] = useState(30)
  const [splitAt, setSplitAt] = useState<Record<number, number>>({})
  const suggestions = useMemo(() => activitySuggestions(data, snapshot, minimum), [data, snapshot, minimum])
  useEffect(() => {
    setSelected([])
    setDrafts([])
    setConfirm(false)
    setError('')
    setNotice('')
    setLimit(30)
  }, [data.day])
  const chosen = suggestions.filter((s) => selected.includes(s.id))
  const duration = (draft: Pick<ActivityDraft, 'intervals'>) =>
    draft.intervals.reduce((sum, r) => sum + r.end - r.start, 0)
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const hm = (at: number) =>
    `${String(new Date(at).getHours()).padStart(2, '0')}:${String(new Date(at).getMinutes()).padStart(2, '0')}`
  const timestamp = (value: string, end = false) => {
    const d = new Date(localDateTimestamp(data.day)),
      [h, m] = value.split(':').map(Number)
    d.setHours(h, m, 0, 0)
    if (end && value === '00:00') d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  const edit = (fn: () => void) => {
    try {
      fn()
      setError('')
      setNotice('')
    } catch (e) {
      setError(errorText(e, t, 'actionFailed'))
    }
  }
  const update = (index: number, patch: Partial<ActivityDraft>) =>
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))
  const open = (ids: string[], merge = false) =>
    edit(() => {
      const rows = suggestions.filter((s) => ids.includes(s.id))
      if (rows.length > 50 && !merge)
        throw new Error(
          l(
            'Review up to 50 entries at once, or merge the selection',
            'Перевіряйте до 50 записів за раз або об’єднайте вибране'
          )
        )
      if (!rows.length) throw new Error(l('Choose observed activity', 'Оберіть спостережену активність'))
      setDrafts(merge ? [draftFromSuggestions(rows)] : rows.map((row) => draftFromSuggestions([row])))
      setSplitAt({})
      setConfirm(false)
    })
  const commit = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.workBuddy.acceptActivityDrafts({ day: data.day, drafts })
      setConfirm(false)
      setDrafts([])
      setSelected([])
      setNotice(
        result.created
          ? l(
              `Recorded ${result.created} completed work entries`,
              `Збережено завершених робочих записів: ${result.created}`
            )
          : l('These entries were already recorded', 'Ці записи вже збережено')
      )
      await onRecorded(result.snapshot)
    } catch (e) {
      setError(errorText(e, t, 'saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="activity-card activity-work-suggestions"
      aria-label={l('Suggested work entries', 'Пропозиції робочих записів')}
    >
      <div className="activity-section-title">
        <h3>{l('Recover untracked work', 'Відновити невраховану роботу')}</h3>
        <span>{suggestions.length}</span>
      </div>
      <p>
        {l(
          'Suggestions use observed active periods outside your tasks and breaks. Choose which periods were work, then review their project, description and exact ranges.',
          'Пропозиції охоплюють спостережену активність поза завданнями й перервами. Оберіть робочі періоди та перевірте проєкт, опис і точні інтервали.'
        )}
      </p>
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
      {!drafts.length ? (
        <>
          <div className="activity-suggestion-filter">
            <span>{l('Minimum period', 'Мінімальний період')}</span>
            <CustomSelect
              value={String(minimum)}
              ariaLabel={l('Minimum suggested duration', 'Мінімальна тривалість пропозиції')}
              options={[
                { value: '30000', label: l('30 seconds', '30 секунд') },
                { value: '60000', label: l('1 minute', '1 хвилина') },
                { value: '300000', label: l('5 minutes', '5 хвилин') }
              ]}
              onChange={(value) => {
                setMinimum(Number(value))
                setSelected([])
              }}
            />
          </div>
          {!suggestions.length && (
            <p className="activity-suggestion-empty">
              {l(
                'No untracked active periods above this duration. Recorded work and breaks are already excluded.',
                'Немає неврахованих активних періодів такої тривалості. Записану роботу та перерви вже виключено.'
              )}
            </p>
          )}
          {chosen.length > 0 && (
            <div className="activity-tools">
              <button className="primary-button" onClick={() => open(selected)}>
                {l('Review selected', 'Переглянути вибране')} ({chosen.length})
              </button>
              {chosen.length > 1 && (
                <button className="secondary-button" onClick={() => open(selected, true)}>
                  <GitMerge size={12} />
                  {l('Merge selected', 'Об’єднати вибране')}
                </button>
              )}
            </div>
          )}
          {suggestions.slice(0, limit).map((suggestion, index) => (
            <div className="activity-suggestion" key={suggestion.id}>
              <label className="activity-suggestion-pick">
                <input
                  type="checkbox"
                  checked={selected.includes(suggestion.id)}
                  aria-label={l(`Select suggestion ${index + 1}`, `Обрати пропозицію ${index + 1}`)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked ? [...current, suggestion.id] : current.filter((id) => id !== suggestion.id)
                    )
                  }
                />
                <span>
                  <strong>{suggestion.projectLabel || l('Choose a project', 'Оберіть проєкт')}</strong>
                  <small>
                    {time(suggestion.intervals[0].start)}–{time(suggestion.intervals.at(-1)!.end)} ·{' '}
                    {formatDuration(duration(suggestion))}
                  </small>
                </span>
              </label>
              <p>{suggestion.context.join(' · ')}</p>
              <small className="activity-match-reason">
                {suggestion.match === 'correction'
                  ? l('Your project correction', 'Ваше уточнення проєкту')
                  : suggestion.match === 'rule'
                    ? l('Remembered project rule', 'Збережене правило проєкту')
                    : suggestion.match === 'name'
                      ? l(
                          'Matching project name · review before recording',
                          'Збіг назви проєкту · перевірте перед збереженням'
                        )
                      : l('Project not matched yet', 'Проєкт ще не визначено')}
              </small>
              <button className="secondary-button" onClick={() => open([suggestion.id])}>
                {l('Review work entry', 'Переглянути робочий запис')}
              </button>
            </div>
          ))}
          {suggestions.length > limit && (
            <button className="secondary-button" onClick={() => setLimit((value) => value + 30)}>
              {l('Show more suggestions', 'Показати ще пропозиції')}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="activity-section-title">
            <strong>
              {l('Review work drafts', 'Перегляд робочих чернеток')} ({drafts.length})
            </strong>
            <button
              className="icon-button"
              aria-label={l('Discard work drafts', 'Відхилити робочі чернетки')}
              disabled={busy}
              onClick={() => {
                setDrafts([])
                setError('')
              }}
            >
              <X size={14} />
            </button>
          </div>
          {drafts.map((draft, index) => {
            const start = draft.intervals[0].start,
              end = draft.intervals.at(-1)!.end,
              split = splitAt[index] ?? Math.floor((start + end) / 120000) * 60000
            return (
              <div className="activity-work-draft" key={index}>
                <h4>
                  {l('Work entry', 'Робочий запис')} {index + 1} · {formatDuration(duration(draft))}
                </h4>
                <CustomSelect
                  value={draft.projectId ?? ''}
                  ariaLabel={l(`Draft project ${index + 1}`, `Проєкт чернетки ${index + 1}`)}
                  options={[
                    { value: '', label: l('No project', 'Без проєкту') },
                    ...snapshot.projects
                      .filter((p) => !p.archived)
                      .map((p) => ({ value: p.id, label: p.name, color: p.color }))
                  ]}
                  onChange={(value) => update(index, { projectId: value || null })}
                />
                <label>
                  {l('Work description', 'Опис роботи')}
                  <textarea
                    rows={2}
                    maxLength={2000}
                    disabled={busy}
                    aria-label={l(`Work description ${index + 1}`, `Опис роботи ${index + 1}`)}
                    placeholder={l('Describe what you actually worked on', 'Опишіть, над чим ви працювали')}
                    value={draft.notes}
                    onChange={(e) => update(index, { notes: e.target.value })}
                  />
                </label>
                <div className="activity-setting-grid">
                  <label>
                    {l('Trim start', 'Уточнити початок')}
                    <TimeInput
                      value={hm(start)}
                      ariaLabel={l(`Draft start ${index + 1}`, `Початок чернетки ${index + 1}`)}
                      onChange={(value) => edit(() => update(index, trimActivityDraft(draft, timestamp(value), end)))}
                    />
                  </label>
                  <label>
                    {l('Trim end', 'Уточнити кінець')}
                    <TimeInput
                      value={hm(end)}
                      ariaLabel={l(`Draft end ${index + 1}`, `Кінець чернетки ${index + 1}`)}
                      onChange={(value) =>
                        edit(() => update(index, trimActivityDraft(draft, start, timestamp(value, true))))
                      }
                    />
                  </label>
                </div>
                <details>
                  <summary>
                    {l('Exact observed ranges', 'Точні спостережені інтервали')} ({draft.intervals.length})
                  </summary>
                  {draft.intervals.map((range, i) => (
                    <p key={i}>
                      {time(range.start)}–{time(range.end)} · {formatDuration(range.end - range.start)}
                    </p>
                  ))}
                </details>
                <p>
                  {l(
                    'Original seconds are kept until you edit a boundary. Gaps between observations are never added to work time.',
                    'Початкові секунди зберігаються, доки ви не зміните межу. Прогалини між спостереженнями не додаються до робочого часу.'
                  )}
                </p>
                <div className="activity-draft-split">
                  <TimeInput
                    value={hm(split)}
                    ariaLabel={l(`Split draft at ${index + 1}`, `Час поділу чернетки ${index + 1}`)}
                    onChange={(value) => setSplitAt((current) => ({ ...current, [index]: timestamp(value) }))}
                  />
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      edit(() => {
                        const parts = splitActivityDraft(draft, split)
                        setDrafts((current) => current.flatMap((value, i) => (i === index ? parts : [value])))
                        setSplitAt({})
                      })
                    }
                  >
                    <Scissors size={12} />
                    {l('Split draft', 'Розділити чернетку')}
                  </button>
                </div>
                {drafts.length > 1 && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setDrafts((current) => current.filter((_, i) => i !== index))
                      setSplitAt({})
                    }}
                  >
                    {l('Discard this draft', 'Відхилити цю чернетку')}
                  </button>
                )}
              </div>
            )
          })}
          <div className="activity-tools">
            {drafts.length > 1 && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  edit(() => {
                    setDrafts([mergeActivityDrafts(drafts)])
                    setSplitAt({})
                  })
                }
              >
                <GitMerge size={12} />
                {l('Merge drafts', 'Об’єднати чернетки')}
              </button>
            )}
            <button
              className="primary-button"
              disabled={busy || drafts.some((d) => !d.notes.trim())}
              onClick={() => setConfirm(true)}
            >
              <Check size={13} />
              {l('Record reviewed work', 'Записати перевірену роботу')}
            </button>
          </div>
          <p>
            {l(
              'Records completed entries only after confirmation. Existing timers keep their state. If tracked time changes, refresh and review again.',
              'Завершені записи додаються лише після підтвердження. Стан наявних таймерів зберігається. Якщо облік часу зміниться, оновіть і перевірте ще раз.'
            )}
          </p>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        title={l('Record these completed work entries?', 'Записати ці завершені робочі записи?')}
        body={
          <>
            <p>
              {drafts.length} · {formatDuration(drafts.reduce((sum, d) => sum + duration(d), 0))}
            </p>
            {drafts.map((draft, i) => (
              <p key={i}>
                <b>{snapshot.projects.find((p) => p.id === draft.projectId)?.name || l('No project', 'Без проєкту')}</b>{' '}
                · {draft.notes}
              </p>
            ))}
          </>
        }
        confirmLabel={l('Record completed work', 'Записати завершену роботу')}
        cancelLabel={l('Back to review', 'Назад до перегляду')}
        busy={busy}
        error={error}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void commit()}
      />
    </section>
  )
}
