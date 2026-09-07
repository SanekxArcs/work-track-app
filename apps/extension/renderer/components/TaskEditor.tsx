import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from '../../lib/motion-shim'
import { Check, FolderPlus, Sparkles, Trash2, X } from 'lucide-react'
import type { AppSnapshot, Project, StartMode, Task } from '../../shared/types'
import type { Translator } from '../lib/i18n'
import { CustomSelect } from './CustomSelect'
import { ColorPicker } from './ColorPicker'
import { TimeInput } from './TimeInput'
import { VoiceButton } from './VoiceButton'

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

export function TaskEditor({ open, task, intervalId, defaultMode, snapshot, t, onClose, onSnapshot, onSaved }: TaskEditorProps): React.JSX.Element {
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

  useEffect(() => {
    if (!open) return
    setProjectId(task?.projectId ?? '')
    setPlannedTaskId(task?.plannedTaskId ?? '')
    setNotes(task?.notes ?? '')
    setAddingProject(false)
    setAiMessage('')
    setProjectColor(snapshot.settings.projectColors[0])
    const interval = editableInterval(task, intervalId)
    setStartTime(interval ? `${String(new Date(interval.startedAt).getHours()).padStart(2, '0')}:${String(new Date(interval.startedAt).getMinutes()).padStart(2, '0')}` : '')
    setEndTime(interval?.endedAt ? `${String(new Date(interval.endedAt).getHours()).padStart(2, '0')}:${String(new Date(interval.endedAt).getMinutes()).padStart(2, '0')}` : '')
    setSaveError('')
  }, [open, task, intervalId])

  const saveTask = async (mode: StartMode): Promise<void> => {
    setBusy(true)
    setSaveError('')
    try {
      const interval = editableInterval(task, intervalId)
      let adjustedStart = interval?.startedAt
      let adjustedEnd = interval?.endedAt
      if (interval && startTime) {
        const [hours, minutes] = startTime.split(':').map(Number)
        const date = new Date(interval.startedAt)
        date.setHours(hours, minutes, 0, 0)
        adjustedStart = date.getTime()
      }
      if (interval?.endedAt && endTime) {
        const [hours, minutes] = endTime.split(':').map(Number)
        const date = new Date(interval.endedAt)
        date.setHours(hours, minutes, 0, 0)
        adjustedEnd = date.getTime()
      }
      const result = task
        ? await window.workBuddy.updateTask({ id: task.id, intervalId: interval?.id, projectId: projectId || null, plannedTaskId: plannedTaskId || null, notes, tags: [], startedAt: adjustedStart, endedAt: adjustedEnd ?? undefined })
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

            <label className="field">
              <span>{t('project')}</span>
              <CustomSelect
                value={projectId}
                ariaLabel={t('project')}
                onChange={setProjectId}
                options={[{ value: '', label: t('noProject') }, ...snapshot.projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name, color: project.color }))]}
              />
            </label>

            {task && startTime && (
              <div className={`task-time-fields ${task.status !== 'running' && endTime ? 'task-time-fields--complete' : ''}`}>
                <label className="field time-edit-field">
                  <span>{t('firstStartTime')}</span>
                  <TimeInput value={startTime} onChange={setStartTime} ariaLabel={t('firstStartTime')} />
                </label>
                {task.status !== 'running' && endTime && <label className="field time-edit-field"><span>{t('finishedAt')}</span><TimeInput value={endTime} onChange={setEndTime} ariaLabel={t('finishedAt')} /></label>}
                <small>{task.status !== 'running' && endTime ? t('taskTimeRangeBody') : t('firstStartTimeBody')}</small>
              </div>
            )}

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
                  <button className="primary-button" disabled={busy} onClick={() => saveTask(defaultMode)}>{t('save')}</button>
                </>
              ) : (
                <>
                  <button className="secondary-button" disabled={busy} onClick={() => saveTask('switch')}>{t('startSwitch')}</button>
                  <button className="primary-button" disabled={busy} onClick={() => saveTask(defaultMode)}>{t('startParallel')}</button>
                </>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
