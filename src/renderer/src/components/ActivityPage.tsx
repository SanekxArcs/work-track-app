import { ActivityLearning } from './ActivityLearning'
import { ActivityWorkSuggestions } from './ActivityWorkSuggestions'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  Globe,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { motion } from 'motion/react'
import type { AppSnapshot } from '@shared/types'
import type { ActivityConfig, ActivityDay, ActivitySegment } from '@shared/activity'
import { activityReview } from '@shared/activity-review'
import { localDateKey, localDateTimestamp, localDaysBefore } from '@shared/local-date'
import { formatDuration } from '../lib/time'
import { CustomSelect } from './CustomSelect'
import { ConfirmDialog } from './ConfirmDialog'

type Preview = Awaited<ReturnType<Window['workBuddy']['previewActivityRecap']>>
export function ActivityPage({ snapshot, onSnapshot }: { snapshot: AppSnapshot; onSnapshot:(snapshot:AppSnapshot)=>void }): React.JSX.Element {
  const uk = snapshot.settings.locale === 'uk',
    l = (en: string, ua: string) => (uk ? ua : en)
  const [groupBy, setGroupBy] = useState<'app' | 'project'>('app')
  const [day, setDay] = useState(localDateKey(Date.now())),
    [data, setData] = useState<ActivityDay>(),
    [manual, setManual] = useState(snapshot)
  const [config, setConfig] = useState<ActivityConfig>(),
    [settingsOpen, setSettingsOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [writeKey, setWriteKey] = useState(''),
    [readKey, setReadKey] = useState(''),
    [limit, setLimit] = useState(60)
  const [editing, setEditing] = useState<ActivitySegment>(),
    [projectId, setProjectId] = useState(''),
    [note, setNote] = useState(''),
    [remember, setRemember] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false),
    [preview, setPreview] = useState<Preview>(),
    [summary, setSummary] = useState('')
  const generation = useRef(0),
    currentDay = useRef(day)
  currentDay.current = day
  const load = async (remote = false): Promise<void> => {
    const token = ++generation.current,
      requestedDay = day
    const [next, tasks] = await Promise.all([
      remote ? window.workBuddy.refreshActivity(day) : window.workBuddy.getActivityDay(day),
      window.workBuddy.getDaySnapshot(day)
    ])
    if (token !== generation.current || currentDay.current !== requestedDay) return
    setData(next)
    setManual(tasks)
    setConfig((value) => value ?? next.status.config)
  }
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setData(undefined)
    setLimit(60)
    setSummary('')
    setPreview(undefined)
    setEditing(undefined)
    void load().catch((e) => setError(String(e)))
    const local = setInterval(() => void load().catch((e) => setError(String(e))), 5000)
    const remote = setInterval(() => void load(true).catch((e) => setError(String(e))), 60000)
    void load(true).catch((e) => setError(String(e)))
    return () => {
      generation.current++
      clearInterval(local)
      clearInterval(remote)
    }
  }, [day])
  useEffect(() => setSummary(data?.recap?.summary ?? ''), [data?.recap?.generatedAt, day])
  const review = useMemo(
    () => (data ? activityReview(data, manual, data.assignments, data.rules) : undefined),
    [data, manual]
  )
  const shift = (offset: number) => setDay(localDateKey(localDaysBefore(localDateTimestamp(day), -offset)))
  const clock = (value: number) =>
    new Date(value).toLocaleTimeString(uk ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  const save = async (next: ActivityConfig): Promise<void> => {
    const result = await window.workBuddy.configureActivity(next, writeKey || undefined, readKey || undefined)
    setConfig(result.config)
    setWriteKey('')
    setReadKey('')
    setPreview(undefined)
    setSummary('')
    setNotice(l('Activity settings saved', 'Налаштування активності збережено'))
  }
  const exportDay = () => {
    if (!review) return
    const url = URL.createObjectURL(
        new Blob([JSON.stringify({ schemaVersion: 1, ...review }, null, 2)], { type: 'application/json' })
      ),
      a = document.createElement('a')
    a.href = url
    a.download = `work-buddy-activity-${day}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <motion.div
      className="page-stack activity-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <section className="activity-header">
        <div>
          <h2>{l('Your PC day', 'Ваш день за ПК')}</h2>
          <p>{l('Apps, browser visits and your tracked tasks.', 'Застосунки, сайти та ваші робочі завдання.')}</p>
        </div>
        <div className="activity-tools">
          <button
            className="icon-button"
            aria-label={l('Activity settings', 'Налаштування активності')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Settings2 size={16} />
          </button>
          <button
            className="icon-button"
            disabled={busy}
            aria-label={l('Refresh activity', 'Оновити активність')}
            onClick={() => void act(() => load(true))}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </section>
      <div className="activity-toolbar">
        <button className="icon-button" aria-label={l('Previous day', 'Попередній день')} onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label={l('Activity date', 'Дата активності')}
          type="date"
          value={day}
          max={localDateKey(Date.now())}
          onChange={(e) => {
            if (e.target.value) setDay(e.target.value)
          }}
        />
        <button
          className="icon-button"
          aria-label={l('Next day', 'Наступний день')}
          disabled={day >= localDateKey(Date.now())}
          onClick={() => shift(1)}
        >
          <ChevronRight size={16} />
        </button>
        <span className={`activity-state ${data?.status.config.enabled ? 'is-on' : ''}`}>
          <i />
          {data?.status.config.enabled ? l('Recording enabled', 'Запис увімкнено') : l('Paused', 'На паузі')}
        </span>
      </div>
      {data && (
        <div className="activity-recording">
          <span>
            {l('Windows recording', 'Запис Windows')}
            <small>
              {data.status.error ??
                {
                  Starting: l('Starting', 'Запуск'),
                  Recording: l('Recording', 'Запис'),
                  Idle: l('Idle', 'Бездіяльність'),
                  Locked: l('Locked', 'Заблоковано'),
                  Paused: l('Paused', 'Пауза'),
                  Sleeping: l('Sleeping', 'Сон'),
                  Excluded: l('Excluded', 'Виключено')
                }[data.status.state] ??
                data.status.state}
            </small>
          </span>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void act(() => save({ ...data.status.config, enabled: !data.status.config.enabled }))}
          >
            {data.status.config.enabled ? <Pause size={13} /> : <Play size={13} />}{' '}
            {data.status.config.enabled ? l('Pause', 'Пауза') : l('Start recording', 'Почати запис')}
          </button>
        </div>
      )}
      {data && <ActivityLearning key={day} data={data} snapshot={manual} reload={()=>load()}/>}
      {settingsOpen && config && (
        <section className="activity-card activity-preferences">
          <h3>{l('Recording & privacy', 'Запис і приватність')}</h3>
          <label className="activity-check">
            <input
              type="checkbox"
              checked={config.captureTitles}
              onChange={(e) => setConfig({ ...config, captureTitles: e.target.checked })}
            />
            {l('Include window titles', 'Зберігати заголовки вікон')}
          </label>
          <p>
            {l(
              'Records foreground app names. Titles are optional. No screenshots, keystrokes or page contents. Idle time may include reading or calls.',
              'Записує назви активних застосунків. Заголовки — за бажанням. Без знімків екрана, натискань клавіш і вмісту сторінок. Бездіяльність може включати читання чи дзвінки.'
            )}
          </p>
          <div className="activity-setting-grid">
            <label>
              {l('Idle after', 'Бездіяльність через')}
              <CustomSelect
                value={String(config.idleSeconds)}
                ariaLabel={l('Idle threshold', 'Поріг бездіяльності')}
                options={[30, 60, 120, 300, 600].map((v) => ({
                  value: String(v),
                  label: `${v} ${l('seconds', 'секунд')}`
                }))}
                onChange={(v) => setConfig({ ...config, idleSeconds: Number(v) })}
              />
            </label>
            <label>
              {l('Keep activity', 'Зберігати активність')}
              <CustomSelect
                value={String(config.retentionDays)}
                ariaLabel={l('Retention', 'Зберігання')}
                options={[7, 30, 90].map((v) => ({ value: String(v), label: `${v} ${l('days', 'днів')}` }))}
                onChange={(v) => setConfig({ ...config, retentionDays: Number(v) as 7 | 30 | 90 })}
              />
            </label>
          </div>
          <label>
            {l('Excluded apps · one per line', 'Виключені застосунки · по одному в рядку')}
            <textarea
              rows={2}
              placeholder="example.exe"
              value={config.excludedApps.join('\n')}
              onChange={(e) => setConfig({ ...config, excludedApps: e.target.value.split('\n') })}
            />
          </label>
          <label>
            {l('Exclude titles containing · one per line', 'Виключати заголовки зі словами · по одному в рядку')}
            <textarea
              rows={2}
              value={config.excludedTitlePatterns.join('\n')}
              onChange={(e) => setConfig({ ...config, excludedTitlePatterns: e.target.value.split('\n') })}
            />
          </label>
          <h3>
            <Cloud size={14} />
            {l('Browser & cloud connection', 'Зв’язок із браузером і хмарою')}
          </h3>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await window.workBuddy.importActivityConnection()
                if (result) {
                  setConfig(result.config)
                  setWriteKey('')
                  setReadKey('')
                  setNotice(
                    l(
                      'Connected. Import the same file in tabs-manager.',
                      'Підключено. Імпортуйте цей самий файл у tabs-manager.'
                    )
                  )
                }
              })
            }
          >
            {l('Import .env.workbuddy-sync', 'Імпортувати .env.workbuddy-sync')}
          </button>
          <label className="activity-check">
            <input
              type="checkbox"
              checked={config.cloudEnabled}
              onChange={(e) => setConfig({ ...config, cloudEnabled: e.target.checked })}
            />
            {l('Sync activity with Convex', 'Синхронізувати активність із Convex')}
          </label>
          <label>
            {l('Server URL', 'Адреса сервера')}
            <input
              value={config.siteUrl}
              placeholder="https://deployment.convex.site"
              onChange={(e) => setConfig({ ...config, siteUrl: e.target.value })}
            />
          </label>
          <label>
            {l('Paired PC ID · same in both apps', 'ID ПК · однаковий в обох застосунках')}
            <input value={config.deviceId} onChange={(e) => setConfig({ ...config, deviceId: e.target.value })} />
          </label>
          <div className="activity-setting-grid">
            <label>
              {l('Write key', 'Ключ запису')}
              <input
                type="password"
                autoComplete="off"
                value={writeKey}
                placeholder={data?.status.hasWriteKey ? l('Saved', 'Збережено') : ''}
                onChange={(e) => setWriteKey(e.target.value)}
              />
            </label>
            <label>
              {l('Read key', 'Ключ читання')}
              <input
                type="password"
                autoComplete="off"
                value={readKey}
                placeholder={data?.status.hasReadKey ? l('Saved', 'Збережено') : ''}
                onChange={(e) => setReadKey(e.target.value)}
              />
            </label>
          </div>
          <p>
            {l(
              'Settings affect future recording and the next cloud upload. Existing local titles are retained. Pausing stops capture; disabling sync leaves the last cloud copy. This personal connection shares access across your paired sources.',
              'Налаштування діють для нових записів і наступного завантаження в хмару. Наявні локальні заголовки зберігаються. Пауза зупиняє запис; вимкнення синхронізації залишає останню хмарну копію. Це персональне підключення дає доступ до ваших пов’язаних джерел.'
            )}
          </p>
          <button className="primary-button" disabled={busy} onClick={() => void act(() => save(config))}>
            {l('Save settings', 'Зберегти налаштування')}
          </button>
          {!!data?.rules.length && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void act(() => window.workBuddy.forgetActivityRules())}
            >
              {l('Clear remembered project rules', 'Очистити збережені правила проєктів')} ({data.rules.length})
            </button>
          )}
        </section>
      )}
      {(error || data?.status.syncError) && (
        <p className="form-error" role="status">
          {error || data?.status.syncError}
        </p>
      )}
      {notice && (
        <p className="settings-note" role="status">
          {notice}
        </p>
      )}
      {review && (
        <>
          <section className="activity-metrics">
            {[
              [l('Observed active', 'Спостережена активність'), review.report.activeMs],
              [l('Manual timers', 'Ручні таймери'), review.report.manualMs],
              [l('Outside timers', 'Поза таймерами'), review.report.untrackedMs],
              [l('Idle / locked', 'Бездіяльність / блокування'), review.report.idleMs]
            ].map(([label, ms]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{formatDuration(Number(ms))}</strong>
              </div>
            ))}
          </section>
          <p className="activity-caption">
            {l(
              'Browser detail enriches PC activity. Overlapping sources count once. Manual time is shown separately. Gaps mean no observation.',
              'Дані браузера доповнюють активність ПК. Накладення джерел рахуються один раз. Ручний час показано окремо. Прогалини означають відсутність спостережень.'
            )}
          </p>
          {!!review.report.groups.length && (
            <section className="activity-card activity-top">
              <h3>{l('Where your time went', 'Де минув ваш час')}</h3>
              <div className="activity-tools">
                <button className="secondary-button" aria-pressed={groupBy === 'app'} onClick={() => setGroupBy('app')}>
                  {l('Apps & sites', 'Застосунки й сайти')}
                </button>
                <button
                  className="secondary-button"
                  aria-pressed={groupBy === 'project'}
                  onClick={() => setGroupBy('project')}
                >
                  {l('Projects', 'Проєкти')}
                </button>
              </div>
              {(groupBy === 'app' ? review.report.groups : review.report.projects).slice(0, 8).map((group) => (
                <div key={group.label}>
                  <span>{group.label || l('Unassigned', 'Не призначено')}</span>
                  <b>{formatDuration(group.ms)}</b>
                  <i style={{ width: `${Math.max(1, (group.ms / review.report.activeMs) * 100)}%` }} />
                </div>
              ))}
            </section>
          )}
          <section className="activity-card">
            <div className="activity-section-title">
              <h3>{l('Daily review', 'Огляд дня')}</h3>
              <button
                className="icon-button"
                aria-label={l('Export daily evidence', 'Експортувати дані дня')}
                onClick={exportDay}
              >
                <Download size={14} />
              </button>
            </div>
            <p>
              {l(
                'Observed activity outside your timers can help reconstruct missing entries. Review evidence before assigning it to work.',
                'Активність поза таймерами допоможе відновити пропущені записи. Перегляньте дані, перш ніж відносити їх до роботи.'
              )}
            </p>
            <button
              className="secondary-button"
              disabled={
                busy || (!review.report.segments.length && !review.tasks.length) || !snapshot.settings.ai.enabled
              }
              onClick={() => void act(async () => setPreview(await window.workBuddy.previewActivityRecap(day)))}
            >
              <Sparkles size={14} />
              {l('Review data for AI recap', 'Переглянути дані для ШІ-підсумку')}
            </button>
            {!snapshot.settings.ai.enabled && (
              <p>
                {l(
                  'Enable AI in Settings to generate a combined recap. The timeline works without AI.',
                  'Увімкніть ШІ в налаштуваннях для спільного підсумку. Хронологія працює без ШІ.'
                )}
              </p>
            )}
            {(summary || data?.recap) && (
              <div className="activity-recap">
                {(summary || data?.recap?.summary || '').split(/(\[E\d+\])/g).map((part, index) => {
                  const ref = part.slice(1, -1)
                  return /^\[E\d+\]$/.test(part) && data?.recap?.evidence.some((e) => e.ref === ref) ? (
                    <button
                      key={index}
                      className="activity-evidence-link"
                      onClick={() => {
                        const node = document.getElementById('activity-recap-' + ref)
                        const details = node?.closest('details')
                        if (details) details.open = true
                        node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                      }}
                    >
                      {part}
                    </button>
                  ) : (
                    <span key={index}>{part}</span>
                  )
                })}
                {data?.recap && (
                  <details>
                    <summary>
                      {l('Evidence used for this recap', 'Дані, використані для цього підсумку')} ·{' '}
                      {clock(data.recap.through)}
                    </summary>
                    {data.recap.evidence.map((e) => (
                      <p key={e.ref} id={`activity-recap-${e.ref}`}>
                        <b>{e.ref}</b> {clock(e.start)}–{clock(e.end)} · {e.app} · {e.title || e.url || e.state}{' '}
                        {e.project}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            )}
          </section>
          {!!review.tasks.length && (
            <details className="activity-card">
              <summary>
                {l('Your tracked tasks', 'Ваші завдання з таймерами')} ({review.tasks.length})
              </summary>
              {review.tasks.map((task) => (
                <div className="activity-manual" key={task.id}>
                  <strong>{task.project || l('No project', 'Без проєкту')}</strong>
                  <span>{task.title}</span>
                  <small>{task.intervals.map((i) => `${clock(i.start)}–${clock(i.end)}`).join(', ')}</small>
                </div>
              ))}
            </details>
          )}
          {data&&<ActivityWorkSuggestions data={data} snapshot={manual} onRecorded={async result=>{onSnapshot(result);setSummary('');setPreview(undefined);await load()}}/>}
          <section className="activity-card activity-timeline">
            <div className="activity-section-title">
              <h3>{l('Evidence timeline', 'Хронологія спостережень')}</h3>
              <span>{review.report.segments.length}</span>
            </div>
            {!review.report.segments.length && (
              <div className="activity-empty">
                <Monitor size={26} />
                <strong>{l('No observations yet', 'Спостережень поки немає')}</strong>
                <p>
                  {l(
                    'Start Windows recording above. In tabs-manager, enable activity tracking and import the same Work Buddy connection file.',
                    'Увімкніть запис Windows вище. У tabs-manager увімкніть облік активності та імпортуйте той самий файл підключення Work Buddy.'
                  )}
                </p>
              </div>
            )}
            {review.report.segments.slice(0, limit).map((segment, index) => {
              const r = segment.record,
                tasks = review.tasks.filter((task) =>
                  task.intervals.some((i) => i.start < segment.end && i.end > segment.start)
                )
              return (
                <button
                  className={`activity-row ${segment.state !== 'active' ? 'is-idle' : ''}`}
                  key={`${r.id}-${segment.start}`}
                  onClick={() => {
                    setEditing(segment)
                    const saved = data!.assignments.find((a) => a.recordId === r.id)
                    setProjectId(saved?.projectId ?? '')
                    setNote(saved?.note ?? '')
                    setRemember(false)
                  }}
                >
                  <span className="activity-row-icon">
                    {r.kind === 'browser' ? <Globe size={15} /> : <Monitor size={15} />}
                  </span>
                  <span className="activity-row-body">
                    <small>
                      <b>E{index + 1}</b> {clock(segment.start)}–{clock(segment.end)} ·{' '}
                      {formatDuration(segment.end - segment.start)}
                    </small>
                    <strong>
                      {segment.state === 'idle'
                        ? l('Idle', 'Бездіяльність')
                        : segment.state === 'locked'
                          ? l('PC locked', 'ПК заблоковано')
                          : r.kind === 'browser'
                            ? r.title || r.domain
                            : r.title || r.app}
                    </strong>
                    <span>{[r.app, r.domain, r.projectName].filter(Boolean).join(' · ')}</span>
                    {r.url && <span className="activity-url">{r.url}</span>}
                    {tasks.length > 0 && (
                      <span className="activity-task-match">
                        {l('Timer', 'Таймер')}: {tasks.map((t) => t.project || t.title).join(', ')}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
            {review.report.segments.length > limit && (
              <button className="secondary-button" onClick={() => setLimit((v) => v + 100)}>
                {l('Show more', 'Показати ще')}
              </button>
            )}
          </section>
          {data && data.assignments.some((a) => a.excluded && data.records.some((r) => r.id === a.recordId)) && (
            <details className="activity-card">
              <summary>{l('Excluded observations', 'Виключені спостереження')}</summary>
              {data.assignments
                .filter((a) => a.excluded && data.records.some((r) => r.id === a.recordId))
                .map((a) => (
                  <div className="activity-manual" key={a.recordId}>
                    <span>
                      {data.records.find((r) => r.id === a.recordId)?.title ||
                        data.records.find((r) => r.id === a.recordId)?.app}
                    </span>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void act(() => window.workBuddy.assignActivity({ ...a, excluded: false }))}
                    >
                      {l('Restore to review', 'Повернути до огляду')}
                    </button>
                  </div>
                ))}
            </details>
          )}
          <div className="activity-footer">
            <small>
              {data?.status.config.cloudEnabled
                ? `${l('Cloud fetched', 'Отримано з хмари')}: ${data.cloudFetchedAt ? new Date(data.cloudFetchedAt).toLocaleString() : '—'} · ${data.status.pendingDays} ${l('days queued', 'днів у черзі')}`
                : l('Stored locally · cloud sync off', 'Локальне зберігання · хмарну синхронізацію вимкнено')}
            </small>
            <button
              className="icon-button"
              aria-label={l('Delete desktop observations for this day', 'Видалити спостереження Windows за цей день')}
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </>
      )}
      {editing && (
        <section className="activity-editor activity-card" aria-label={l('Correct activity', 'Уточнити активність')}>
          <div className="activity-section-title">
            <h3>{l('Correct this observation', 'Уточнити це спостереження')}</h3>
            <button
              className="icon-button"
              aria-label={l('Close editor', 'Закрити редактор')}
              onClick={() => setEditing(undefined)}
            >
              <X size={15} />
            </button>
          </div>
          <p>{editing.record.title || editing.record.domain || editing.record.app}</p>
          <CustomSelect
            value={projectId}
            ariaLabel={l('Work Buddy project', 'Проєкт Work Buddy')}
            options={[
              { value: '', label: l('Keep source project', 'Залишити проєкт джерела') },
              ...snapshot.projects
                .filter((p) => !p.archived)
                .map((p) => ({ value: p.id, label: p.name, color: p.color }))
            ]}
            onChange={setProjectId}
          />
          <textarea
            rows={2}
            aria-label={l('Activity note', 'Нотатка активності')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="activity-check">
            <input
              type="checkbox"
              checked={remember}
              disabled={!projectId}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {l(
              'Remember this project for this app or browser project/domain',
              'Запам’ятати проєкт для цього застосунку або проєкту/домену браузера'
            )}
          </label>
          <p>
            {l(
              'Corrections stay in this daily review. Your task timers are unchanged.',
              'Уточнення залишаються в огляді дня. Таймери завдань не змінюються.'
            )}
          </p>
          <div className="activity-tools">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await window.workBuddy.assignActivity({
                    recordId: editing.record.id,
                    projectId: projectId || null,
                    excluded: false,
                    note
                  })
                  if (remember && projectId) {
                    const r = editing.record
                    await window.workBuddy.rememberActivityProject(
                      r.browserProjectId
                        ? { kind: 'browserProject', pattern: r.browserProjectId, projectId }
                        : r.domain
                          ? { kind: 'domain', pattern: r.domain, projectId }
                          : { kind: 'app', pattern: r.app.toLowerCase(), projectId }
                    )
                  }
                  setEditing(undefined)
                  setPreview(undefined)
                  setSummary('')
                })
              }
            >
              {l('Save correction', 'Зберегти уточнення')}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await window.workBuddy.assignActivity({
                    recordId: editing.record.id,
                    projectId: projectId || null,
                    excluded: true,
                    note
                  })
                  setEditing(undefined)
                  setPreview(undefined)
                  setSummary('')
                })
              }
            >
              {l('Exclude from review', 'Виключити з огляду')}
            </button>
          </div>
        </section>
      )}
      {preview && (
        <section className="activity-card activity-preview">
          <div className="activity-section-title">
            <h3>{l('Review before sending to AI', 'Перегляд перед надсиланням до ШІ')}</h3>
            <button
              className="icon-button"
              aria-label={l('Close preview', 'Закрити перегляд')}
              onClick={() => setPreview(undefined)}
            >
              <X size={15} />
            </button>
          </div>
          <p>
            {l(
              'This exact snapshot will be sent to your configured Gemini model: app names, recorded titles, cleaned URLs, project labels and manual task notes.',
              'Саме цей знімок буде надіслано вашій моделі Gemini: назви застосунків, записані заголовки, очищені URL, назви проєктів і ручні нотатки завдань.'
            )}
          </p>
          <p>
            {day} · {preview.review.evidence.length} {l('observations', 'спостережень')} · {l('through', 'до')}{' '}
            {clock(preview.review.through)} · {preview.review.omittedSegments} {l('omitted', 'пропущено')}
          </p>
          <details>
            <summary>{l('Inspect exact data', 'Переглянути точні дані')}</summary>
            <pre>
              {JSON.stringify(
                {
                  day: preview.review.day,
                  through: preview.review.through,
                  tasks: preview.review.tasks,
                  evidence: preview.review.evidence,
                  omittedSegments: preview.review.omittedSegments,
                  totals: {
                    activeMs: preview.review.report.activeMs,
                    idleMs: preview.review.report.idleMs,
                    browserMs: preview.review.report.browserMs,
                    manualMs: preview.review.report.manualMs,
                    untrackedMs: preview.review.report.untrackedMs
                  }
                },
                null,
                2
              )}
            </pre>
          </details>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await window.workBuddy.generateActivityRecap(preview.id)
                setSummary(result.summary)
                setPreview(undefined)
              })
            }
          >
            <Sparkles size={14} />
            {busy ? l('Generating…', 'Створення…') : l('Send and generate recap', 'Надіслати та створити підсумок')}
          </button>
        </section>
      )}
      <ConfirmDialog
        open={deleteOpen}
        title={l('Delete Windows activity for this day?', 'Видалити активність Windows за цей день?')}
        body={l(
          'Removes this PC’s desktop observations locally and queues an empty cloud replacement. Browser observations must be deleted in tabs-manager. Manual work entries are preserved.',
          'Видаляє локальні спостереження Windows цього ПК та ставить у чергу очищення хмарної копії. Дані браузера видаляються в tabs-manager. Ручні робочі записи зберігаються.'
        )}
        confirmLabel={l('Delete observations', 'Видалити спостереження')}
        cancelLabel={l('Cancel', 'Скасувати')}
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          void act(async () => {
            await window.workBuddy.deleteActivityDay(day)
            setDeleteOpen(false)
            setPreview(undefined)
            setSummary('')
          })
        }
      />
    </motion.div>
  )
}
