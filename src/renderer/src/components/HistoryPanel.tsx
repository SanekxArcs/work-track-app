import { CalendarDays } from 'lucide-react'
import type { HistoryDay } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { formatDuration } from '../lib/time'

interface HistoryPanelProps {
  days: HistoryDay[]
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

export function HistoryPanel({ days, selectedDate, locale, t, onSelect }: HistoryPanelProps): React.JSX.Element {
  const visibleDays = days.slice(-182)
  const recentDays = [...days].reverse().filter((day) => day.workedMs > 0).slice(0, 6)

  return <section className="panel history-panel">
    <div className="section-heading"><div><span className="eyebrow">History</span><h3>{t('workHistory')}</h3></div><CalendarDays size={16} /></div>
    <p>{t('workHistoryBody')}</p>
    <div className="history-heatmap" aria-label={t('workHistory')}>
      {visibleDays.map((day) => <button key={day.date} className={`history-cell history-cell--${level(day.workedMs)} ${selectedDate === day.date ? 'selected' : ''}`} onClick={() => onSelect(day.date)} title={`${labelForDate(day.date, locale)} · ${formatDuration(day.workedMs, true)}`} aria-label={`${labelForDate(day.date, locale)}: ${formatDuration(day.workedMs, true)}`} />)}
    </div>
    <div className="history-legend"><span>{t('less')}</span><i className="history-cell--0" /><i className="history-cell--1" /><i className="history-cell--2" /><i className="history-cell--3" /><i className="history-cell--4" /><span>{t('more')}</span></div>
    {recentDays.length > 0 && <div className="history-recent">
      {recentDays.map((day) => <button key={day.date} className={selectedDate === day.date ? 'selected' : ''} onClick={() => onSelect(day.date)}><span>{labelForDate(day.date, locale)}</span><strong>{formatDuration(day.workedMs, true)}</strong></button>)}
    </div>}
  </section>
}
