import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { AppFrame, FocusActions, FocusHero, Header, PROJECTS, TabBar, TaskCard, type VideoTask } from '../ui/app'
import { Cursor, compactDuration, pop, tween } from '../ui/kit'
import { Grow, Showcase, Slides } from '../ui/layout'
import { Backdrop, BottomFade, COLORS, Eyebrow, SceneFade, subStyle, titleStyle } from '../ui/stage'
import { Words } from '../ui/kit'

const FPS = 30
const ADD_REVIEW = 62
const ADD_BUG = 112
const PAUSE_SYNC = 178
const SWITCH = 232

/** Seconds a task has run by `frame`, given when it (re)started and stopped, in frames. */
function runSeconds(frame: number, base: number, spans: Array<[number, number]>): number {
  return base + spans.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(frame, end) - start), 0) / FPS
}

export function tasksAt(frame: number): Array<VideoTask & { enter: number }> {
  const never = 1e9
  const sync: VideoTask = { id: 'sync', title: 'Sprint sync with the team', project: PROJECTS.calls, seconds: runSeconds(frame, 754, [[0, PAUSE_SYNC]]), running: frame < PAUSE_SYNC }
  const review: VideoTask = { id: 'review', title: 'Code review: payment flow', project: PROJECTS.checkout, seconds: runSeconds(frame, 0, [[ADD_REVIEW, SWITCH]]), running: frame >= ADD_REVIEW && frame < SWITCH }
  const bug: VideoTask = { id: 'bug', title: 'Fix flaky login test', project: PROJECTS.bugs, seconds: runSeconds(frame, 1310, [[ADD_BUG, SWITCH]]), running: frame >= ADD_BUG && frame < SWITCH }
  const tokens: VideoTask = { id: 'tokens', title: 'Button tokens v2', project: PROJECTS.design, seconds: runSeconds(frame, 2412, [[SWITCH, never]]), running: frame >= SWITCH }
  return [
    { ...tokens, enter: pop(frame, SWITCH + 2, 18, 170) },
    { ...bug, enter: pop(frame, ADD_BUG + 2, 18, 170) },
    { ...review, enter: pop(frame, ADD_REVIEW + 2, 18, 170) },
    { ...sync, enter: 1 }
  ]
}

export const Parallel: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const tasks = tasksAt(frame)
  const live = tasks.filter((task) => task.running && task.enter > 0.5)
  const liveSeconds = live.reduce((sum, task) => sum + task.seconds, 0)
  const worked = 4 * 3600 + 26 * 60 + frame / FPS

  const enter = pop(frame, 0, 20, 90)
  const rotateY = -18 + 12 * tween(frame, 0, duration, 0, 1) - (1 - enter) * 10
  const appX = 1010
  const appY = 80 + (1 - enter) * 120
  const scale = 1.58

  const segments = [
    { left: 0, width: 16, color: COLORS.blue },
    { left: 18, width: 22, color: COLORS.lime },
    { left: 31, width: 12, color: COLORS.warm },
    { left: 46, width: 20, color: COLORS.purple },
    { left: 68, width: 10 + tween(frame, 0, duration) * 4, color: COLORS.blue },
    ...(frame > ADD_REVIEW ? [{ left: 80, width: tween(frame, ADD_REVIEW, SWITCH) * 16, color: COLORS.lime }] : []),
    ...(frame > ADD_BUG ? [{ left: 84, width: tween(frame, ADD_BUG, SWITCH) * 12, color: COLORS.warm }] : []),
    ...(frame > SWITCH ? [{ left: 96, width: tween(frame, SWITCH, duration) * 4, color: COLORS.purple }] : [])
  ]

  const pressed = Math.abs(frame - ADD_REVIEW) < 4 || Math.abs(frame - ADD_BUG) < 4 ? 'parallel' : Math.abs(frame - SWITCH) < 4 ? 'switch' : undefined
  const cursorPath = [
    { f: 30, x: 300, y: 520 },
    { f: ADD_REVIEW, x: 170, y: 240 },
    { f: ADD_REVIEW + 22, x: 190, y: 250 },
    { f: ADD_BUG, x: 172, y: 241 },
    { f: PAUSE_SYNC - 26, x: 330, y: 560 },
    { f: PAUSE_SYNC, x: 380, y: 318 + 2 * 97 + 44 },
    { f: SWITCH, x: 376, y: 240 },
    { f: SWITCH + 40, x: 300, y: 420 }
  ]

  return (
    <SceneFade frame={frame} duration={duration}>
      <Backdrop frame={frame} />
      <AbsoluteFill style={{ padding: '0 0 0 150px', justifyContent: 'center' }}>
        <div style={{ width: 760 }}>
          <Eyebrow style={{ opacity: tween(frame, 8, 24) }}>Parallel tracking</Eyebrow>
          <Words frame={frame} at={14} text={'Track everything.\nAll at once.'} gradientWords={['once']} style={{ ...titleStyle, fontSize: 104, marginTop: 22 }} />
          <Words frame={frame} at={44} stagger={2} text={'Run timers side by side. Switch in one click.\nEvery second lands where it belongs.'} style={{ ...subStyle, fontSize: 30, marginTop: 34 }} />
          <div style={{ display: 'flex', gap: 14, marginTop: 46, opacity: tween(frame, 120, 140) }}>
            {[['Real work', compactDuration(worked)], ['Running now', String(live.length)], ['Switches', String(9 + (frame > SWITCH ? 1 : 0))]].map(([label, value]) => (
              <div key={label} style={{ padding: '16px 22px', borderRadius: 18, background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.08)', fontFamily: subStyle.fontFamily }}>
                <div style={{ color: COLORS.muted, fontSize: 16, fontWeight: 600 }}>{label}</div>
                <div style={{ color: COLORS.text, fontSize: 34, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>

      <Showcase x={appX} y={appY} scale={scale} rotateY={rotateY} rotateX={4} opacity={tween(frame, 0, 14)}>
        <AppFrame height={640}>
          <Header label={<Slides frame={frame} slides={[{ label: 'Worked today', value: compactDuration(worked) }, { label: 'running now', value: String(live.length) }, { label: 'tasks today', value: String(tasks.filter((task) => task.enter > 0.5).length + 3) }]} period={84} />} />
          <div className="expanded-view">
            <TabBar active={0} />
            <div className="content-scroll" style={{ overflow: 'hidden' }}>
              <div className="page-stack">
                <FocusHero frame={frame} eyebrow={`${live.length} active now`} seconds={liveSeconds} segments={segments} />
                <FocusActions live pressed={pressed} />
                <div className="task-list" style={{ gap: 0 }}>
                  {tasks.map((task) => task.enter > 0.001 && (
                    <Grow key={task.id} k={Math.min(1, task.enter)} height={88}>
                      <TaskCard task={task} frame={frame} pressed={task.id === 'sync' && Math.abs(frame - PAUSE_SYNC) < 4} />
                    </Grow>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="window-bottom-edge" />
        </AppFrame>
        <Cursor frame={frame} path={cursorPath} clicks={[ADD_REVIEW, ADD_BUG, PAUSE_SYNC, SWITCH]} scale={0.85} />
      </Showcase>
      <BottomFade height={130} />
    </SceneFade>
  )
}
