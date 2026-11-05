import { useEffect, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AppSnapshot, WeekReport } from '@shared/types'
import { localDateKey, localDateTimestamp, localDaysBefore } from '@shared/local-date'
import type { Translator } from '../lib/i18n'
import { formatDuration } from '../lib/time'
import { SettingsSection as FoldCard } from './SettingsSection'

interface WeekSummaryProps {
  snapshot: AppSnapshot
  now: number
  t: Translator
}

/** Monday of the week the timestamp falls in, at noon so daylight-saving shifts cannot move the date. */
function mondayOf(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(12, 0, 0, 0)
  return localDaysBefore(date.getTime(), (date.getDay() + 6) % 7)
}

function shortDate(value: string, locale: 'uk' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'short' }).format(localDateTimestamp(value))
}

function weekday(value: string, locale: 'uk' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { weekday: 'short' }).format(localDateTimestamp(value))
}

function hm(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : `${minutes}m`
}

/** Hours for one Monday-to-Sunday week, by day and by project, with the trend against the week before. */
export function WeekSummary({ snapshot, now, t }: WeekSummaryProps): React.JSX.Element {
  const [weeksBack, setWeeksBack] = useState(0)
  const weekStart = localDateKey(localDaysBefore(mondayOf(now), weeksBack * 7))
  const weekEnd = localDateKey(localDaysBefore(localDateTimestamp(weekStart), -6))
  const todayKey = localDateKey(now)
  const [report, setReport] = useState<WeekReport | null>(null)

  useEffect(() => {
    let live = true
    void window.workBuddy.getWeekReport(weekStart).then((result) => { if (live) setReport(result) }).catch(() => undefined)
    return () => { live = false }
  }, [weekStart, snapshot])

  const shown = report?.weekStart === weekStart ? report : null
  const maxDayMs = shown ? Math.max(60_000, ...shown.days.map((day) => day.workedMs + day.overtimeMs)) : 1
  const maxProjectMs = shown ? Math.max(1, ...shown.projects.map((entry) => entry.ms)) : 1
  const trend = shown && shown.previousTotalMs > 0 ? (shown.totalMs - shown.previousTotalMs) / shown.previousTotalMs : null
  const locale = t.locale

  return (
    <FoldCard id="day:week" icon={<BarChart3 size={17} />} title={t('weekReport')} body={t('weekReportBody')} className="week-report">
      <nav className="week-nav">
        <button type="button" onClick={() => setWeeksBack((value) => value + 1)} title={t('prevWeek')} aria-label={t('prevWeek')}><ChevronLeft size={15} /></button>
        <strong>{shortDate(weekStart, locale)} — {shortDate(weekEnd, locale)}</strong>
        {weeksBack > 0 ? <button type="button" className="week-nav__today" onClick={() => setWeeksBack(0)}>{t('thisWeek')}</button> : <span />}
        <button type="button" disabled={weeksBack === 0} onClick={() => setWeeksBack((value) => Math.max(0, value - 1))} title={t('nextWeek')} aria-label={t('nextWeek')}><ChevronRight size={15} /></button>
      </nav>
      {shown && shown.totalMs === 0 && <p className="week-empty">{t('weekEmpty')}</p>}
      {shown && shown.totalMs > 0 && <>
        <div className="week-totals">
          <div><small>{t('weekTotal')}</small><strong>{formatDuration(shown.totalMs, true, locale)}</strong>{trend !== null && <em className={trend >= 0 ? 'up' : 'down'}>{trend >= 0 ? '+' : ''}{Math.round(trend * 100)}%</em>}</div>
          <div><small>{t('weekPrevious')}</small><strong>{formatDuration(shown.previousTotalMs, true, locale)}</strong></div>
        </div>
        <div className="week-bars" role="img" aria-label={`${t('weekTotal')}: ${formatDuration(shown.totalMs, true, locale)}`}>
          {shown.days.map((day) => (
            <div key={day.date} className={`week-bar ${day.date === todayKey ? 'is-today' : ''}`} title={`${shortDate(day.date, locale)} · ${formatDuration(day.workedMs, true, locale)}${day.overtimeMs ? ` · +${formatDuration(day.overtimeMs, true, locale)}` : ''}`}>
              <div className="week-bar__track">
                <span style={{ height: `${(day.workedMs / maxDayMs) * 100}%` }} />
                {day.overtimeMs > 0 && <i style={{ height: `${(day.overtimeMs / maxDayMs) * 100}%` }} />}
              </div>
              <small>{weekday(day.date, locale)}</small>
              <b>{day.workedMs > 0 ? hm(day.workedMs) : ''}</b>
            </div>
          ))}
        </div>
        <div className="week-meta">
          <span>{t('weekBreaks')} <b>{formatDuration(shown.breakMs, true, locale)}</b></span>
          <span>{t('weekLunch')} <b>{formatDuration(shown.lunchMs, true, locale)}</b></span>
          <span>{t('weekOvertime')} <b>{shown.overtimeMs > 0 ? '+' : ''}{formatDuration(shown.overtimeMs, true, locale)}</b></span>
        </div>
        {shown.projects.length > 0 && <div className="week-projects">
          {shown.projects.slice(0, 6).map((entry) => {
            const project = snapshot.projects.find((item) => item.id === entry.projectId)
            const color = project?.color ?? '#b8e986'
            return <div key={entry.projectId ?? 'none'} className="week-project">
              <span className="week-project__label"><i style={{ background: color }} />{project?.name ?? t('noProject')}</span>
              <span className="week-project__bar"><span style={{ width: `${(entry.ms / maxProjectMs) * 100}%`, background: color }} /></span>
              <b>{formatDuration(entry.ms, true, locale)}</b>
            </div>
          })}
        </div>}
      </>}
    </FoldCard>
  )
}
