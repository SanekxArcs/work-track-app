import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { Archive, ArchiveRestore, CalendarClock, Check, CheckCheck, GitMerge, GripVertical, Pencil, Plus, Search, Target, Trash2, X } from 'lucide-react'
import type { AppSnapshot, Project, ProjectStats, ProjectStatus, ProjectTaskSummary, ProjectType } from '@shared/types'
import { localDateKey, localDayBounds } from '@shared/local-date'
import type { Translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { formatClock, formatDuration } from '../lib/time'
import { AnimatedDuration, AnimatedNumber, ease, StackCollapse } from './Animated'
import { ConfirmDialog } from './ConfirmDialog'
import { CustomSelect } from './CustomSelect'
import { randomProjectColor } from './ProjectPicker'

interface ProjectsPageProps {
  snapshot: AppSnapshot
  now: number
  t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void
}

type View = 'active' | 'archive'
type Sort = 'priority' | 'recent' | 'time' | 'name'
type StatusFilter = 'all' | 'none' | string
type TypeFilter = 'all' | 'none' | string

interface Draft {
  id: string | null
  name: string
  color: string
  statusId: string
  typeId: string
  deadline: string
  budget: string
}

const DAY = 86_400_000
const emptyStats = (projectId: string): ProjectStats => ({ projectId, totalMs: 0, todayMs: 0, weekMs: 0, taskCount: 0, lastWorkedAt: null })

/** Budgets are whole minutes, so 20 minutes reads as 0.33 instead of 0.333333… */
function formatBudgetHours(hours: number | null | undefined, locale: 'uk' | 'en'): string {
  return Number((hours ?? 0).toFixed(2)).toLocaleString(locale === 'uk' ? 'uk-UA' : 'en-US')
}

function shortDate(timestamp: number, locale: 'uk' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'short' }).format(timestamp)
}

function lastWorkedLabel(timestamp: number | null, now: number, locale: 'uk' | 'en', neverLabel: string): string {
  if (timestamp === null) return neverLabel
  const [todayStart] = localDayBounds(now)
  return timestamp >= todayStart ? formatClock(timestamp, locale) : shortDate(timestamp, locale)
}

function taskWhen(task: ProjectTaskSummary, locale: 'uk' | 'en'): string {
  if (task.firstStartedAt === null || task.lastEndedAt === null) return ''
  const sameDay = localDayBounds(task.firstStartedAt)[0] === localDayBounds(task.lastEndedAt)[0]
  const first = `${shortDate(task.firstStartedAt, locale)} ${formatClock(task.firstStartedAt, locale)}`
  return sameDay
    ? `${first}–${formatClock(task.lastEndedAt, locale)}`
    : `${first} → ${shortDate(task.lastEndedAt, locale)} ${formatClock(task.lastEndedAt, locale)}`
}

/** Days from today until a YYYY-MM-DD deadline (negative once it has passed). */
function daysUntil(deadline: string, now: number): number {
  const [year, month, day] = deadline.split('-').map(Number)
  return Math.round((new Date(year, month - 1, day).getTime() - localDayBounds(now)[0]) / DAY)
}

/** Lets a horizontal strip be scrolled by dragging it with the mouse or spinning the wheel. */
function useDragScroll<T extends HTMLElement>(): { ref: React.RefObject<T | null>; handlers: React.HTMLAttributes<T> } {
  const ref = useRef<T | null>(null)
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false })
  return {
    ref,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== 0 || !ref.current) return
        drag.current = { active: true, startX: event.clientX, startScroll: ref.current.scrollLeft, moved: false }
      },
      onPointerMove: (event) => {
        const state = drag.current
        if (!state.active || !ref.current) return
        const delta = event.clientX - state.startX
        if (Math.abs(delta) > 4) state.moved = true
        if (state.moved) ref.current.scrollLeft = state.startScroll - delta
      },
      onPointerUp: () => { drag.current.active = false },
      onPointerLeave: () => { drag.current.active = false },
      onClickCapture: (event) => {
        if (drag.current.moved) {
          event.stopPropagation()
          event.preventDefault()
          drag.current.moved = false
        }
      },
      onWheel: (event) => {
        if (ref.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) ref.current.scrollLeft += event.deltaY
      }
    }
  }
}

