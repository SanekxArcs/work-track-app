import { motion } from 'motion/react'
import { Pause, Play } from 'lucide-react'
import type { Project, StartMode, Task } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { taskDuration } from '../lib/time'
import { AnimatedDuration, AnimatedText, ease, Swap } from './Animated'

interface TaskCardProps {
  task: Task
  projects: Project[]
  now: number
  t: Translator
  onPause: () => void
  onResume: (mode: StartMode) => void
  onEdit: () => void
  controlsDisabled?: boolean
}

export function TaskCard({ task, projects, now, t, onPause, onResume, onEdit, controlsDisabled = false }: TaskCardProps): React.JSX.Element {
  const project = projects.find((item) => item.id === task.projectId)
  const isRunning = task.status === 'running'
  const description = task.notes.trim() || task.title.trim()

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.24, ease }}
      className={`task-card ${isRunning ? 'task-card--running' : ''}`}
      style={{
        borderColor: project ? `${project.color}8c` : 'rgba(184, 233, 134, .22)',
        '--project-color': project?.color ?? '#b8e986',
        '--project-tint': project ? `${project.color}33` : 'rgba(184, 233, 134, .09)',
        '--project-glow': project ? `${project.color}2e` : 'rgba(184, 233, 134, .08)'
      } as React.CSSProperties}
      onDoubleClick={onEdit}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onEdit() }}
      tabIndex={0}
      title={t('doubleClickEdit')}
    >
      <div className="min-w-0 flex-1">
        <div className="task-card__heading">
          {project && (
            <div className="project-label">
              <span style={{ backgroundColor: project.color }} />
              {project.name}
            </div>
          )}
          {description && <h3>{description}</h3>}
        </div>

        <div className="task-time-row">
          <span className={`status-dot ${isRunning ? 'status-dot--live' : ''}`} />
          <AnimatedDuration className="task-time" ms={taskDuration(task, now)} />
          <AnimatedText className="task-status" text={isRunning ? t('running') : t('paused')} />
        </div>

      </div>
      <div className="task-card__controls no-drag" onDoubleClick={(event) => event.stopPropagation()}>
        <button
          disabled={controlsDisabled}
          className={`task-control ${isRunning ? 'task-control--pause' : 'task-control--play'}`}
          title={isRunning ? t('pause') : t('resume')}
          aria-label={isRunning ? t('pause') : t('resume')}
          onClick={(event) => { event.stopPropagation(); if (isRunning) onPause(); else onResume('parallel') }}
        >
          <Swap id={isRunning ? 'pause' : 'play'}>{isRunning ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</Swap>
        </button>
      </div>
    </motion.article>
  )
}
