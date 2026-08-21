import { useState } from 'react'
import { ListTodo, Plus, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { AppSnapshot } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { VoiceButton } from './VoiceButton'

interface PlannedTasksPanelProps {
  snapshot: AppSnapshot
  t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void
}

export function PlannedTasksPanel({ snapshot, t, onSnapshot }: PlannedTasksPanelProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState('')

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
          return <motion.div key={task.id} className="planned-task-row" layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 10 }}>
            <span style={{ background: project?.color ?? 'var(--accent)' }} />
            <div><strong>{task.title}</strong>{project && <small>{project.name}</small>}</div>
            <button className="icon-button icon-button--quiet" disabled={busy} onClick={() => void remove(task.id)} title={t('deleteTask')}><Trash2 size={13} /></button>
          </motion.div>
        })}
      </div>}
    </AnimatePresence>
  </motion.section>
}
