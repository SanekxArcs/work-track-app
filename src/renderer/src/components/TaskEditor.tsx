import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, FolderPlus, Sparkles, Trash2, X } from 'lucide-react'
import type { AppSnapshot, Project, StartMode, Task } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { CustomSelect } from './CustomSelect'
import { TimeInput } from './TimeInput'
import { VoiceButton } from './VoiceButton'

interface TaskEditorProps {
  open: boolean
  task?: Task
  defaultMode: StartMode
  snapshot: AppSnapshot
  t: Translator
  promptReason?: 'endday'
  onClose: () => void
  onSnapshot: (snapshot: AppSnapshot) => void
  onSaved: (snapshot: AppSnapshot) => void
}

export function TaskEditor({ open, task, defaultMode, snapshot, t, promptReason, onClose, onSnapshot, onSaved }: TaskEditorProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [plannedTaskId, setPlannedTaskId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
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
    setTitle(task?.title ?? '')
    setProjectId(task?.projectId ?? '')
    setPlannedTaskId(task?.plannedTaskId ?? '')
    setNotes(task?.notes ?? '')
    setTags(task?.tags.join(', ') ?? '')
    setAddingProject(false)
    setAiMessage('')
    setProjectColor(snapshot.settings.projectColors[0])
    const firstStart = task?.intervals.slice().sort((a, b) => a.startedAt - b.startedAt)[0]?.startedAt
    const finalEnd = task?.intervals.slice().sort((a, b) => b.startedAt - a.startedAt)[0]?.endedAt
    setStartTime(firstStart ? `${String(new Date(firstStart).getHours()).padStart(2, '0')}:${String(new Date(firstStart).getMinutes()).padStart(2, '0')}` : '')
    setEndTime(finalEnd ? `${String(new Date(finalEnd).getHours()).padStart(2, '0')}:${String(new Date(finalEnd).getMinutes()).padStart(2, '0')}` : '')
    setSaveError('')
  }, [open, task])

  const parsedTags = (): string[] => tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)

  const saveTask = async (mode: StartMode): Promise<void> => {
    if (!projectId) {
      setSaveError(t('projectRequired'))
      return
    }
    setBusy(true)
    setSaveError('')
    try {
      const firstStart = task?.intervals.slice().sort((a, b) => a.startedAt - b.startedAt)[0]?.startedAt
      const finalEnd = task?.intervals.slice().sort((a, b) => b.startedAt - a.startedAt)[0]?.endedAt
      let adjustedStart = firstStart
      let adjustedEnd = finalEnd
      if (firstStart && startTime) {
        const [hours, minutes] = startTime.split(':').map(Number)
        const date = new Date(firstStart)
        date.setHours(hours, minutes, 0, 0)
        adjustedStart = date.getTime()
      }
      if (finalEnd && endTime) {
        const [hours, minutes] = endTime.split(':').map(Number)
        const date = new Date(finalEnd)
        date.setHours(hours, minutes, 0, 0)
        adjustedEnd = date.getTime()
      }
      const result = task
        ? await window.workBuddy.updateTask({ id: task.id, title, projectId: projectId || null, plannedTaskId: plannedTaskId || null, notes, tags: parsedTags(), startedAt: adjustedStart, endedAt: adjustedEnd ?? undefined })
        : await window.workBuddy.startTask({ title, projectId: projectId || null, plannedTaskId: plannedTaskId || null, notes, tags: parsedTags(), mode })
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
    try {
      const result = await window.workBuddy.createProject({ name: newProject, color: projectColor })
      const created = result.projects.find((project: Project) => project.name.toLowerCase() === newProject.trim().toLowerCase())
      if (created) setProjectId(created.id)
      setNewProject('')
      setAddingProject(false)
      onSnapshot(result)
    } finally {
      setBusy(false)
    }
  }

  const selectPlannedTask = (id: string): void => {
    setPlannedTaskId(id)
    const planned = snapshot.plannedTasks.find((item) => item.id === id)
    if (!planned) return
    if (!title.trim()) setTitle(planned.title)
    if (!projectId && planned.projectId) setProjectId(planned.projectId)
    if (!notes.trim() && planned.notes) setNotes(planned.notes)
  }

  const suggestWithAi = async (): Promise<void> => {
    if (!task) return
    setAiBusy(true)
    setAiMessage('')
    try {
      const suggestion = await window.workBuddy.suggestTask(task.id)
      setTitle(suggestion.title)
      setProjectId(suggestion.projectId ?? '')
      setTags(suggestion.tags.join(', '))
      setAiMessage(suggestion.note)
    } catch (error) {
      setAiMessage(error instanceof Error ? error.message : t('aiError'))
    } finally {
      setAiBusy(false)
    }
  }

  const applyVoice = async (voice: import('@shared/types').VoiceInput): Promise<void> => {
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
      if (draft.title) setTitle(draft.title)
      if (resolvedProjectId) setProjectId(resolvedProjectId)
      if (draft.notes) setNotes(draft.notes)
      if (draft.tags) setTags(draft.tags.join(', '))
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
                <span className="eyebrow">{promptReason ? t('namingReview') : task ? t('edit') : t('startTask')}</span>
                <h2>{promptReason === 'endday' ? t('nameAtDayEnd') : task ? t('editTask') : t('newTask')}</h2>
              </div>
              <button className="icon-button" onClick={onClose}><X size={18} /></button>
            </div>

            {promptReason && <p className="naming-hint">{t('nameAtDayEnd')}</p>}

            <div className="task-identity-fields">
              <label className="field">
                <span>{t('taskName')}</span>
                <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('taskPlaceholder')} />
              </label>
              <label className="field">
                <span>{t('project')}</span>
                <CustomSelect
                  value={projectId}
                  ariaLabel={t('project')}
                  onChange={setProjectId}
                  options={[{ value: '', label: t('selectProject') }, ...snapshot.projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name, color: project.color }))]}
                />
              </label>
            </div>

            {task && startTime && (
              <div className={`task-time-fields ${endTime ? 'task-time-fields--complete' : ''}`}>
                <label className="field time-edit-field">
                  <span>{t('firstStartTime')}</span>
                  <TimeInput value={startTime} onChange={setStartTime} ariaLabel={t('firstStartTime')} />
                </label>
                {endTime && <label className="field time-edit-field"><span>{t('finishedAt')}</span><TimeInput value={endTime} onChange={setEndTime} ariaLabel={t('finishedAt')} /></label>}
                <small>{endTime ? t('taskTimeRangeBody') : t('firstStartTimeBody')}</small>
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
                <div className="color-dots">
                  {snapshot.settings.projectColors.map((color) => <button key={color} aria-label={color} className={projectColor === color ? 'selected' : ''} style={{ background: color }} onClick={() => setProjectColor(color)} />)}
                </div>
                <button className="icon-button icon-button--accent" onClick={createProject}><Check size={16} /></button>
              </div>
            )}

            <label className="field">
              <span>{t('notes')}</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('notesPlaceholder')} rows={3} />
            </label>

            <label className="field">
              <span>{t('tags')}</span>
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t('tagsPlaceholder')} />
            </label>

            {aiMessage && <p className="ai-note">{aiMessage}</p>}

            {saveError && <p className="form-error">{saveError}</p>}
            <div className="modal-actions">
              {task ? (
                <>
                  {snapshot.settings.ai.enabled && snapshot.settings.ai.hasApiKey && <div className="ai-editor-actions">
                    <button className="secondary-button ai-refine-button" disabled={aiBusy || busy} onClick={suggestWithAi}><Sparkles size={14} />{aiBusy ? t('aiThinking') : t('refineAi')}</button>
                    <VoiceButton t={t} disabled={aiBusy || busy} onVoice={applyVoice} onError={setAiMessage} />
                  </div>}
                  {promptReason && <button className="secondary-button" disabled={busy} onClick={onClose}>{t('skip')}</button>}
                  <button className="primary-button" disabled={busy || !projectId} onClick={() => saveTask(defaultMode)}>{t('save')}</button>
                </>
              ) : (
                <>
                  <button className="secondary-button" disabled={busy || !projectId} onClick={() => saveTask('switch')}>{t('startSwitch')}</button>
                  <button className="primary-button" disabled={busy || !projectId} onClick={() => saveTask(defaultMode)}>{t('startParallel')}</button>
                </>
              )}
            </div>
            {task && !promptReason && <button className="delete-task-button" disabled={busy} onClick={deleteTask}><Trash2 size={13} />{t('deleteTask')}</button>}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
