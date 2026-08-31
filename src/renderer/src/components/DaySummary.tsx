import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { AlarmClock, ArrowRightLeft, Check, Clock3, Coffee, Download, Dumbbell, GitBranch, Layers3, RedoDot, Sparkles } from 'lucide-react'
import type { AppSnapshot, HistoryDay, OvertimeOverview, Project, Task } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { dayIntervals, formatClock, formatDuration, intervalDuration, overlapDuration, taskDuration, unionDuration } from '../lib/time'
import { workdayOvertimeMs } from '@shared/workday'
import { localDateKey, localDayBounds } from '@shared/local-date'
import { HistoryPanel } from './HistoryPanel'

interface DaySummaryProps {
  snapshot: AppSnapshot
  now: number
  t: Translator
  onStartDay: () => void
  onEndDay: () => void
  onEdit: (task: Task, intervalId?: string) => void
  onSnapshot: (snapshot: AppSnapshot) => void
}

function getProject(projects: Project[], task: Task): Project | undefined {
  return projects.find((project) => project.id === task.projectId)
}

function taskLabel(task: Task, t: Translator): string {
  return task.notes.trim() || task.title.trim() || t('noDescription')
}

function timelineLabel(task: Task, project: Project | undefined, t: Translator): string {
  return `${project?.name ?? t('noProject')} · ${taskLabel(task, t)}`
}

function visibleTimelineIntervals(task: Task, dayStart: number, dayEnd: number, now: number): Array<{ id: string; startedAt: number; endedAt: number }> {
  return task.intervals.flatMap((interval) => {
    const startedAt = Math.max(interval.startedAt, dayStart)
    const endedAt = Math.min(interval.endedAt ?? now, dayEnd)
    return endedAt > startedAt ? [{ id: interval.id, startedAt, endedAt }] : []
  })
}

function visibleTimelineDuration(task: Task, dayStart: number, dayEnd: number, now: number): number {
  return visibleTimelineIntervals(task, dayStart, dayEnd, now).reduce((total, interval) => total + interval.endedAt - interval.startedAt, 0)
}

type ScheduleSegment = { type: 'work' | 'break' | 'lunch'; start: number; end: number }

function atTime(reference: number, value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  const date = new Date(reference)
  date.setHours(hours || 0, minutes || 0, 0, 0)
  return date.getTime()
}

function historyLabel(value: string, locale: 'uk' | 'en'): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(year, month - 1, day, 12))
}

function scheduleSegments(snapshot: AppSnapshot, reference: number, extraLunchMs = 0): { start: number; end: number; segments: ScheduleSegment[]; lunchMinutes: number } {
  const { workday, lunch } = snapshot.settings
  const start = atTime(reference, workday.startTime)
  let end = atTime(reference, workday.endTime)
  if (end <= start) {
    const nextDay = new Date(end)
    nextDay.setDate(nextDay.getDate() + 1)
    end = nextDay.getTime()
  }
  end += extraLunchMs
  const actualRests = snapshot.rests.flatMap((rest) => rest.intervals.map((interval): ScheduleSegment => ({
    type: rest.type,
    start: Math.max(start, interval.startedAt),
    end: Math.min(end, interval.endedAt ?? reference)
  }))).filter((segment) => segment.end > segment.start)
  return {
    start,
    end,
    segments: [{ type: 'work', start, end }, ...actualRests],
    lunchMinutes: lunch.enabled ? lunch.durationMinutes : 0
  }
}

