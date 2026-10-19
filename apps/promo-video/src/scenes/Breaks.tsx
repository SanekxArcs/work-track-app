import { useCurrentFrame } from 'remotion'
import { ActiveRest, AppFrame, FocusActions, FocusHero, Header, PROJECTS, RestDue, TabBar, TaskCard, type VideoTask } from '../ui/app'
import { Cursor, Words, compactDuration, pop, tween } from '../ui/kit'
import { Grow, Showcase } from '../ui/layout'
import { Backdrop, BottomFade, COLORS, DISPLAY_FONT, Eyebrow, SceneFade, subStyle, titleStyle } from '../ui/stage'

export const DUE = 14
export const START = 72

export const Breaks: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const resting = frame >= START
  const dueK = pop(frame, DUE, 20, 160) * (1 - tween(frame, START + 2, START + 9))
  const restK = pop(frame, START + 6, 20, 160)
  const elapsed = Math.max(0, frame - START) / 30 * 12
  const tasks: VideoTask[] = [
    { id: 'review', title: 'Review the checkout pull request', project: PROJECTS.northwind, seconds: 1350 + Math.min(frame, START) / 30, running: !resting },
    { id: 'bug', title: 'Fix flaky login test', project: PROJECTS.bugs, seconds: 3020 + Math.min(frame, START) / 30, running: !resting },
    { id: 'sync', title: 'Sprint sync with the team', project: PROJECTS.calls, seconds: 2245, running: false }
  ]
  const live = tasks.filter((task) => task.running)
  const chips = [['☕', 'Lunch reminders'], ['💧', 'Water'], ['🧘', 'Stretch'], ['👀', 'Eye rest']]

  return (
    <SceneFade frame={frame} duration={duration}>
      <Backdrop frame={frame} tint={COLORS.blue} second={COLORS.warm} />
      <Showcase x={250} y={70} scale={1.55} rotateY={12 - 6 * tween(frame, 0, duration)} rotateX={3} glow={COLORS.blue} opacity={tween(frame, 0, 12)}>
        <AppFrame height={640}>
          <Header label={<>Breaks today<b>{compactDuration(1260 + elapsed)}</b></>} />
          <div className="expanded-view">
            <TabBar active={0} />
            <div className="content-scroll" style={{ overflow: 'hidden' }}>
              <div className="page-stack" style={{ gap: 0 }}>
                {dueK > 0.001 && <Grow k={Math.min(1, dueK)} height={76} gap={12}><RestDue pressed={Math.abs(frame - START) < 4} /></Grow>}
                {restK > 0.001 && <Grow k={Math.min(1, restK)} height={150} gap={12}><ActiveRest remaining={300 - elapsed} progress={elapsed / 300} /></Grow>}
                <FocusHero frame={frame} eyebrow={resting ? 'Real work' : `${live.length} active now`} seconds={resting ? 4 * 3600 + 52 * 60 : live.reduce((sum, task) => sum + task.seconds, 0)} canPause={!resting} segments={[{ left: 0, width: 30, color: COLORS.blue }, { left: 34, width: 40, color: COLORS.warm }, { left: 78, width: 22, color: '#f6d365' }]} />
                <div style={{ height: 12 }} />
                <FocusActions live={!resting} />
                <div style={{ height: 12 }} />
                <div className="task-list">{tasks.map((task) => <TaskCard key={task.id} task={task} frame={frame} style={resting ? { opacity: 0.86 } : undefined} />)}</div>
              </div>
            </div>
          </div>
        </AppFrame>
        <Cursor frame={frame} path={[{ f: 30, x: 250, y: 420 }, { f: START, x: 362, y: 148 }, { f: duration, x: 300, y: 380 }]} clicks={[START]} scale={0.85} />
      </Showcase>

      <div style={{ position: 'absolute', left: 1030, top: 270, width: 800 }}>
        <Eyebrow color={COLORS.blue} style={{ opacity: tween(frame, 4, 18) }}>Healthy rhythm</Eyebrow>
        <Words frame={frame} at={10} text={'Breaks,\nlike a friend.'} gradientWords={['friend']} style={{ ...titleStyle, fontSize: 104, marginTop: 22 }} />
        <Words frame={frame} at={34} stagger={2} text={'Gentle nudges for breaks and lunch.\nTimers pause and come back with you.'} style={{ ...subStyle, fontSize: 30, marginTop: 30 }} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 44 }}>
          {chips.map(([icon, label], index) => {
            const k = pop(frame, 96 + index * 6, 16, 180)
            return <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 999, background: 'rgba(123,223,242,.08)', border: '1px solid rgba(123,223,242,.18)', color: COLORS.text, fontFamily: DISPLAY_FONT, fontSize: 21, fontWeight: 600, opacity: Math.min(1, k), transform: `translateY(${(1 - k) * 16}px) scale(${0.9 + 0.1 * Math.min(1, k)})` }}><span>{icon}</span>{label}</div>
          })}
        </div>
      </div>
      <BottomFade height={120} />
    </SceneFade>
  )
}
