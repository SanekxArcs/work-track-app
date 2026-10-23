import { useEffect, useState } from 'react'
import type { ActivityDay } from '@shared/activity'
import type { AppSnapshot } from '@shared/types'
import type {
  ActivityRule,
  ActivityProjectRegistry,
  ActivityLearningResponse
} from '@shared/activity-learning'
import { activitySuggestions } from '@shared/activity-drafts'
import { CustomSelect } from './CustomSelect'
export function ActivityLearning({
  data,
  snapshot,
  reload
}: {
  data: ActivityDay
  snapshot: AppSnapshot
  reload: () => Promise<void>
}): React.JSX.Element {
  const uk = snapshot.settings.locale === 'uk',
    l = (en: string, ua: string) => (uk ? ua : en)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [registry, setRegistry] = useState<ActivityProjectRegistry>(),
    [rule, setRule] = useState<ActivityRule>(),
    [note, setNote] = useState(data.dailyNote ?? ''),
    [preview, setPreview] = useState<ActivityLearningResponse['preview']>(),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [remember, setRemember] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setNote(data.dailyNote ?? '')
    setPreview(undefined)
    setChoices({})
    setRemember({})
  }, [data.day])
  const projects = snapshot.projects
      .filter((p) => !p.archived)
      .map((p) => ({ value: p.id, label: p.name, color: p.color })),
    options = [
      { value: '', label: l('Choose a project', 'Оберіть проєкт') },
      ...projects
    ]
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const call = window.workBuddy.activityLearning
  const currentSuggestions = activitySuggestions(data, snapshot)
  const ambiguous = currentSuggestions.filter((s) =>
    ['name', 'unassigned', 'conflict'].includes(s.match)
  ).length
  return (
    <>
      <section className="activity-card activity-learning">
        <h3>{l('End-of-day review', 'Підсумок дня')}</h3>
        <p>
          {l(
            'Review activity, resolve projects, recover missing work, then generate your recap below.',
            'Перевірте активність, уточніть проєкти, додайте пропущену роботу та створіть підсумок нижче.'
          )}
        </p>
        <p>
          {ambiguous}{' '}
          {l(
            'periods with uncertain project matches',
            'періодів із невизначеним проєктом'
          )}
        </p>
        <label>
          {l('Your daily notes', 'Ваші нотатки за день')}
          <textarea
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={l(
              'Context, meetings, outcomes, or things the activity log cannot explain…',
              'Контекст, зустрічі, результати або те, чого немає в журналі…'
            )}
          />
        </label>
        <div className="activity-tools">
          <button
            className="secondary-button"
            disabled={busy || note === (data.dailyNote ?? '')}
            onClick={() =>
              void run(() => call('note', { day: data.day, note }))
            }
          >
            {l('Save notes', 'Зберегти нотатки')}
          </button>
          <button
            className="secondary-button"
            disabled={
              busy ||
              data.reviewStatus?.current ||
              note !== (data.dailyNote ?? '')
            }
            onClick={() => void run(() => call('complete', { day: data.day }))}
          >
            {data.reviewStatus?.current
              ? l('Day reviewed', 'День перевірено')
              : l('Mark day reviewed', 'Позначити день перевіреним')}
          </button>
        </div>
        {data.reviewStatus?.reviewedAt && !data.reviewStatus.current && (
          <p>
            {l(
              'New activity or edits since your last review.',
              'Після останньої перевірки з’явилась нова активність або зміни.'
            )}
          </p>
        )}
      </section>
      <section className="activity-card activity-learning">
        <h3>{l('AI project matching', 'Зіставлення проєктів із ШІ')}</h3>
        <p>
          {l(
            'Preview ambiguous periods before sending them to Gemini. Suggestions require confirmation; time entries are created only in the work review below.',
            'Перегляньте невизначені періоди перед надсиланням Gemini. Пропозиції потребують підтвердження; записи часу створюються лише під час перевірки роботи нижче.'
          )}
        </p>
        <button
          className="secondary-button"
          disabled={busy || !ambiguous || !snapshot.settings.ai.enabled}
          onClick={() =>
            void run(async () => {
              const result = await call('preview', { day: data.day })
              setPreview(result.preview)
            })
          }
        >
          {l('Preview matching input', 'Переглянути дані для зіставлення')}
        </button>
        {!snapshot.settings.ai.enabled && (
          <p>
            {l(
              'Enable AI and add your Gemini key in Settings.',
              'Увімкніть ШІ та додайте ключ Gemini в налаштуваннях.'
            )}
          </p>
        )}
        {preview && (
          <div className="activity-evidence">
            <p>
              {l(
                'Exact data to send. Includes saved daily notes, project labels, manual entries and selected activity evidence.',
                'Точні дані для надсилання: збережені нотатки, назви проєктів, ручні записи та вибрана активність.'
              )}
            </p>
            <pre>{JSON.stringify(preview.input, null, 2)}</pre>
            <div className="activity-tools">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await call('generate', { day: data.day, id: preview.id })
                    setPreview(undefined)
                  })
                }
              >
                {l('Send to Gemini and match', 'Надіслати Gemini та зіставити')}
              </button>
              <button
                className="secondary-button"
                onClick={() => setPreview(undefined)}
              >
                {l('Cancel', 'Скасувати')}
              </button>
            </div>
          </div>
        )}
        {data.matching?.proposals.map((p) => {
          const period = data.matching!.input.periods.find(
              (v) => v.id === p.periodId
            )!,
            confirmed = currentSuggestions.some(
              (s) => s.id === p.periodId && s.match === 'confirmed'
            ),
            chosen = choices[p.periodId] ?? p.projectId ?? ''
          const evidence = period.evidence,
            first = evidence[0]
          const learned: ActivityRule | undefined =
            first &&
            evidence.every(
              (e) =>
                e.browserProjectId &&
                e.browserProjectId === first.browserProjectId &&
                e.sourceId === first.sourceId
            )
              ? {
                  kind: 'browserProject',
                  pattern: first.browserProjectId!,
                  sourceId: first.sourceId,
                  projectId: chosen
                }
              : first?.domain &&
                  evidence.every((e) => e.domain === first.domain)
                ? { kind: 'domain', pattern: first.domain, projectId: chosen }
                : first &&
                    evidence.every((e) => e.app === first.app && !e.domain)
                  ? { kind: 'app', pattern: first.app, projectId: chosen }
                  : undefined
          return (
            <article className="activity-learning-proposal" key={p.periodId}>
              <strong>{period.context.join(' · ')}</strong>
              <small>
                {new Date(period.intervals[0].start).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}{' '}
                –{' '}
                {new Date(period.intervals.at(-1)!.end).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </small>
              <p>{p.reason}</p>
              <small>
                {l('AI confidence estimate', 'Оцінка впевненості ШІ')}:{' '}
                {uk
                  ? { low: 'низька', medium: 'середня', high: 'висока' }[
                      p.confidence
                    ]
                  : p.confidence}
              </small>
              <details>
                <summary>
                  {l('Supporting evidence', 'Джерела')} (
                  {p.evidenceRefs.join(', ')})
                </summary>
                {evidence.map((e) => (
                  <p key={e.ref}>
                    <strong>{e.ref}</strong> {e.app} · {e.title}
                    <br />
                    {e.url}
                    {e.note && (
                      <>
                        <br />
                        {e.note}
                      </>
                    )}
                  </p>
                ))}
              </details>
              {confirmed ? (
                <strong>
                  {l(
                    'Confirmed for work review',
                    'Підтверджено для перевірки роботи'
                  )}
                </strong>
              ) : (
                <>
                  <CustomSelect
                    ariaLabel={l('Suggested project', 'Запропонований проєкт')}
                    value={chosen}
                    options={options}
                    onChange={(v) =>
                      setChoices({ ...choices, [p.periodId]: v })
                    }
                  />
                  {learned && (
                    <label className="activity-check">
                      <input
                        type="checkbox"
                        checked={!!remember[p.periodId]}
                        onChange={(e) =>
                          setRemember({
                            ...remember,
                            [p.periodId]: e.target.checked
                          })
                        }
                      />
                      {l(
                        'Also remember locally for',
                        'Також запам’ятати локально для'
                      )}
                      : {learned.pattern}
                    </label>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy || !chosen}
                    onClick={() =>
                      void run(async () => {
                        await call('confirm', {
                          day: data.day,
                          resultId: data.matching!.id,
                          periodId: p.periodId,
                          projectId: chosen
                        })
                        if (remember[p.periodId] && learned)
                          await window.workBuddy.rememberActivityProject(
                            learned
                          )
                      })
                    }
                  >
                    {l(
                      'Confirm project for this period',
                      'Підтвердити проєкт для цього періоду'
                    )}
                  </button>
                </>
              )}
            </article>
          )
        })}
      </section>
      <details className="activity-card activity-learning">
        <summary>
          {l(
            'Project links & learned rules',
            'Зв’язки проєктів і вивчені правила'
          )}
        </summary>
        <h3>
          {l(
            'Shared browser project links',
            'Спільні зв’язки браузерних проєктів'
          )}
        </h3>
        <p>
          {l(
            'Links use stable IDs and are shared with Tabs Manager. Folder renames keep the same link. Refresh after changing a link in either app.',
            'Зв’язки використовують сталі ID та спільні з Tabs Manager. Перейменування папки зберігає зв’язок. Оновіть після зміни зв’язку в іншому застосунку.'
          )}
        </p>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await call('projects')
              setRegistry(r.registry)
            })
          }
        >
          {l('Refresh shared projects', 'Оновити спільні проєкти')}
        </button>
        {registry?.error && <p role="alert">{registry.error}</p>}
        {registry && !registry.browserProjects.length && (
          <p>
            {l(
              'Sync Tabs Manager first to publish its folder labels.',
              'Спочатку синхронізуйте Tabs Manager, щоб надіслати назви папок.'
            )}
          </p>
        )}
        {registry?.browserProjects
          .filter((p) => !p.archived)
          .map((p) => {
            const link = registry.links.find(
              (v) =>
                v.browserSourceId === p.sourceId && v.browserProjectId === p.id
            )
            return (
              <div
                key={p.sourceId + p.id}
                className="activity-learning-proposal"
              >
                <label>
                  {p.name}
                  <small>
                    {l('Browser profile', 'Профіль браузера')}:{' '}
                    {p.sourceId.slice(0, 8)}
                  </small>
                </label>
                <CustomSelect
                  ariaLabel={
                    l('Work Buddy project for ', 'Проєкт Work Buddy для ') +
                    p.name
                  }
                  value={link?.projectId ?? ''}
                  options={[
                    {
                      value: '',
                      label: l('No shared link', 'Без спільного зв’язку')
                    },
                    ...projects
                  ]}
                  onChange={(projectId) => {
                    if (!busy)
                      void run(async () => {
                        const result = await call('link', {
                          browserSourceId: p.sourceId,
                          browserProjectId: p.id,
                          projectId: projectId || null,
                          expectedRevision: link?.revision ?? 0
                        })
                        setRegistry(result.registry)
                      })
                  }}
                />
              </div>
            )
          })}
        <h3>{l('Local matching rules', 'Локальні правила зіставлення')}</h3>
        <p>
          {l(
            'Domain rules include subdomains. Window title rules match text anywhere; an app restriction is optional. Conflicting rules need review.',
            'Правила доменів включають піддомени. Заголовок містить вказаний текст; обмеження застосунком необов’язкове. Конфліктні правила потребують перевірки.'
          )}
        </p>
        {data.rules.map((r) => (
          <div
            key={r.id ?? r.kind + r.pattern}
            className="activity-learning-proposal"
          >
            <strong>{r.pattern}</strong>
            <small>
              {
                {
                  domain: l('Domain', 'Домен'),
                  app: l('App', 'Застосунок'),
                  windowTitle: l('Window title', 'Заголовок вікна'),
                  browserProject: l('Browser project', 'Браузерний проєкт')
                }[r.kind]
              }{' '}
              ·{' '}
              {snapshot.projects.find((p) => p.id === r.projectId)?.name ??
                l('Removed project', 'Видалений проєкт')}
              {r.app ? ' · ' + r.app : ''}
            </small>
            <div className="activity-tools">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setRule({ ...r })}
              >
                {l('Edit', 'Редагувати')}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    call('saveRule', { ...r, enabled: r.enabled === false })
                  )
                }
              >
                {r.enabled === false
                  ? l('Enable', 'Увімкнути')
                  : l('Disable', 'Вимкнути')}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void run(() => call('deleteRule', { id: r.id }))}
              >
                {l('Delete', 'Видалити')}
              </button>
            </div>
          </div>
        ))}
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            setRule({ kind: 'domain', pattern: '', projectId: '' })
          }
        >
          {l('Add rule', 'Додати правило')}
        </button>
        {rule && (
          <div className="activity-learning-proposal">
            <CustomSelect
              ariaLabel={l('Rule type', 'Тип правила')}
              value={rule.kind}
              options={[
                { value: 'domain', label: l('Website domain', 'Домен сайту') },
                { value: 'app', label: l('Windows app', 'Застосунок Windows') },
                {
                  value: 'windowTitle',
                  label: l('Window title contains', 'Заголовок вікна містить')
                },
                {
                  value: 'browserProject',
                  label: l('Browser project ID', 'ID браузерного проєкту')
                }
              ]}
              onChange={(kind) =>
                setRule({ ...rule, kind: kind as ActivityRule['kind'] })
              }
            />
            <input
              aria-label={l('Matching text', 'Текст для зіставлення')}
              value={rule.pattern}
              placeholder={
                rule.kind === 'domain'
                  ? 'example.com'
                  : rule.kind === 'app'
                    ? 'code.exe'
                    : l('Matching text', 'Текст для зіставлення')
              }
              onChange={(e) => setRule({ ...rule, pattern: e.target.value })}
            />
            {rule.kind === 'windowTitle' && (
              <input
                aria-label={l(
                  'Optional app restriction',
                  'Необов’язкове обмеження застосунком'
                )}
                placeholder={l(
                  'Optional app, e.g. code.exe',
                  'Необов’язково: застосунок, напр. code.exe'
                )}
                value={rule.app ?? ''}
                onChange={(e) => setRule({ ...rule, app: e.target.value })}
              />
            )}
            <CustomSelect
              ariaLabel={l('Rule project', 'Проєкт правила')}
              value={rule.projectId}
              options={options}
              onChange={(projectId) => setRule({ ...rule, projectId })}
            />
            <div className="activity-tools">
              <button
                className="primary-button"
                disabled={busy || !rule.pattern.trim() || !rule.projectId}
                onClick={() =>
                  void run(async () => {
                    await call('saveRule', rule)
                    setRule(undefined)
                  })
                }
              >
                {l('Save rule', 'Зберегти правило')}
              </button>
              <button
                className="secondary-button"
                onClick={() => setRule(undefined)}
              >
                {l('Cancel', 'Скасувати')}
              </button>
            </div>
          </div>
        )}
      </details>
      {error && (
        <p role="alert" className="activity-error">
          {error}
        </p>
      )}
    </>
  )
}