export function ProjectsPage({ snapshot, now, t, onSnapshot }: ProjectsPageProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('active')
  const [sort, setSort] = useState<Sort>('priority')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [stats, setStats] = useState<Map<string, ProjectStats>>(new Map())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [projectTasks, setProjectTasks] = useState<ProjectTaskSummary[] | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'merge'; project: Project; target?: Project } | null>(null)
  // Keeps the dialog's text while it fades out after `confirm` is cleared.
  const lastConfirm = useRef(confirm)
  if (confirm) lastConfirm.current = confirm
  const shownConfirm = confirm ?? lastConfirm.current
  const chips = useDragScroll<HTMLDivElement>()
  const typeChips = useDragScroll<HTMLDivElement>()
  const statuses = snapshot.settings.projectStatuses
  const types = snapshot.settings.projectTypes
  const locale = snapshot.settings.locale
  const dayKey = localDateKey(now)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void window.workBuddy.getProjectStats().then((rows) => {
        if (!cancelled) setStats(new Map(rows.map((row) => [row.projectId, row])))
      }).catch(() => undefined)
    }
    load()
    // Totals only move on their own while something is running; otherwise a snapshot change
    // or a new calendar day (today and week windows shift) triggers the reload.
    const timer = snapshot.tasks.some((task) => task.status === 'running') ? window.setInterval(load, 15_000) : undefined
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [snapshot, dayKey])

  useEffect(() => {
    setProjectTasks(null)
    setMergeTarget('')
    if (!expandedId) return
    let cancelled = false
    void window.workBuddy.getProjectTasks(expandedId).then((rows) => {
      if (!cancelled) setProjectTasks(rows)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [expandedId, snapshot])

  const statusOf = (project: Project): ProjectStatus | undefined => statuses.find((status) => status.id === project.statusId)
  const typeOf = (project: Project): ProjectType | undefined => types.find((type) => type.id === project.typeId)
  const statsOf = (project: Project): ProjectStats => stats.get(project.id) ?? emptyStats(project.id)
  const activeCount = snapshot.projects.filter((project) => !project.archived).length
  const archivedCount = snapshot.projects.length - activeCount
  const searching = query.trim().length > 0

  const visible = useMemo(() => {
    const needle = query.normalize('NFKC').toLocaleLowerCase().trim()
    const order = new Map(snapshot.projects.map((project, index) => [project.id, index]))
    return snapshot.projects
      .filter((project) => needle
        ? project.name.normalize('NFKC').toLocaleLowerCase().includes(needle)
        : (view === 'archive') === project.archived)
      .filter((project) => statusFilter === 'all' || (statusFilter === 'none' ? !statuses.some((status) => status.id === project.statusId) : project.statusId === statusFilter))
      .filter((project) => typeFilter === 'all' || (typeFilter === 'none' ? !types.some((type) => type.id === project.typeId) : project.typeId === typeFilter))
      .sort((first, second) => {
        if (first.archived !== second.archived) return Number(first.archived) - Number(second.archived)
        const firstStats = stats.get(first.id) ?? emptyStats(first.id)
        const secondStats = stats.get(second.id) ?? emptyStats(second.id)
        if (sort === 'time') return secondStats.totalMs - firstStats.totalMs || first.name.localeCompare(second.name)
        if (sort === 'name') return first.name.localeCompare(second.name)
        if (sort === 'recent') return (secondStats.lastWorkedAt ?? second.createdAt) - (firstStats.lastWorkedAt ?? first.createdAt)
        return (order.get(first.id) ?? 0) - (order.get(second.id) ?? 0)
      })
  }, [snapshot.projects, query, view, statusFilter, typeFilter, sort, stats, statuses, types])

  // Local copy so cards follow the pointer while dragging; saved once on drop.
  const [dragOrder, setDragOrder] = useState<string[]>([])
  const dragOrderRef = useRef<string[]>([])
  // Keyed on the id sequence so stats refreshes (new `visible` array, same order) don't reset a drag in progress.
  const visibleKey = visible.map((project) => project.id).join()
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split(',') : []
    dragOrderRef.current = ids
    setDragOrder(ids)
  }, [visibleKey])
  const canReorder = sort === 'priority' && !searching && statusFilter === 'all' && typeFilter === 'all'
  const listed = canReorder ? dragOrder.map((id) => visible.find((project) => project.id === id)).filter((project): project is Project => Boolean(project)) : visible
  const maxTotal = Math.max(1, ...visible.map((project) => statsOf(project).totalMs))

  const run = async (action: () => Promise<AppSnapshot>): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      onSnapshot(await action())
      return true
    } catch (caught) {
      setError(errorText(caught, t, 'timeUpdateError'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const beginCreate = (): void => {
    setError('')
    setDraft({ id: null, name: '', color: randomProjectColor(snapshot), statusId: statuses[0]?.id ?? '', typeId: '', deadline: '', budget: '' })
  }

  const beginEdit = (project: Project): void => {
    setError('')
    setDraft({
      id: project.id,
      name: project.name,
      color: project.color,
      statusId: statuses.some((status) => status.id === project.statusId) ? project.statusId ?? '' : '',
      typeId: types.some((type) => type.id === project.typeId) ? project.typeId ?? '' : '',
      deadline: project.deadline ?? '',
      budget: project.budgetHours ? String(Number(project.budgetHours.toFixed(2))) : ''
    })
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft || !draft.name.trim()) return
    const budget = Number(draft.budget.trim().replace(',', '.'))
    // Budgets are stored in whole minutes; reject anything that would round to zero.
    if (draft.budget.trim() && !(Number.isFinite(budget) && Math.round(budget * 60) >= 1)) {
      setError(t('budgetInvalid'))
      return
    }
    const budgetHours = draft.budget.trim() ? budget : null
    const common = { name: draft.name, color: draft.color, statusId: draft.statusId || null, typeId: draft.typeId || null, deadline: draft.deadline || null, budgetHours }
    const saved = await run(() => draft.id
      ? window.workBuddy.updateProject({ id: draft.id, ...common })
      : window.workBuddy.createProject(common))
    if (saved) setDraft(null)
  }

  const setArchived = (project: Project, archived: boolean): Promise<boolean> =>
    run(() => window.workBuddy.updateProject({ id: project.id, name: project.name, color: project.color, archived }))

  const persistOrder = (): void => {
    const ids = dragOrderRef.current
    if (ids.join() === visibleKey) return
    void run(() => window.workBuddy.reorderProjects(ids))
  }

  const askDelete = (project: Project): void => {
    setError('')
    setConfirm({ kind: 'delete', project })
  }

  const askMerge = (project: Project): void => {
    const target = snapshot.projects.find((item) => item.id === mergeTarget)
    if (!target) return
    setError('')
    setConfirm({ kind: 'merge', project, target })
  }

  const confirmAction = async (): Promise<void> => {
    if (!confirm) return
    const { kind, project, target } = confirm
    if (kind === 'delete') {
      if (await run(() => window.workBuddy.deleteProject(project.id))) {
        setExpandedId(null)
        setConfirm(null)
      }
    } else if (target && await run(() => window.workBuddy.mergeProjects(project.id, target.id))) {
      setExpandedId(target.id)
      setConfirm(null)
    }
  }

  const renderForm = (): React.JSX.Element | null => draft && (
    <div className="project-form">
      <input autoFocus value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void saveDraft(); if (event.key === 'Escape') setDraft(null) }} placeholder={t('projectName')} aria-label={t('projectName')} />
      <div className="color-dots">
        {snapshot.settings.projectColors.map((color) => <button key={color} type="button" aria-label={color} className={draft.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => setDraft({ ...draft, color })} />)}
      </div>
      <CustomSelect
        value={draft.statusId}
        ariaLabel={t('projectStatus')}
        onChange={(statusId) => setDraft({ ...draft, statusId })}
        options={[{ value: '', label: t('noStatus') }, ...statuses.map((status) => ({ value: status.id, label: status.name, color: status.color }))]}
      />
      {types.length > 0 && <CustomSelect
        value={draft.typeId}
        ariaLabel={t('projectType')}
        onChange={(typeId) => setDraft({ ...draft, typeId })}
        options={[{ value: '', label: t('noType') }, ...types.map((type) => ({ value: type.id, label: type.name, color: type.color }))]}
      />}
      <div className="project-form__pair">
        <label><span><CalendarClock size={12} />{t('deadlineLabel')}</span><input type="date" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} /></label>
        <label><span><Target size={12} />{t('budgetLabel')}</span><input type="text" inputMode="decimal" value={draft.budget} placeholder="—" onChange={(event) => setDraft({ ...draft, budget: event.target.value })} /></label>
      </div>
      <div className="project-form__actions">
        <button className="icon-button icon-button--quiet" disabled={busy} onClick={() => setDraft(null)} title={t('cancel')}><X size={15} /></button>
        <button className="primary-button" disabled={busy || !draft.name.trim()} onClick={() => void saveDraft()}><Check size={15} />{t('save')}</button>
      </div>
    </div>
  )

  const renderCard = (project: Project, handle?: ReturnType<typeof useDragControls>): React.JSX.Element => {
    if (draft?.id === project.id) return <motion.div key="editing" className="project-card project-card--editing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease }}>{renderForm()}</motion.div>
    const status = statusOf(project)
    const projectType = typeOf(project)
    const projectStats = statsOf(project)
    const expanded = expandedId === project.id
    const budgetMs = project.budgetHours ? project.budgetHours * 3_600_000 : 0
    const budgetPct = budgetMs ? (projectStats.totalMs / budgetMs) * 100 : 0
    const overBudget = budgetPct > 100
    const days = project.deadline ? daysUntil(project.deadline, now) : null
    const deadlineTone = days === null ? '' : days < 0 ? 'overdue' : days <= 3 ? 'soon' : ''
    const deadlineText = days === null ? '' : days < 0 ? `${t('overdueLabel')} ${-days} ${t('daysShort')}` : days === 0 ? t('dueToday') : `${days} ${t('daysShort')}`
    const others = snapshot.projects.filter((item) => item.id !== project.id)
    return (
      <article
        className={`project-card ${project.archived ? 'project-card--archived' : ''} ${expanded ? 'project-card--expanded' : ''}`}
        style={{ '--project-color': project.color } as React.CSSProperties}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, select, label, .no-toggle')) return
          setExpandedId(expanded ? null : project.id)
        }}
      >
        <header>
          {handle && <button className="project-card__grip" title={t('dragToReorder')} aria-label={t('dragToReorder')} onPointerDown={(event) => handle.start(event)}><GripVertical size={15} /></button>}
          <i className="project-card__dot" />
          <div className="project-card__title">
            <strong>{project.name}</strong>
            <div className="project-card__tags">
              {projectType && <span className="status-pill status-pill--type" style={{ '--status-color': projectType.color } as React.CSSProperties}>{projectType.name}</span>}
              {status && <span className="status-pill" style={{ '--status-color': status.color } as React.CSSProperties}>{status.name}</span>}
              {project.archived && <span className="status-pill status-pill--archived">{t('archivedTag')}</span>}
              {days !== null && <span className={`status-pill status-pill--deadline ${deadlineTone}`}><CalendarClock size={9} />{deadlineText}</span>}
            </div>
          </div>
          <div className="project-card__actions">
            <button className="icon-button icon-button--quiet" disabled={busy} onClick={() => beginEdit(project)} title={t('editProject')}><Pencil size={14} /></button>
            {project.archived
              ? <button className="icon-button icon-button--quiet" disabled={busy} onClick={() => void setArchived(project, false)} title={t('restoreProject')}><ArchiveRestore size={14} /></button>
              : <button className="icon-button icon-button--quiet project-complete-button" disabled={busy} onClick={() => void setArchived(project, true)} title={t('completeProject')}><CheckCheck size={15} /></button>}
          </div>
        </header>
        <div className="project-card__time">
          <strong><AnimatedDuration ms={projectStats.totalMs} compact /></strong>
          {budgetMs > 0 ? (
            <div className="project-card__budget">
              <div className={`project-card__bar ${overBudget ? 'project-card__bar--over' : ''}`}><span style={{ width: `${Math.min(100, budgetPct)}%` }} /></div>
              <small><AnimatedNumber value={Math.round(budgetPct)} suffix="%" /> · {t('budgetLabel')} {formatBudgetHours(project.budgetHours, locale)}{t('hoursShort')}</small>
            </div>
          ) : (
            <div className="project-card__bar"><span style={{ width: `${Math.max(projectStats.totalMs > 0 ? 3 : 0, (projectStats.totalMs / maxTotal) * 100)}%` }} /></div>
          )}
        </div>
        <StackCollapse open={expanded} gap={10}>
          <div className="project-details no-toggle">
            <dl className="project-card__stats">
              <div><dt>{t('trackedToday')}</dt><dd><AnimatedDuration ms={projectStats.todayMs} compact /></dd></div>
              <div><dt>{t('trackedWeek')}</dt><dd><AnimatedDuration ms={projectStats.weekMs} compact /></dd></div>
              <div><dt>{t('taskCountLabel')}</dt><dd><AnimatedNumber value={projectStats.taskCount} /></dd></div>
              <div><dt>{t('lastWorkedLabel')}</dt><dd>{lastWorkedLabel(projectStats.lastWorkedAt, now, locale, t('neverWorked'))}</dd></div>
            </dl>
            {project.deadline && <p className="project-details__meta"><CalendarClock size={12} />{t('deadlineLabel')}: {shortDate(new Date(`${project.deadline}T12:00:00`).getTime(), locale)} · {deadlineText}</p>}
            {budgetMs > 0 && <p className="project-details__meta"><Target size={12} />{formatDuration(projectStats.totalMs, true)} / {formatBudgetHours(project.budgetHours, locale)}{t('hoursShort')}{overBudget ? ` · +${formatDuration(projectStats.totalMs - budgetMs, true)}` : ` · ${formatDuration(budgetMs - projectStats.totalMs, true)} ${t('budgetLeft')}`}</p>}
            <h4>{t('projectTasksTitle')}</h4>
            {projectTasks === null ? <p className="empty-copy">…</p> : projectTasks.length === 0 ? <p className="empty-copy">{t('noTasksYet')}</p> : (
              <ul className="project-task-list">
                {projectTasks.map((task) => (
                  <li key={task.id}>
                    <span className={`status-dot ${task.status === 'running' ? 'status-dot--live' : ''}`} />
                    <div><strong>{task.label || t('noDescription')}</strong><small>{taskWhen(task, locale)}{task.intervalCount > 1 ? ` · ×${task.intervalCount}` : ''}</small></div>
                    <em>{formatDuration(task.totalMs, true)}</em>
                  </li>
                ))}
              </ul>
            )}
            <div className="project-details__manage">
              {others.length > 0 && <div className="project-merge">
                <CustomSelect value={mergeTarget} ariaLabel={t('mergeInto')} onChange={setMergeTarget} options={[{ value: '', label: t('mergeInto') }, ...others.map((item) => ({ value: item.id, label: item.name, color: item.color }))]} />
                <AnimatePresence initial={false}>
                  {mergeTarget && <motion.button key="merge" className="secondary-button" disabled={busy} onClick={() => askMerge(project)} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ duration: 0.16, ease }}><GitMerge size={14} />{t('mergeAction')}</motion.button>}
                </AnimatePresence>
              </div>}
              <button className="danger-button" disabled={busy} onClick={() => askDelete(project)}><Trash2 size={14} />{t('deleteProject')}</button>
            </div>
          </div>
        </StackCollapse>
      </article>
    )
  }

  return (
    <motion.div className="page-stack projects-page" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}>
      <div className="projects-toolbar">
        <label className="projects-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchProjects')} aria-label={t('searchProjects')} /></label>
        <button className="icon-button icon-button--accent" onClick={beginCreate} title={t('newProject')} aria-label={t('newProject')}><Plus size={16} /></button>
      </div>

      <StackCollapse open={Boolean(draft && draft.id === null)}><div className="project-card project-card--editing">{renderForm()}</div></StackCollapse>

      <div className="projects-filters">
        <div className="segmented">
          <button className={view === 'active' ? 'active' : ''} onClick={() => setView('active')}>{t('activeProjects')} <em>{activeCount}</em></button>
          <button className={view === 'archive' ? 'active' : ''} onClick={() => setView('archive')}><Archive size={12} />{t('archiveTab')} <em>{archivedCount}</em></button>
        </div>
        <div className="segmented segmented--sort">
          {(['priority', 'recent', 'time', 'name'] as const).map((item) => <button key={item} className={sort === item ? 'active' : ''} onClick={() => setSort(item)}>{t(item === 'priority' ? 'sortPriority' : item === 'recent' ? 'sortRecent' : item === 'time' ? 'sortTime' : 'sortName')}</button>)}
        </div>
      </div>

      {statuses.length > 0 && <div className="status-chips" ref={chips.ref} {...chips.handlers}>
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>{t('allStatuses')}</button>
        {statuses.map((status) => <button key={status.id} className={statusFilter === status.id ? 'active' : ''} onClick={() => setStatusFilter(statusFilter === status.id ? 'all' : status.id)}><i style={{ background: status.color }} />{status.name}</button>)}
        <button className={statusFilter === 'none' ? 'active' : ''} onClick={() => setStatusFilter(statusFilter === 'none' ? 'all' : 'none')}>{t('noStatus')}</button>
      </div>}

      {types.length > 0 && <div className="status-chips status-chips--types" ref={typeChips.ref} {...typeChips.handlers}>
        <button className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>{t('allTypes')}</button>
        {types.map((type) => <button key={type.id} className={typeFilter === type.id ? 'active' : ''} onClick={() => setTypeFilter(typeFilter === type.id ? 'all' : type.id)}><i style={{ background: type.color }} />{type.name}</button>)}
        <button className={typeFilter === 'none' ? 'active' : ''} onClick={() => setTypeFilter(typeFilter === 'none' ? 'all' : 'none')}>{t('noType')}</button>
      </div>}

      <StackCollapse open={Boolean(error) && !confirm}><p className="form-error">{error}</p></StackCollapse>
      <StackCollapse open={view === 'archive' && !searching}><p className="empty-copy projects-note">{t('completedProjectNote')}</p></StackCollapse>

      {listed.length === 0 ? (
        <p className="empty-copy projects-empty">{snapshot.projects.length === 0 ? t('noProjectsYetTab') : t('noProjectsMatch')}</p>
      ) : canReorder ? (
        <Reorder.Group as="div" axis="y" className="project-cards" values={dragOrder} onReorder={(ids: string[]) => { dragOrderRef.current = ids; setDragOrder(ids) }}>
          <AnimatePresence initial={false}>
            {listed.map((project) => <ReorderCard key={project.id} id={project.id} onDrop={persistOrder} render={(controls) => renderCard(project, controls)} />)}
          </AnimatePresence>
        </Reorder.Group>
      ) : (
        <div className="project-cards">
          <AnimatePresence initial={false} mode="popLayout">
            {listed.map((project) => <motion.div key={project.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>{renderCard(project)}</motion.div>)}
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={shownConfirm?.kind === 'merge' ? t('mergeProjectTitle') : t('deleteProjectTitle')}
        body={<p>{shownConfirm?.kind === 'merge'
          ? t('mergeProjectBody').replaceAll('{from}', shownConfirm.project.name).replaceAll('{to}', shownConfirm.target?.name ?? '')
          : t('deleteProjectBody').replace('{name}', shownConfirm?.project.name ?? '')}</p>}
        confirmLabel={shownConfirm?.kind === 'merge' ? t('mergeAction') : t('confirmDelete')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={confirm ? error : undefined}
        onConfirm={() => void confirmAction()}
        onCancel={() => { setConfirm(null); setError('') }}
      />
    </motion.div>
  )
}

function ReorderCard({ id, onDrop, render }: { id: string; onDrop: () => void; render: (controls: ReturnType<typeof useDragControls>) => React.JSX.Element }): React.JSX.Element {
  const controls = useDragControls()
  return (
    <Reorder.Item as="div" value={id} dragListener={false} dragControls={controls} onDragEnd={onDrop} whileDrag={{ scale: 1.015, zIndex: 5 }} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
      {render(controls)}
    </Reorder.Item>
  )
}
