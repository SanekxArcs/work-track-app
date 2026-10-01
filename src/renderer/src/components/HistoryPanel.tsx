import { useState } from 'react'
import { motion } from 'motion/react'
import { CalendarDays } from 'lucide-react'
import type { HistoryDay, OvertimeDay } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { formatDuration } from '../lib/time'
import { ease } from './Animated'

interface HistoryPanelProps {
  days: HistoryDay[]
  overtimeDays: OvertimeDay[]
  selectedDate: string
  locale: 'uk' | 'en'
  t: Translator
  onSelect: (date: string) => void
}

function labelForDate(value: string, locale: 'uk' | 'en'): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day, 12))
}

function level(milliseconds: number): number {
  if (!milliseconds) return 0
  if (milliseconds < 30 * 60_000) return 1
  if (milliseconds < 2 * 60 * 60_000) return 2
  if (milliseconds < 4 * 60 * 60_000) return 3
  return 4
}

const RANGES = [30, 60, 90, 180, 365] as const
type Range = (typeof RANGES)[number]

function storedRange(): Range {
  try {
    const value = Number(window.localStorage.getItem('workBuddyHistoryRange'))
    return (RANGES as readonly number[]).includes(value) ? value as Range : 180
  } catch {
    return 180
  }
}

/** Monday = 0 … Sunday = 6 */
function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return (new Date(year, month - 1, day, 12).getDay() + 6) % 7
}

export function HistoryPanel({ days, overtimeDays, selectedDate, locale, t, onSelect }: HistoryPanelProps): React.JSX.Element {
  const [range, setRange] = useState<Range>(storedRange)
  const visibleDays = days.slice(-range)
  // Rows are weekdays with Monday on top, so pad the first column up to the first day's weekday.
  const leadingBlanks = visibleDays.length ? weekdayIndex(visibleDays[0].date) : 0
  const columns = Math.ceil((leadingBlanks + visibleDays.length) / 7)
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { weekday: 'short' }).format(new Date(2024, 0, 1 + index, 12)))
  const chooseRange = (next: Range): void => {
    setRange(next)
    try { window.localStorage.setItem('workBuddyHistoryRange', String(next)) } catch { /* the choice just is not remembered */ }
  }
  const recentDays = [...days].reverse().filter((day) => day.workedMs > 0).slice(0, 6)
  const unredeemedOvertime = new Map(overtimeDays.filter((day) => !day.redeemed && day.overtimeMs > 0).map((day) => [day.date, day.overtimeMs]))

  return <section className="panel history-panel">
    <div className="section-heading"><div><span className="eyebrow">{t('historyEyebrow')}</span><h3>{t('workHistory')}</h3></div><CalendarDays size={16} /></div>
    <p>{t('workHistoryBody')}</p>
    <div className="history-range" role="group" aria-label={t('historyRange')}>
      {RANGES.map((item) => <button key={item} type="button" className={range === item ? 'active' : ''} onClick={() => chooseRange(item)}>{item}</button>)}
    </div>
    <motion.div key={range} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }} className="history-heatmap" aria-label={t('workHistory')} style={{ gridTemplateColumns: `auto repeat(${columns}, minmax(0, 1fr))` }}>
      {weekdayLabels.map((label, index) => <span key={label} className="history-weekday">{label}</span>)}
      {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} className="history-cell history-cell--blank" aria-hidden="true" />)}
      {visibleDays.map((day) => {
        const overtimeMs = unredeemedOvertime.get(day.date)
        const overtimeLabel = overtimeMs ? ` · +${formatDuration(overtimeMs, true)} · ${t('unredeemedOvertime')}` : ''
        return <button key={day.date} className={`history-cell history-cell--${level(day.workedMs)} ${overtimeMs ? 'history-cell--overtime' : ''} ${selectedDate === day.date ? 'selected' : ''}`} onClick={() => onSelect(day.date)} title={`${labelForDate(day.date, locale)} · ${formatDuration(day.workedMs, true)}${overtimeLabel}`} aria-label={`${labelForDate(day.date, locale)}: ${formatDuration(day.workedMs, true)}${overtimeLabel}`}>{overtimeMs && <i className="history-cell__overtime" aria-hidden="true" />}</button>
      })}
    </motion.div>
    <div className="history-legend"><span>{t('less')}</span><i className="history-cell--0" /><i className="history-cell--1" /><i className="history-cell--2" /><i className="history-cell--3" /><i className="history-cell--4" /><span>{t('more')}</span><span className="history-overtime-legend"><i />{t('unredeemedOvertime')}</span></div>
    {recentDays.length > 0 && <div className="history-recent">
      {recentDays.map((day) => <button key={day.date} className={selectedDate === day.date ? 'selected' : ''} onClick={() => onSelect(day.date)}><span>{labelForDate(day.date, locale)}</span><strong>{formatDuration(day.workedMs, true)}</strong></button>)}
    </div>}
  </section>
}
