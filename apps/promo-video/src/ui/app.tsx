import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, BarChart3, BriefcaseBusiness, ChevronUp, Clock3, Coffee, Dumbbell, GripVertical, ListTodo, Minus, Pause, Pin, Play, Plus, Settings2, SkipForward, Square, Pencil } from 'lucide-react'
import './app-styles.css'
import { Clock, LiveDot, compactDuration, hms } from './kit'

export interface Project { name: string; color: string }

export const PROJECTS = {
  checkout: { name: 'Checkout revamp', color: '#b8e986' },
  design: { name: 'Design system', color: '#cdb4db' },
  calls: { name: 'Team & calls', color: '#7bdff2' },
  bugs: { name: 'Bug bash', color: '#f7a072' },
  northwind: { name: 'Northwind store', color: '#f6d365' }
} satisfies Record<string, Project>

export interface VideoTask {
  id: string
  title: string
  project?: Project
  seconds: number
  running: boolean
  stopped?: boolean
}

/** Scales the 430px-wide app around its top-left corner. */
export function AppFrame({ width = 430, height, children, style, className = '' }: { width?: number; height: number; children: ReactNode; style?: CSSProperties; className?: string }): React.JSX.Element {
  return <main className={`wb app-shell ${className}`} style={{ width, height, ...style }}>{children}</main>
}

export function Header({ label, value, notch = false, style }: { label: ReactNode; value?: ReactNode; notch?: boolean; style?: CSSProperties }): React.JSX.Element {
  return (
    <header className={`app-header ${notch ? 'app-header--notch' : ''}`} style={style}>
      <div className="brand-lockup">
        <div className="brand-mark"><span /></div>
        <div className="brand-copy">
          <strong>Work Buddy</strong>
          <small className="brand-slide">{label}{value !== undefined && <b>{value}</b>}</small>
        </div>
      </div>
      <div className="window-actions">
        {notch ? <>
          <button className="icon-button icon-button--quiet notch-drag-handle"><GripVertical size={16} /></button>
          <button className="icon-button icon-button--quiet"><Pin size={15} /></button>
          <button className="icon-button icon-button--quiet"><Minus size={15} /></button>
        </> : <>
          <button className="icon-button icon-button--quiet"><ArrowUpToLine size={15} /></button>
          <button className="icon-button icon-button--quiet"><Minus size={15} /></button>
          <button className="icon-button icon-button--quiet"><ChevronUp size={16} /></button>
          <button className="icon-button icon-button--quiet"><ArrowRightToLine size={15} /></button>
        </>}
      </div>
    </header>
  )
}

const TABS = [
  { label: 'Focus', icon: Clock3 },
  { label: 'Day', icon: BarChart3 },
  { label: 'Projects', icon: BriefcaseBusiness },
  { label: 'Settings', icon: Settings2 }
]

/** `active` may be fractional while the pill glides between tabs. */
export function TabBar({ active }: { active: number }): React.JSX.Element {
  const inner = 430 - 28 - 8 - 2
  const unit = (inner - 40) / 3
  const left = (index: number): number => index * unit
  const widthOf = (index: number): number => (index === 3 ? 40 : unit)
  const lower = Math.floor(active)
  const t = active - lower
  const pillLeft = left(lower) + (left(Math.min(3, lower + 1)) - left(lower)) * t
  const pillWidth = widthOf(lower) + (widthOf(Math.min(3, lower + 1)) - widthOf(lower)) * t
  return (
    <nav className="tab-bar" style={{ position: 'relative' }}>
      <span className="tab-pill" style={{ position: 'absolute', inset: 'auto', top: 4, bottom: 4, left: 4 + pillLeft, width: pillWidth, zIndex: 0 }} />
      {TABS.map(({ label, icon: Icon }, index) => (
        <button key={label} className={`${Math.round(active) === index ? 'active' : ''} ${index === 3 ? 'tab-icon-only' : ''}`} style={{ zIndex: 1 }}>
          <Icon size={15} />{index !== 3 && <span>{label}</span>}
        </button>
      ))}
    </nav>
  )
}

export interface Segment { left: number; width: number; color: string }

export function FocusHero({ eyebrow, seconds, segments, frame, canPause = true }: { eyebrow: string; seconds: number; segments: Segment[]; frame: number; canPause?: boolean }): React.JSX.Element {
  return (
    <section className="focus-hero">
      <div className="focus-hero__top">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <strong><Clock seconds={seconds} /></strong>
        </div>
        <div className="focus-hero__actions">
          <button disabled={!canPause}><Pause size={17} fill="currentColor" /><span>Pause all</span></button>
        </div>
      </div>
      <div className="focus-timeline">
        {segments.map((segment, index) => <span key={index} style={{ left: `${segment.left}%`, width: `${Math.max(segment.width, 0.6)}%`, background: segment.color }} />)}
      </div>
      <span style={{ display: 'none' }}>{frame}</span>
    </section>
  )
}