export function DaySummary({ snapshot, now, t, onStartDay, onEndDay, onEdit, onSnapshot }: DaySummaryProps): React.JSX.Element {
  const [aiSummary, setAiSummary] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [calendarExporting, setCalendarExporting] = useState(false)
  const [calendarExportStatus, setCalendarExportStatus] = useState('')
  const todayKey = localDateKey(now)
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [history, setHistory] = useState<HistoryDay[]>([])
  const [overtimeOverview, setOvertimeOverview] = useState<OvertimeOverview>({ balanceMs: 0, days: [] })
  const [historicalSnapshot, setHistoricalSnapshot] = useState<AppSnapshot | null>(null)
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeTaskIds, setMergeTaskIds] = useState<string[]>([])
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeError, setMergeError] = useState('')
  const [timelineLayout, setTimelineLayout] = useState<'lanes' | 'overlay'>('lanes')
  const isHistorical = selectedDate !== todayKey

  useEffect(() => { void window.workBuddy.getHistory().then(setHistory).catch(() => undefined) }, [snapshot])
  useEffect(() => { void window.workBuddy.getOvertimeOverview().then(setOvertimeOverview).catch(() => undefined) }, [snapshot])
  useEffect(() => {
    if (!isHistorical) {
      setHistoricalSnapshot(null)
      return
    }
    void window.workBuddy.getDaySnapshot(selectedDate).then(setHistoricalSnapshot).catch(() => undefined)
  }, [isHistorical, selectedDate, snapshot])

  const reportSnapshot = isHistorical && historicalSnapshot ? historicalSnapshot : snapshot
  const reportNow = isHistorical ? reportSnapshot.now : now
  const intervals = dayIntervals(reportSnapshot.tasks, reportNow)
  const coverage = unionDuration(intervals, reportNow)
  const summed = intervals.reduce((total, interval) => total + intervalDuration(interval, reportNow), 0)
  const overlap = overlapDuration(intervals, reportNow)
  const startedAt = reportSnapshot.workday?.startedAt ?? intervals[0]?.startedAt
  const endedAt = reportSnapshot.workday?.endedAt ?? (startedAt ? reportNow : undefined)
  const span = startedAt && endedAt ? endedAt - startedAt : 0
  const switches = Math.max(0, intervals.length - reportSnapshot.tasks.filter((task) => task.intervals.length > 0).length)
  const hasOpenDay = !isHistorical && reportSnapshot.workday?.endedAt === null
  const [todayStart, todayEnd] = localDayBounds(reportNow)
  const tasks = reportSnapshot.tasks.filter((task) => task.intervals.some((interval) => interval.startedAt < todayEnd && (interval.endedAt ?? reportNow) > todayStart))
  const timelineStart = intervals.length ? Math.min(...intervals.map((interval) => interval.startedAt)) : startedAt ?? reportNow
  const intervalEnd = intervals.length ? Math.max(...intervals.map((interval) => interval.endedAt ?? reportNow)) : endedAt ?? reportNow
  const timelineEnd = Math.max(timelineStart + 60_000, intervalEnd)
  const timelineSpan = timelineEnd - timelineStart
  const restTime = (type: 'break' | 'lunch'): number => reportSnapshot.rests
    .filter((rest) => rest.type === type)
    .flatMap((rest) => rest.intervals)
    .reduce((total, interval) => total + Math.max(0, Math.min(interval.endedAt ?? reportNow, todayEnd) - Math.max(interval.startedAt, todayStart)), 0)
  const breakTime = restTime('break')
  const lunchTime = restTime('lunch')
  const hasDayDetails = Boolean(reportSnapshot.workday) || tasks.length > 0 || breakTime > 0 || lunchTime > 0
  const baseSchedule = scheduleSegments(reportSnapshot, reportNow)
  const lunchOverage = Math.max(0, lunchTime - reportSnapshot.settings.lunch.durationMinutes * 60_000)
  const schedule = scheduleSegments(reportSnapshot, reportNow, lunchOverage)
  const scheduleSpan = schedule.end - schedule.start
  const scheduleProgress = Math.min(100, Math.max(0, ((reportNow - schedule.start) / scheduleSpan) * 100))
  const scheduledMinutes = scheduleSpan / 60_000
  const countedMinutes = (baseSchedule.end - baseSchedule.start) / 60_000 - (reportSnapshot.settings.lunch.includedInWorkHours ? 0 : baseSchedule.lunchMinutes)
  const overtimeDay = overtimeOverview.days.find((day) => day.date === selectedDate)
  const overtime = hasOpenDay
    ? workdayOvertimeMs(reportSnapshot.settings, reportSnapshot.workday, reportSnapshot.rests, reportNow, reportSnapshot.tasks.flatMap((task) => task.intervals))
    : overtimeDay?.overtimeMs ?? 0
  const canMergeTasks = !isHistorical && !hasOpenDay && tasks.length > 1
  const canShowAiSummary = !isHistorical && Boolean(reportSnapshot.workday?.endedAt) && tasks.length > 0 && reportSnapshot.settings.ai.enabled && reportSnapshot.settings.ai.hasApiKey
  const canExportCalendar = Boolean(reportSnapshot.workday?.endedAt)

  useEffect(() => { setCalendarExportStatus('') }, [selectedDate])

  const toggleMergeTask = (id: string): void => {
    setMergeTaskIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const leaveMergeMode = (): void => {
    setMergeMode(false)
    setMergeTaskIds([])
    setMergeError('')
  }

  const mergeTasks = async (): Promise<void> => {
    const [targetId, ...sourceIds] = mergeTaskIds
    if (!targetId || !sourceIds.length) return
    setMergeBusy(true)
    setMergeError('')
    try {
      onSnapshot(await window.workBuddy.mergeTasks({ targetId, sourceIds, date: selectedDate }))
      leaveMergeMode()
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : t('mergeError'))
    } finally {
      setMergeBusy(false)
    }
  }

  const toggleOvertimeRedemption = async (): Promise<void> => {
    if (!overtimeDay) return
    const result = await window.workBuddy.setOvertimeRedeemed(overtimeDay.date, !overtimeDay.redeemed)
    setOvertimeOverview(result)
  }

  const generateSummary = async (): Promise<void> => {
    setAiBusy(true)
    setAiError('')
    try {
      setAiSummary((await window.workBuddy.summarizeDay()).summary)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : t('aiError'))
    } finally {
      setAiBusy(false)
    }
  }

  const exportCalendar = async (): Promise<void> => {
    setCalendarExporting(true)
    setCalendarExportStatus('')
    try {
      const result = await window.workBuddy.exportDayCalendar(selectedDate)
      if (result) setCalendarExportStatus(t('calendarExportReady'))
    } catch (error) {
      setCalendarExportStatus(error instanceof Error ? error.message : t('calendarExportError'))
    } finally {
      setCalendarExporting(false)
    }
  }

  const metrics = [
    { label: t('workedToday'), value: formatDuration(coverage, true), icon: Clock3, tone: 'green' },
    { label: t('summedTime'), value: formatDuration(summed, true), icon: Layers3, tone: 'blue' },
    { label: t('overlap'), value: formatDuration(overlap, true), icon: GitBranch, tone: 'purple' },
    { label: t('contextSwitches'), value: String(switches), icon: ArrowRightLeft, tone: 'orange' },
    { label: t('breakTime'), value: formatDuration(breakTime, true), icon: Dumbbell, tone: 'blue' },
    { label: t('lunchTime'), value: formatDuration(lunchTime, true), icon: Coffee, tone: 'orange' }
  ]

  return (
    <motion.div className="page-stack" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
      {hasDayDetails && <section className="day-hero">
        <div>
          <span className="eyebrow">{isHistorical ? historyLabel(selectedDate, reportSnapshot.settings.locale) : t('today')}</span>
          <h2>{isHistorical ? t('historyDay') : hasOpenDay ? t('dayRunning') : reportSnapshot.workday ? t('dayDone') : t('noTimers')}</h2>
          {startedAt && endedAt && <p>{formatClock(startedAt, reportSnapshot.settings.locale)} — {reportSnapshot.workday?.endedAt || isHistorical ? formatClock(endedAt, reportSnapshot.settings.locale) : 'now'} · {formatDuration(span, true)}</p>}
        </div>
        <div className="day-hero__tools"><div className={`day-orb ${hasOpenDay ? 'day-orb--live' : ''}`}><Sparkles size={20} /></div></div>
      </section>}

      {hasDayDetails && <section className="panel schedule-panel">
        <div className="section-heading"><div><span className="eyebrow">{t('workSchedule')}</span><h3>{t('dayProgress')}</h3></div><strong>{Math.round(scheduleProgress)}%</strong></div>
        <div className="schedule-progress">
          <span className="schedule-progress__elapsed" style={{ width: `${scheduleProgress}%` }} />
          {schedule.segments.map((segment, index) => (
            <span key={`${segment.start}-${index}`} className={`schedule-progress__segment schedule-progress__segment--${segment.type} ${segment.end <= reportNow ? 'is-past' : ''}`} style={{ left: `${((segment.start - schedule.start) / scheduleSpan) * 100}%`, width: `${((segment.end - segment.start) / scheduleSpan) * 100}%` }} />
          ))}
          {reportNow >= schedule.start && reportNow <= schedule.end && <i className="schedule-progress__now" style={{ left: `${scheduleProgress}%` }} />}
        </div>
        <div className="schedule-times"><span>{reportSnapshot.settings.workday.startTime}</span><span>{formatClock(schedule.end, reportSnapshot.settings.locale)}</span></div>
        <div className="schedule-legend"><span><i className="work" />{t('workSegment')}</span><span><i className="break" />{t('breakTaken')}</span><span><i className="lunch" />{t('lunchTaken')}</span></div>
        <p>{t('scheduledSpan')} {Math.round(scheduledMinutes / 60 * 10) / 10} {t('hoursShort')} · {t('countedWork')} {Math.round(countedMinutes / 60 * 10) / 10} {t('hoursShort')} · {reportSnapshot.settings.lunch.includedInWorkHours ? t('lunchPaidShort') : t('lunchUnpaidShort')}</p>
      </section>}

      {overtime > 0 && (
        <motion.section className="overtime-card" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
          <span><AlarmClock size={17} /></span><div><small>{t('overtime')}</small><strong>+{formatDuration(overtime, true)}</strong><p>{t('overtimeBody')}</p></div>{overtimeDay && <button className={`overtime-redeem-button ${overtimeDay.redeemed ? 'is-redeemed' : ''}`} onClick={() => void toggleOvertimeRedemption()}><Check size={13} />{overtimeDay.redeemed ? t('overtimeRedeemed') : t('overtimeRedeem')}</button>}
        </motion.section>
      )}

      {hasDayDetails && <div className="metrics-grid">
        {metrics.map(({ label, value, icon: Icon, tone }, index) => (
          <motion.div className={`metric-card metric-card--${tone}`} key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
            <Icon size={16} />
            <strong>{value}</strong>
            <span>{label}</span>
          </motion.div>
        ))}
      </div>}

      <section className="overtime-balance-card">
        <span><AlarmClock size={18} /></span><div><small>{t('overtimeBalance')}</small><strong>+{formatDuration(overtimeOverview.balanceMs, true)}</strong><p>{t('overtimeBalanceBody')}</p></div>
      </section>

      {tasks.length > 0 && <section className="panel timeline-panel">
        <div className="section-heading">
          <div><span className="eyebrow">Timeline</span><h3>{t('timeline')}</h3></div>
          <div className="timeline-heading-actions"><button className={`timeline-layout-toggle ${timelineLayout === 'overlay' ? 'is-overlay' : ''}`} onClick={() => setTimelineLayout((current) => current === 'lanes' ? 'overlay' : 'lanes')} title={timelineLayout === 'lanes' ? t('timelineOverlay') : t('timelineRows')} aria-label={timelineLayout === 'lanes' ? t('timelineOverlay') : t('timelineRows')}><RedoDot size={15} /></button>{startedAt && <span className="timeline-range">{formatClock(timelineStart, reportSnapshot.settings.locale)} — {formatClock(timelineEnd, reportSnapshot.settings.locale)}</span>}</div>
        </div>
        {timelineLayout === 'lanes' ? <div className="timeline">
            {tasks.map((task) => {
              const project = getProject(reportSnapshot.projects, task)
              const color = project?.color ?? '#b8e986'
              const label = timelineLabel(task, project, t)
              return (
                <div className="timeline-row" key={task.id}>
                  <div className="timeline-label"><strong title={label}>{label}</strong><span>{formatDuration(visibleTimelineDuration(task, todayStart, todayEnd, reportNow), true)}</span></div>
                  <div className="timeline-track">
                    {visibleTimelineIntervals(task, todayStart, todayEnd, reportNow).map((interval) => {
                      const left = ((interval.startedAt - timelineStart) / timelineSpan) * 100
                      const width = ((interval.endedAt - interval.startedAt) / timelineSpan) * 100
                      return <motion.span key={interval.id} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, background: color }} />
                    })}
                  </div>
                </div>
              )
            })}
          </div> : <div className="timeline timeline--overlay">
            <div className="timeline-track timeline-track--overlay">
              {tasks.flatMap((task) => {
                const project = getProject(reportSnapshot.projects, task)
                const color = project?.color ?? '#b8e986'
                const label = timelineLabel(task, project, t)
                return visibleTimelineIntervals(task, todayStart, todayEnd, reportNow).map((interval) => {
                  const left = ((interval.startedAt - timelineStart) / timelineSpan) * 100
                  const width = ((interval.endedAt - interval.startedAt) / timelineSpan) * 100
                  return <motion.span key={interval.id} title={`${label} · ${formatDuration(interval.endedAt - interval.startedAt, true)}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, background: color }} />
                })
              })}
            </div>
            <div className="timeline-overlay-legend">{tasks.map((task) => {
              const project = getProject(reportSnapshot.projects, task)
              const label = timelineLabel(task, project, t)
              return <span key={task.id} title={label}><i style={{ background: project?.color ?? '#b8e986' }} />{label}</span>
            })}</div>
          </div>
        }
      </section>}

      {tasks.length > 0 && <section className="panel day-tasks-panel">
        <div className="section-heading"><div><span className="eyebrow">Tasks</span><h3>{t('todayTasks')}</h3></div>{!mergeMode && canMergeTasks ? <button className="day-merge-toggle" onClick={() => setMergeMode(true)}><GitBranch size={13} />{t('mergeTasks')}</button> : <span className="timeline-range">{tasks.length}</span>}</div>
        {mergeMode && <div className="day-merge-controls"><p>{t('mergeTasksHint')}</p>{mergeError && <small>{mergeError}</small>}<div><button className="secondary-button" disabled={mergeBusy} onClick={leaveMergeMode}>{t('cancel')}</button><button className="primary-button" disabled={mergeBusy || mergeTaskIds.length < 2} onClick={() => void mergeTasks()}><GitBranch size={14} />{t('mergeSelected')} {mergeTaskIds.length > 1 ? `(${mergeTaskIds.length})` : ''}</button></div></div>}
        <div className="day-task-list">
          {tasks.map((task) => {
            const project = getProject(reportSnapshot.projects, task)
            const selected = mergeTaskIds.includes(task.id)
            const taskIntervals = visibleTimelineIntervals(task, todayStart, todayEnd, reportNow)
            const taskRow = <><span className="day-task-row__color" style={{ background: project?.color ?? '#b8e986' }} />
              <span className="day-task-row__copy"><strong>{taskLabel(task, t)}</strong><small>{project?.name ?? t('noProject')}</small></span>
              <span>{formatDuration(visibleTimelineDuration(task, todayStart, todayEnd, reportNow), true)}</span></>
            return mergeMode ? <button type="button" className={`day-task-row day-task-row--selectable ${selected ? 'is-selected' : ''}`} key={task.id} onClick={() => toggleMergeTask(task.id)}><span className="day-task-row__check">{selected && <Check size={10} strokeWidth={3} />}</span>{taskRow}</button> : <button className="day-task-row" key={task.id} onClick={() => onEdit(task, taskIntervals[taskIntervals.length - 1]?.id)} title={t('editTaskHint')}>
              {taskRow}
            </button>
          })}
        </div>
      </section>}

      {canShowAiSummary && (
        <section className="panel ai-summary-panel">
          <div className="section-heading"><div><span className="eyebrow">Gemini</span><h3>{t('aiDaySummary')}</h3></div><Sparkles size={16} /></div>
          {aiSummary ? <div className="ai-summary-copy">{aiSummary}</div> : <p>{t('aiDaySummaryBody')}</p>}
          {aiError && <p className="ai-error">{aiError}</p>}
          <button className="secondary-button wide" disabled={aiBusy || tasks.length === 0} onClick={generateSummary}>{aiBusy ? t('aiThinking') : t('generateSummary')}</button>
        </section>
      )}

      {!isHistorical && <button className={hasOpenDay ? 'end-day-button' : 'primary-button wide'} onClick={hasOpenDay ? onEndDay : onStartDay}>
        {hasOpenDay ? t('endDay') : t('startDay')}
      </button>}

      <HistoryPanel days={history} selectedDate={selectedDate} locale={reportSnapshot.settings.locale} t={t} onSelect={setSelectedDate} />
      {canExportCalendar && <section className="history-calendar-export">
        <button className="day-calendar-button" disabled={calendarExporting} onClick={() => void exportCalendar()}><Download size={14} />{calendarExporting ? t('calendarExporting') : t('calendarExport')}</button>
        {calendarExportStatus && <p className="calendar-export-status">{calendarExportStatus}</p>}
      </section>}
    </motion.div>
  )
}
