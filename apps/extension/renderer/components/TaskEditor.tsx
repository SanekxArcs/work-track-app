import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from '../../lib/motion-shim'
import { Check, FolderPlus, Scissors, GitMerge, Sparkles, Trash2, X } from 'lucide-react'
import type { AppSnapshot, Project, StartMode, Task, TaskIntervalOperation } from '../../shared/types'
import { applyIntervalOperations } from '../../shared/task-intervals'
import type { Translator } from '../lib/i18n'
import { CustomSelect } from './CustomSelect'
import { ColorPicker } from './ColorPicker'
import { TimeInput } from './TimeInput'
import { formatDuration } from '../lib/time'
import { VoiceButton } from './VoiceButton'
import { TaskSplit } from './TaskSplit'

interface TaskEditorProps {
  open: boolean
  task?: Task
  intervalId?: string
  defaultMode: StartMode
  snapshot: AppSnapshot
  t: Translator
  onClose: () => void
  onSnapshot: (snapshot: AppSnapshot) => void
  onSaved: (snapshot: AppSnapshot) => void
}

function editableInterval(task: Task | undefined, intervalId: string | undefined): Task['intervals'][number] | undefined {
  if (!task) return undefined
  return (intervalId ? task.intervals.find((interval) => interval.id === intervalId) : undefined)
    ?? task.intervals.slice().sort((first, second) => second.startedAt - first.startedAt)[0]
}