export function FocusActions({ live, pressed, showSwitch = true, planned = false }: { live: boolean; pressed?: 'parallel' | 'switch' | 'break'; showSwitch?: boolean; planned?: boolean }): React.JSX.Element {
  const press = (id: string): CSSProperties => (pressed === id ? { transform: 'scale(.96)', filter: 'brightness(1.12)' } : {})
  return (
    <div className="focus-actions">
      <div className="focus-actions__primary">
        <button className="primary-button" style={press('parallel')}><Plus size={17} />{live ? 'Parallel' : 'Start a task'}</button>
        {live && showSwitch && <button className="secondary-button" style={press('switch')}>Switch</button>}
      </div>
      <div className="focus-actions__tools">
        <button className="secondary-button" style={press('break')}><Dumbbell size={15} />Take a break</button>
        <button className={`secondary-button planned-toggle ${planned ? 'active' : ''}`}><ListTodo size={15} />Planned tasks</button>
      </div>
    </div>
  )
}

export function TaskCard({ task, frame, pressed = false, style }: { task: VideoTask; frame: number; pressed?: boolean; style?: CSSProperties }): React.JSX.Element {
  const project = task.project
  const status = task.running ? 'Running' : task.stopped ? 'Completed' : 'Paused'
  return (
    <article
      className={`task-card ${task.running ? 'task-card--running' : ''}`}
      style={{
        borderColor: project ? `${project.color}8c` : 'rgba(184, 233, 134, .22)',
        '--project-color': project?.color ?? '#b8e986',
        '--project-tint': project ? `${project.color}33` : 'rgba(184, 233, 134, .09)',
        '--project-glow': project ? `${project.color}2e` : 'rgba(184, 233, 134, .08)',
        ...style
      } as CSSProperties}
    >
      <div className="min-w-0 flex-1">
        <div className="task-card__heading">
          {project && <div className="project-label"><span style={{ backgroundColor: project.color }} />{project.name}</div>}
          <h3>{task.title}</h3>
        </div>
        <div className="task-time-row">
          <LiveDot frame={frame} live={task.running} />
          <Clock className="task-time" seconds={task.seconds} />
          <span className="task-status">{status}</span>
        </div>
      </div>
      <div className="task-card__controls">
        <button className={`task-control ${task.running ? 'task-control--pause' : 'task-control--play'}`} style={pressed ? { transform: 'scale(.92)' } : undefined}>
          {task.running ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
      </div>
    </article>
  )
}

export function CompactRow({ task, frame, extra = false, windowActions = true, style }: { task: VideoTask; frame: number; extra?: boolean; windowActions?: boolean; style?: CSSProperties }): React.JSX.Element {
  return (
    <div className={`compact-task-row ${extra ? 'compact-task-row--extra' : ''}`} style={style}>
      <div className="compact-task-info">
        <LiveDot frame={frame} live={task.running} />
        <div><strong>{task.title}</strong><small><Clock seconds={task.seconds} /></small></div>
      </div>
      <div className="compact-task-actions">
        {task.running ? <button><Pause size={16} fill="currentColor" /></button> : <button className="play"><Play size={16} fill="currentColor" /></button>}
      </div>
      {windowActions && <div className="compact-window-actions">
        <button><Plus size={17} /></button>
        <button><ArrowUpToLine size={17} /></button>
        <button><Minus size={17} /></button>
        <button><ArrowRightToLine size={17} /></button>
        <button><ChevronUp size={17} style={{ transform: 'rotate(180deg)' }} /></button>
      </div>}
    </div>
  )
}

export function DockPill({ side, seconds, live, frame }: { side: 'left' | 'right'; seconds: number; live: boolean; frame: number }): React.JSX.Element {
  const Icon = side === 'left' ? ArrowRightToLine : ArrowLeftToLine
  const drag = <div className="dock-drag"><LiveDot frame={frame} live={live} /><strong><Clock seconds={seconds} format={(s) => hms(s).slice(0, 5)} /></strong></div>
  const open = <button className="dock-open"><Icon size={15} /></button>
  return <div className="wb" style={{ width: 104, height: 46 }}><div className={`dock-pill dock-pill--${side}`}>{side === 'left' ? <>{drag}{open}</> : <>{open}{drag}</>}</div></div>
}

/** The collapsed notch: a dark pill hanging from the top edge. */
export function NotchPill({ label, value, live, frame }: { label: ReactNode; value: ReactNode; live: boolean; frame: number }): React.JSX.Element {
  return (
    <div className="notch-pill-row">
      <button className="icon-button icon-button--quiet notch-drag-handle"><GripVertical size={16} /></button>
      <button className="notch-pill">
        <LiveDot frame={frame} live={live} size={5} style={{ boxShadow: 'none' }} />
        <span className="notch-pill__slide"><span className="notch-pill__label">{label}</span><b>{value}</b></span>
      </button>
    </div>
  )
}

export function RestDue({ pressed = false }: { pressed?: boolean }): React.JSX.Element {
  return (
    <section className="rest-due rest-due--break">
      <div className="rest-due__icon"><Dumbbell size={18} /></div>
      <div><strong>You earned a break 👋</strong><p>It won't count itself. Take a few minutes and reset a little.</p></div>
      <div className="rest-due__actions">
        <button className="rest-due__start" style={pressed ? { transform: 'scale(.94)' } : undefined}><Play size={14} fill="currentColor" />Start break</button>
        <button className="rest-due__skip"><SkipForward size={13} />Skip for today</button>
      </div>
    </section>
  )
}

export function ActiveRest({ remaining, progress, lunch = false }: { remaining: number; progress: number; lunch?: boolean }): React.JSX.Element {
  const Icon = lunch ? Coffee : Dumbbell
  return (
    <section className={`active-rest active-rest--${lunch ? 'lunch' : 'break'}`}>
      <div className="active-rest__top">
        <div className="active-rest__identity"><span><Icon size={18} /></span><div><small>Resting now</small><strong>{lunch ? 'Lunch' : 'Break'}</strong></div></div>
        <button className="active-rest__clock"><span><Clock seconds={remaining} /></span><Pencil size={11} /></button>
      </div>
      <div className="active-rest__progress"><span style={{ width: `${progress * 100}%` }} /></div>
      <p>Work tasks are paused. I'll bring them back when you finish.</p>
      <div className="active-rest__actions">
        <button><Pause size={15} fill="currentColor" />Pause</button>
        <button className="rest-finish"><Square size={13} fill="currentColor" />Finish</button>
      </div>
    </section>
  )
}

export function headerSlide(worked: number, live: number): { label: string; value: string } {
  return live > 0 && Math.floor(worked / 5) % 2 === 1 ? { label: 'running now', value: String(live) } : { label: 'Worked today', value: compactDuration(worked) }
}

export const DESK_TASKS = (frame: number): VideoTask[] => {
  const t = frame / 30
  return [
    { id: 'review', title: 'Code review: payment flow', project: PROJECTS.checkout, seconds: 1724 + t, running: true },
    { id: 'bug', title: 'Fix flaky login test', project: PROJECTS.bugs, seconds: 2671 + t, running: true },
    { id: 'sync', title: 'Sprint sync with the team', project: PROJECTS.calls, seconds: 2245, running: false }
  ]
}

/** The whole Focus page: header, tabs, hero, actions and the task list. */
export function FocusApp({ frame, tasks, header, notch = false, height }: { frame: number; tasks: VideoTask[]; header: ReactNode; notch?: boolean; height?: number }): React.JSX.Element {
  const live = tasks.filter((task) => task.running)
  return (
    <div style={{ width: 430, height, display: 'flex', flexDirection: 'column' }}>
      <Header label={header} notch={notch} />
      <div className="expanded-view">
        <TabBar active={0} />
        <div className="content-scroll" style={{ overflow: 'hidden' }}>
          <div className="page-stack">
            <FocusHero frame={frame} eyebrow={`${live.length} active now`} seconds={live.reduce((sum, task) => sum + task.seconds, 0)} segments={[
              { left: 0, width: 16, color: '#7bdff2' }, { left: 18, width: 22, color: '#b8e986' }, { left: 31, width: 12, color: '#f7a072' },
              { left: 46, width: 20, color: '#cdb4db' }, { left: 68, width: 14, color: '#7bdff2' }, { left: 80, width: 20, color: '#b8e986' }, { left: 86, width: 14, color: '#f7a072' }
            ]} />
            <FocusActions live={live.length > 0} />
            <div className="task-list">{tasks.map((task) => <TaskCard key={task.id} task={task} frame={frame} />)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
