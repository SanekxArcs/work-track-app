import { useState } from 'react'
import { Check, ListTodo, Pencil, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { AppSnapshot } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { VoiceButton } from './VoiceButton'
import { CustomSelect } from './CustomSelect'

interface PlannedTasksPanelProps {
  snapshot: AppSnapshot
  t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void
}

export function PlannedTasksPanel({ snapshot, t, onSnapshot }: PlannedTasksPanelProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingProjectId, setEditingProjectId] = useState('')
  const [editingNotes, setEditingNotes] = useState('')
  const [editError, setEditError] = useState('')

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    setBusy(true)
    try {
      onSnapshot(await window.workBuddy.createPlannedTask({ title }))
      setTitle('')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      onSnapshot(await window.workBuddy.deletePlannedTask(id))
    } finally {
      setBusy(false)
    }
  }

  const addVoice = async (voice: import('@shared/types').VoiceInput): Promise<void> => {
    setBusy(true)
    setVoiceMessage('')
    try {
      const spokenTitle = await window.workBuddy.transcribeVoice(voice)
      if (!spokenTitle.trim()) throw new Error(t('voiceNoText'))
      onSnapshot(await window.workBuddy.createPlannedTask({ title: spokenTitle.trim() }))
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
      onSnapshot(await window.workBuddy.updatePlannedTask({ id: editingId, title: editingTitle, projectId: editingProjectId || null, notes: editingNotes }))
      setEditingId(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return <motion.section className="panel planned-tasks-panel" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
    <div className="section-heading"><div><span className="eyebrow">Plan</span><h3>{t('plannedTasks')}</h3></div><ListTodo size={16} /></div>
    <p>{t('plannedTasksBody')}</p>
    <div className="planned-task-add">
      <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void add() }} placeholder={t('plannedTaskPlaceholder')} />
      <button className="icon-button icon-button--accent" disabled={busy || !title.trim()} onClick={add} title={t('add')}><Plus size={16} /></button>
      {snapshot.settings.ai.enabled && snapshot.settings.ai.hasApiKey && <VoiceButton t={t} disabled={busy} onVoice={addVoice} onError={setVoiceMessage} />}
    </div>
    {voiceMessage && <p className="planned-voice-status">{voiceMessage}</p>}
    <AnimatePresence initial={false}>
      {snapshot.plannedTasks.length > 0 && <div className="planned-task-list">
        {snapshot.plannedTasks.map((task) => {
          const project = snapshot.projects.find((item) => item.id === task.projectId)
          const editing = editingId === task.id
          return <motion.div key={task.id} className={`planned-task-row ${editing ? 'planned-task-row--editing' : ''}`} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 10 }}>
            <span style={{ background: project?.color ?? 'var(--accent)' }} />
            {editing ? <div className="planned-task-editor">
              <input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') cancelEdit() }} placeholder={t('plannedTaskPlaceholder')} />
              <CustomSelect value={editingProjectId} ariaLabel={t('project')} onChange={setEditingProjectId} options={[{ value: '', label: t('noProject') }, ...snapshot.projects.filter((item) => !item.archived).map((item) => ({ value: item.id, label: item.name, color: item.color }))]} />
              <textarea value={editingNotes} onChange={(event) => setEditingNotes(event.target.value)} placeholder={t('notesPlaceholder')} rows={2} />
              {editError && <small className="form-error">{editError}</small>}
              <div className="planned-task-editor-actions"><button className="icon-button icon-button--accent" disabled={busy || !editingTitle.trim()} onClick={() => void saveEdit()} title={t('save')}><Check size={14} /></button><button className="icon-button icon-button--quiet" disabled={busy} onClick={cancelEdit} title={t('cancel')}><X size={14} /></button></div>
            </div> : <><div><strong>{task.title}</strong>{project && <small>{project.name}</small>}{task.notes && <small>{task.notes}</small>}</div><div className="planned-task-row-actions"><button className="icon-button icon-button--quiet" disabled={busy} onClick={() => beginEdit(task)} title={t('edit')}><Pencil size={13} /></button><button className="icon-button icon-button--quiet" disabled={busy} onClick={() => void remove(task.id)} title={t('deleteTask')}><Trash2 size={13} /></button></div></>}
          </motion.div>
        })}
      </div>}
    </AnimatePresence>
  </motion.section>
}
