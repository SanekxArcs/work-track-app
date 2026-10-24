import { useState } from 'react'
import { Check, ListTodo, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { AppSnapshot } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { Collapse, ease, Fade, StackCollapse } from './Animated'
import { VoiceButton } from './VoiceButton'
import { ProjectPicker } from './ProjectPicker'
import { TimeInput } from './TimeInput'

interface PlannedTasksPanelProps {
  snapshot: AppSnapshot
  t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void
}

export function PlannedTasksPanel({ snapshot, t, onSnapshot }: PlannedTasksPanelProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [reminderTime, setReminderTime] = useState('')
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingProjectId, setEditingProjectId] = useState('')
  const [editingNotes, setEditingNotes] = useState('')
  const [editingReminderTime, setEditingReminderTime] = useState('')
  const [editError, setEditError] = useState('')
  const restRunning = snapshot.rests.some((rest) => rest.status === 'running')

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    setBusy(true)
    try {
      onSnapshot(await window.workBuddy.createPlannedTask({ title, projectId: projectId || null, reminderTime: reminderTime || null }))
      setTitle('')
      setReminderTime('')
      setProjectId('')
      setVoiceMessage('')
    } catch (error) {
      setVoiceMessage(errorText(error, t, 'saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      onSnapshot(await window.workBuddy.deletePlannedTask(id))
    } catch (error) {
      setVoiceMessage(errorText(error, t, 'saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  /** Starts tracking the planned task right away; attaching it completes the plan entry. */
  const start = async (task: AppSnapshot['plannedTasks'][number]): Promise<void> => {
    setBusy(true)
    try {
      onSnapshot(await window.workBuddy.startTask({ mode: 'parallel', title: task.title, notes: task.notes, projectId: task.projectId, plannedTaskId: task.id }))
    } catch (error) {
      setVoiceMessage(errorText(error, t, 'saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const addVoice = async (voice: import('@shared/types').VoiceInput): Promise<void> => {
    setBusy(true)
    setVoiceMessage('')
    try {
      const draft = await window.workBuddy.interpretPlannedVoice(voice)
      if (!draft.transcript.trim()) throw new Error(t('voiceNoText'))
      let resolvedProject = snapshot.projects.find((project) => project.id === (draft.projectId || projectId))
      if (!draft.projectId && draft.newProjectName) {
        const colors = snapshot.settings.projectColors.length ? snapshot.settings.projectColors : ['#b8e986', '#7cc7ff', '#f7b267']
        const updated = await window.workBuddy.createProject({ name: draft.newProjectName, color: colors[snapshot.projects.length % colors.length] })
        onSnapshot(updated)
        resolvedProject = updated.projects.find((project) => project.name.localeCompare(draft.newProjectName!, undefined, { sensitivity: 'base' }) === 0)
      }
      const notes = draft.notes?.trim() || ''
      const taskTitle = resolvedProject?.name || notes
      if (!taskTitle) throw new Error(t('voiceNoText'))
      onSnapshot(await window.workBuddy.createPlannedTask({
        title: taskTitle, notes, projectId: resolvedProject?.id ?? null,
        reminderTime: draft.startTime || reminderTime || null
      }))
      setVoiceMessage(t('voicePlannedAdded'))
    } finally {
      setBusy(false)
    }
  }

  const beginEdit = (task: AppSnapshot['plannedTasks'][number]): void => {
    setEditingId(task.id)
    setEditingTitle(task.title)
    setEditingProjectId(task.projectId ?? '')
    setEditingNotes(task.notes)
    setEditingReminderTime(task.reminderTime ?? '')
    setEditError('')
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setEditError('')
  }

  const saveEdit = async (): Promise<void> => {
    if (!editingId || !editingTitle.trim()) return
    setBusy(true)
    setEditError('')
    try {
      onSnapshot(await window.workBuddy.updatePlannedTask({ id: editingId, title: editingTitle, projectId: editingProjectId || null, notes: editingNotes, reminderTime: editingReminderTime || null }))
      setEditingId(null)
    } catch (error) {
      setEditError(errorText(error, t, 'saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return <motion.section className="panel planned-tasks-panel" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
    <div className="section-heading"><div><span className="eyebrow">{t('planEyebrow')}</span><h3>{t('plannedTasks')}</h3></div><ListTodo size={16} /></div>
    <div className="planned-task-add">
      <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void add() }} placeholder={t('plannedTaskPlaceholder')} />
      <TimeInput className="planned-task-time" value={reminderTime} onChange={setReminderTime} ariaLabel={t('plannedTaskReminder')} allowEmpty />
      <div className="planned-task-add__actions">
        <Fade show={Boolean(reminderTime)}><button className="icon-button icon-button--quiet" type="button" onClick={() => setReminderTime('')} title={t('clearReminder')} aria-label={t('clearReminder')}><X size={13} /></button></Fade>
        <button className="icon-button icon-button--accent" disabled={busy || !title.trim()} onClick={add} title={t('add')} aria-label={t('add')}><Plus size={16} /></button>
        {snapshot.settings.ai.enabled && snapshot.settings.ai.hasApiKey && <VoiceButton t={t} disabled={busy} onVoice={addVoice} onError={setVoiceMessage} />}
      </div>
    </div>
    <div className="planned-task-add-project"><ProjectPicker value={projectId} snapshot={snapshot} ariaLabel={t('project')} t={t} activeOnly onChange={setProjectId} onSnapshot={onSnapshot} onError={setVoiceMessage} /></div>
    <Collapse open={Boolean(voiceMessage)}><p className="planned-voice-status">{voiceMessage}</p></Collapse>
    {/* Not Collapse: its permanent overflow clip would cut off the inline project select while editing. */}
    <StackCollapse open={snapshot.plannedTasks.length > 0} gap={0}>
      <div className="planned-task-list">
        <AnimatePresence initial={false} mode="popLayout">
        {snapshot.plannedTasks.map((task) => {
          const project = snapshot.projects.find((item) => item.id === (editingId === task.id ? editingProjectId : task.projectId))
          const description = task.notes.trim() || (task.title !== project?.name ? task.title : '')
          const editing = editingId === task.id
          return <motion.div key={task.id} className={`planned-task-row ${editing ? 'planned-task-row--editing' : ''}`} style={project ? {
            background: `linear-gradient(116deg, ${project.color}26, ${project.color}0d 72%), rgba(25, 28, 24, .97)`,
            borderColor: `${project.color}66`
          } : undefined} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2, ease }}>
            <span style={{ background: project?.color ?? 'var(--accent)' }} />
            {editing ? <motion.div className="planned-task-editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease }}>
              <ProjectPicker value={editingProjectId} snapshot={snapshot} ariaLabel={t('project')} t={t} activeOnly onChange={setEditingProjectId} onSnapshot={onSnapshot} onError={setEditError} />
              <input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') cancelEdit() }} placeholder={t('plannedTaskPlaceholder')} />
              <div className="planned-task-reminder"><span>{t('plannedTaskReminder')}</span><TimeInput value={editingReminderTime} onChange={setEditingReminderTime} ariaLabel={t('plannedTaskReminder')} allowEmpty /><Fade show={Boolean(editingReminderTime)}><button className="icon-button icon-button--quiet" type="button" onClick={() => setEditingReminderTime('')} title={t('clearReminder')}><X size={12} /></button></Fade></div>
              <textarea value={editingNotes} onChange={(event) => setEditingNotes(event.target.value)} placeholder={t('notesPlaceholder')} rows={2} />
              <AnimatePresence initial={false}>{editError && <motion.small key="error" className="form-error" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>{editError}</motion.small>}</AnimatePresence>
              <div className="planned-task-editor-actions"><button className="icon-button icon-button--accent" disabled={busy || !editingTitle.trim()} onClick={() => void saveEdit()} title={t('save')}><Check size={14} /></button><button className="icon-button icon-button--quiet" disabled={busy} onClick={cancelEdit} title={t('cancel')}><X size={14} /></button></div>
            </motion.div> : <><div><strong>{project?.name || description || task.title}</strong>{project && description && <small className="planned-task-description">{description}</small>}{task.reminderTime && <small>{t('plannedTaskReminder')} · {task.reminderTime}</small>}</div><div className="planned-task-row-actions"><button className="icon-button planned-task-start" disabled={busy || restRunning} onClick={() => void start(task)} title={t('startPlannedTask')} aria-label={t('startPlannedTask')}><Play size={12} fill="currentColor" /></button><button className="icon-button icon-button--quiet" disabled={busy} onClick={() => beginEdit(task)} title={t('edit')}><Pencil size={13} /></button><button className="icon-button icon-button--quiet" disabled={busy} onClick={() => void remove(task.id)} title={t('deleteTask')}><Trash2 size={13} /></button></div></>}
          </motion.div>
        })}
        </AnimatePresence>
      </div>
    </StackCollapse>
  </motion.section>
}