function clockValue(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** A new timestamp only when the HH:MM was edited; otherwise undefined keeps the exact original. */
function editedTimestamp(original: number, value: string): number | undefined {
  if (!value || value === clockValue(original)) return undefined
  const [hours, minutes] = value.split(':').map(Number)
  const date = new Date(original)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

export function TaskEditor({ open, task, intervalId, defaultMode, snapshot, t, onClose, onSnapshot, onSaved }: TaskEditorProps): React.JSX.Element {
  const [splitOpen, setSplitOpen] = useState(false)
  const [projectId, setProjectId] = useState<string>('')
  const [plannedTaskId, setPlannedTaskId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [newProject, setNewProject] = useState('')
  const [projectColor, setProjectColor] = useState(snapshot.settings.projectColors[0])
  const [addingProject, setAddingProject] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [saveError, setSaveError] = useState('')
  const [advancedTime, setAdvancedTime] = useState(false)
  const [intervalOperations, setIntervalOperations] = useState<TaskIntervalOperation[]>([])
  const [intervalDraftTask, setIntervalDraftTask] = useState<Task | undefined>()
  const [selectedRangeId, setSelectedRangeId] = useState<string | undefined>()
  const timeRanges = applyIntervalOperations(task?.intervals ?? [], intervalDraftTask === task ? intervalOperations : [])
  const currentRange = timeRanges.find((range) => range.id === selectedRangeId) ?? timeRanges.at(-1)
  const [rangeTimes, setRangeTimes] = useState<Record<string, { start: string; end: string }>>({})

  useEffect(() => {
    if (!open) return
    setProjectId(task?.projectId ?? '')
    setPlannedTaskId(task?.plannedTaskId ?? '')
    setNotes(task?.notes ?? '')
    setAddingProject(false)
    setAiMessage('')
    setProjectColor(snapshot.settings.projectColors[0])
    setAdvancedTime(false)
    setIntervalDraftTask(task)
    setIntervalOperations([])
    setRangeTimes(Object.fromEntries((task?.intervals ?? []).map((range) => [range.id, { start: clockValue(range.startedAt), end: range.endedAt === null ? '' : clockValue(range.endedAt) }])))
    const interval = editableInterval(task, intervalId)
    setSelectedRangeId(interval?.id)
    setStartTime(interval ? clockValue(interval.startedAt) : '')
    setEndTime(interval?.endedAt ? clockValue(interval.endedAt) : '')
    setSaveError('')
  }, [open, task, intervalId])

  const changeIntervals = (operation: TaskIntervalOperation): void => {
    if (!task) return
    const drafts = { ...rangeTimes }
    if (currentRange) drafts[currentRange.id] = { start: startTime, end: endTime }
    if (operation.type === 'merge') {
      drafts[operation.firstId] = { start: drafts[operation.firstId].start, end: drafts[operation.secondId].end }
    }
    const operations = [...intervalOperations, operation]
    const remaining = applyIntervalOperations(task.intervals, operations)
    const next = remaining.find((range) => range.id === currentRange?.id)
      ?? (operation.type === 'merge' ? remaining.find((range) => range.id === operation.firstId) : undefined)
      ?? remaining.at(-1)
    setIntervalOperations(operations)
    setRangeTimes(drafts)
    setSelectedRangeId(next?.id)
    setStartTime(next ? drafts[next.id].start : '')
    setEndTime(next ? drafts[next.id].end : '')
    setSaveError('')
  }

  const resetTimeEdits = (): void => {
    setIntervalOperations([])
    setRangeTimes(Object.fromEntries((task?.intervals ?? []).map((range) => [range.id, { start: clockValue(range.startedAt), end: range.endedAt === null ? '' : clockValue(range.endedAt) }])))
    const interval = editableInterval(task, intervalId)
    setSelectedRangeId(interval?.id)
    setStartTime(interval ? clockValue(interval.startedAt) : '')
    setEndTime(interval?.endedAt ? clockValue(interval.endedAt) : '')
    setSaveError('')
  }

  const saveTask = async (mode: StartMode): Promise<void> => {
    setBusy(true)
    setSaveError('')
    try {
      const interval = currentRange
      const intervalUpdates = timeRanges.map((range) => {
        const draft = range.id === interval?.id ? { start: startTime, end: endTime } : rangeTimes[range.id]
        return { id: range.id, startedAt: draft ? editedTimestamp(range.startedAt, draft.start) : undefined, endedAt: range.endedAt !== null && draft ? editedTimestamp(range.endedAt, draft.end) : undefined }
      }).filter((range) => range.startedAt !== undefined || range.endedAt !== undefined)
      const result = task
        ? await window.workBuddy.updateTask({ id: task.id, intervalUpdates, intervalOperations, projectId: projectId || null, plannedTaskId: plannedTaskId || null, notes, tags: [] })
        : await window.workBuddy.startTask({ projectId: projectId || null, plannedTaskId: plannedTaskId || null, notes, tags: [], mode })
      onSaved(result)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('timeUpdateError'))
    } finally {
      setBusy(false)
    }
  }

  const createProject = async (): Promise<void> => {
    if (!newProject.trim()) return
    setBusy(true)
    setSaveError('')
    try {
      const result = await window.workBuddy.createProject({ name: newProject, color: projectColor })
      const created = result.projects.find((project: Project) => project.name.toLowerCase() === newProject.trim().toLowerCase())
      if (created) setProjectId(created.id)
      setNewProject('')
      setAddingProject(false)
      onSnapshot(result)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('timeUpdateError'))
    } finally {
      setBusy(false)
    }
  }

  const selectPlannedTask = (id: string): void => {
    setPlannedTaskId(id)
    const planned = snapshot.plannedTasks.find((item) => item.id === id)
    if (!planned) return
    if (!projectId && planned.projectId) setProjectId(planned.projectId)
    if (!notes.trim() && planned.notes) setNotes(planned.notes)
  }

  const suggestWithAi = async (): Promise<void> => {
    if (!task) return
    setAiBusy(true)
    setAiMessage('')
    try {
      const suggestion = await window.workBuddy.suggestTask(task.id)
      setProjectId(suggestion.projectId ?? '')
      setNotes(suggestion.notes)
      setAiMessage('')
    } catch (error) {
      setAiMessage(error instanceof Error ? error.message : t('aiError'))
    } finally {
      setAiBusy(false)
    }
  }

  const applyVoice = async (voice: import('../../shared/types').VoiceInput): Promise<void> => {
    setAiBusy(true)
    setAiMessage('')
    try {
      const draft = await window.workBuddy.interpretVoiceTask(voice, task?.id)
      let resolvedProjectId = draft.projectId
      if (!resolvedProjectId && draft.newProjectName) {
        const existing = snapshot.projects.find((project) => project.name.localeCompare(draft.newProjectName!, undefined, { sensitivity: 'base' }) === 0)
        if (existing) resolvedProjectId = existing.id
        else {
          const colors = snapshot.settings.projectColors
          const result = await window.workBuddy.createProject({ name: draft.newProjectName, color: colors[snapshot.projects.length % colors.length] })
          const created = result.projects.find((project) => project.name.localeCompare(draft.newProjectName!, undefined, { sensitivity: 'base' }) === 0)
          if (created) resolvedProjectId = created.id
          onSnapshot(result)
        }
      }
      if (resolvedProjectId) setProjectId(resolvedProjectId)
      if (draft.notes) setNotes(draft.notes)
      if (draft.startTime) setStartTime(draft.startTime)
      if (draft.endTime) setEndTime(draft.endTime)
      setAiMessage(draft.transcript ? `${t('voiceApplied')} ${draft.transcript}` : t('voiceApplied'))
    } finally {
      setAiBusy(false)
    }
  }

  const deleteTask = async (): Promise<void> => {
    if (!task || !window.confirm(t('deleteTaskConfirm'))) return
    setBusy(true)
    try {
      onSaved(await window.workBuddy.deleteTask(task.id))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('deleteTaskError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop no-drag" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className="modal-sheet" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 300 }}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">{task ? t('edit') : t('startTask')}</span>
                <h2>{task ? t('editTask') : t('newTask')}</h2>
              </div>
              <button className="icon-button" onClick={onClose}><X size={18} /></button>
            </div>

            {splitOpen && task ? <TaskSplit task={{ ...task, projectId: projectId || null, notes }} snapshot={snapshot} t={t} onCancel={() => setSplitOpen(false)} onSaved={onSaved} onSnapshot={onSnapshot} /> : <>
            <label className="field">
              <span>{t('project')}</span>
              <CustomSelect
                value={projectId}
                ariaLabel={t('project')}
                onChange={setProjectId}
                options={[{ value: '', label: t('noProject') }, ...snapshot.projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name, color: project.color }))]}
              />
            </label>

            {task && !advancedTime && startTime && (
              <div className={`task-time-fields ${currentRange?.endedAt !== null && endTime ? 'task-time-fields--complete' : ''}`}>
                <label className="field time-edit-field">
                  <span>{t('firstStartTime')}</span>
                  <TimeInput value={startTime} onChange={setStartTime} ariaLabel={t('firstStartTime')} />
                </label>
                {currentRange?.endedAt !== null && endTime && <label className="field time-edit-field"><span>{t('finishedAt')}</span><TimeInput value={endTime} onChange={setEndTime} ariaLabel={t('finishedAt')} /></label>}
                <small>{currentRange?.endedAt !== null && endTime ? t('taskTimeRangeBody') : t('firstStartTimeBody')}</small>
              </div>
            )}

            {task && advancedTime && <div id="task-time-ranges" className="task-time-ranges">
              <p className="time-ranges-description">{t('allTimeRangesBody')}</p>
              {!timeRanges.length && <p className="time-ranges-description">{t('noTimeRanges')}</p>}
              {timeRanges.map((range, index) => {
                const selected = range.id === currentRange?.id
                const draft = selected ? { start: startTime, end: endTime } : rangeTimes[range.id]
                if (!draft) return null
                const change = (part: 'start' | 'end', value: string): void => {
                  setRangeTimes((previous) => ({ ...previous, [range.id]: { ...draft, [part]: value } }))
                  if (selected) { if (part === 'start') setStartTime(value); else setEndTime(value) }
                }
                const start = editedTimestamp(range.startedAt, draft.start) ?? range.startedAt
                const end = range.endedAt === null ? Date.now() : editedTimestamp(range.endedAt, draft.end) ?? range.endedAt
                return <section key={range.id} className="task-time-range">
                  <div className="task-time-range__heading"><strong>{t('timeRange')} {index + 1}</strong><span>{formatDuration(Math.max(0, end - start))}</span></div>
                  <div className="task-time-fields task-time-fields--complete">
                    <label className="field time-edit-field"><span>{t('firstStartTime')} · {new Date(range.startedAt).toLocaleDateString(snapshot.settings.locale === 'uk' ? 'uk-UA' : 'en-GB')}</span><TimeInput value={draft.start} onChange={(value) => change('start', value)} ariaLabel={t('firstStartTime') + ' ' + (index + 1)} /></label>
                    {range.endedAt !== null ? <label className="field time-edit-field"><span>{t('finishedAt')} · {new Date(range.endedAt).toLocaleDateString(snapshot.settings.locale === 'uk' ? 'uk-UA' : 'en-GB')}</span><TimeInput value={draft.end} onChange={(value) => change('end', value)} ariaLabel={t('finishedAt') + ' ' + (index + 1)} /></label> : <div className="time-range-running">{t('running')}</div>}
                  </div>

                  <div className="task-time-range__actions">
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => changeIntervals({ type: 'delete', id: range.id })}><Trash2 size={13} />{t('deleteTimeRange')}</button>
                    {index < timeRanges.length - 1 && <button type="button" className="secondary-button" disabled={busy} onClick={() => changeIntervals({ type: 'merge', firstId: range.id, secondId: timeRanges[index + 1].id })}><GitMerge size={13} />{t('mergeNextRange')}</button>}
                  </div>
                </section>
              })}
            </div>}
            {task && task.intervals.length > 0 && <div className="advanced-time-toggle">
              <button type="button" className="secondary-button" disabled={busy} aria-expanded={advancedTime} aria-controls="task-time-ranges" onClick={() => setAdvancedTime(!advancedTime)}>{advancedTime ? t('basicTime') : t('advancedTime')}</button>
              {intervalOperations.length > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={resetTimeEdits}>{t('resetRangeEdits')}</button>}
            </div>}

            <label className="field">
              <span>{t('plannedTask')}</span>
              <CustomSelect
                value={plannedTaskId}
                ariaLabel={t('plannedTask')}
                onChange={selectPlannedTask}
                options={[{ value: '', label: t('noPlannedTask') }, ...snapshot.plannedTasks.map((item) => ({ value: item.id, label: item.title, description: snapshot.projects.find((project) => project.id === item.projectId)?.name }))]}
              />
            </label>

            {!addingProject ? (
              <button className="link-button" onClick={() => setAddingProject(true)}><FolderPlus size={15} />{t('newProject')}</button>
            ) : (
              <div className="new-project-row">
                <input value={newProject} onChange={(event) => setNewProject(event.target.value)} placeholder={t('projectName')} />
                <ColorPicker value={projectColor} colors={snapshot.settings.projectColors} onChange={setProjectColor} ariaLabel={t('projectPalette')} />
                <button className="icon-button icon-button--accent" onClick={createProject}><Check size={16} /></button>
              </div>
            )}

            <label className="field">
              <span>{t('notes')}</span>
              <textarea autoFocus value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('notesPlaceholder')} rows={3} />
            </label>

            {aiMessage && <p className="ai-note">{aiMessage}</p>}

            {saveError && <p className="form-error">{saveError}</p>}
            <div className="modal-actions">
              {task ? (
                <>
                  <button className="icon-button icon-button--quiet delete-task-icon" disabled={busy} onClick={deleteTask} title={t('deleteTask')} aria-label={t('deleteTask')}><Trash2 size={15} /></button>
                  {snapshot.settings.ai.enabled && snapshot.settings.ai.hasApiKey && <div className="ai-editor-actions">
                    {notes.trim() && <button className="secondary-button ai-refine-button" disabled={aiBusy || busy} onClick={suggestWithAi}><Sparkles size={14} />{aiBusy ? t('aiThinking') : t('refineAi')}</button>}
                    <VoiceButton t={t} disabled={aiBusy || busy} onVoice={applyVoice} onError={setAiMessage} />
                  </div>}
                  {task.intervals.length > 0 && <button className="secondary-button" disabled={busy} onClick={() => setSplitOpen(true)}><Scissors size={14} />{t('splitTask')}</button>}
                  <button className="primary-button" disabled={busy} onClick={() => saveTask(defaultMode)}>{t('save')}</button>
                </>
              ) : (
                <>
                  <button className="secondary-button" disabled={busy} onClick={() => saveTask('switch')}>{t('startSwitch')}</button>
                  <button className="primary-button" disabled={busy} onClick={() => saveTask(defaultMode)}>{t('startParallel')}</button>
                </>
              )}
            </div>
            </>}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
