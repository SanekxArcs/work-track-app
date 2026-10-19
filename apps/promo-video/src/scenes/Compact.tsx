import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { CompactRow, DESK_TASKS, DockPill, FocusApp } from '../ui/app'
import { blendShot, shotTransform, toFrame, type Shot } from '../ui/camera'
import { Cursor, Words, compactDuration, easeInOut, mix, tween } from '../ui/kit'
import { Slides } from '../ui/layout'
import { COLORS, Desktop, Eyebrow, SceneFade, subStyle, titleStyle } from '../ui/stage'

const COLLAPSE = 46
const HOVER = 96
const DOCK = 176
const UNDOCK = 252
const APP_X = 1468
const APP_Y = 40
const DOCK_X = 1920 - 104

/** 0→1 as a view appears after a switch, 1→0 as it leaves (the app's 170ms fade-and-scale). */
function stage(frame: number, inAt: number, outAt = 1e9): { opacity: number; scale: number } {
  const k = tween(frame, inAt, inAt + 7) * (1 - tween(frame, outAt, outAt + 6))
  return { opacity: k, scale: 0.97 + 0.03 * k }
}

export const Compact: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const base: Shot = { s: mix(1.5, 1.62, tween(frame, 0, duration)), px: 1920, py: 0, fx: 1920, fy: 0 }
  const dockShot: Shot = { s: 2.5, px: 1920, py: 63, fx: 1920, fy: 330 }
  const dockZoom = tween(frame, DOCK + 4, DOCK + 44, 0, 1, easeInOut) * (1 - tween(frame, UNDOCK - 36, UNDOCK - 8, 0, 1, easeInOut))
  const shot = blendShot(base, dockShot, dockZoom)
  const tasks = DESK_TASKS(frame + 300)
  const worked = 4 * 3600 + 31 * 60 + frame / 30
  const slides = [{ label: 'Worked today', value: compactDuration(worked) }, { label: 'running now', value: '2' }]

  const expandedA = stage(frame, -10, COLLAPSE)
  const compact = stage(frame, COLLAPSE + 6, DOCK)
  const dock = stage(frame, DOCK + 6, UNDOCK)
  const expandedB = stage(frame, UNDOCK + 6)
  const dockSlide = (1 - tween(frame, DOCK + 6, DOCK + 22)) * 60
  const extraA = tween(frame, HOVER + 10, HOVER + 20)
  const extraB = tween(frame, HOVER + 14, HOVER + 24)

  const app = (x: number, y: number): { x: number; y: number } => toFrame(shot, APP_X + x, APP_Y + y)
  const path = [
    { f: 10, ...toFrame(shot, 1300, 520) },
    { f: COLLAPSE, ...app(358, 38) },
    { f: HOVER - 20, ...app(250, 60) },
    { f: HOVER, ...app(140, 25) },
    { f: DOCK - 26, ...app(240, 80) },
    { f: DOCK, ...app(372, 25) },
    { f: UNDOCK - 34, ...toFrame(shot, 1700, 220) },
    { f: UNDOCK, ...toFrame(shot, DOCK_X + 16, APP_Y + 23) },
    { f: duration, ...toFrame(shot, 1600, 420) }
  ]

  return (
    <SceneFade frame={frame} duration={duration}>
      <AbsoluteFill style={{ background: COLORS.bg, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: shotTransform(shot), transformOrigin: '0 0' }}>
          <Desktop frame={frame} dim={0.3} blur={4}>
            <div className="wb" style={{ position: 'absolute', left: APP_X, top: APP_Y, width: 430 }}>
              {expandedA.opacity > 0 && <div style={{ position: 'absolute', opacity: expandedA.opacity, transform: `scale(${expandedA.scale})`, transformOrigin: '50% 0' }}><FocusApp frame={frame} tasks={tasks} header={<Slides frame={frame} slides={slides} period={70} />} height={612} /></div>}
              {expandedB.opacity > 0 && <div style={{ position: 'absolute', opacity: expandedB.opacity, transform: `scale(${expandedB.scale})`, transformOrigin: '50% 0' }}><FocusApp frame={frame} tasks={tasks} header={<Slides frame={frame} slides={slides} period={70} />} height={612} /></div>}
              {compact.opacity > 0 && <div className="compact-view" style={{ position: 'absolute', width: 430, padding: 2, opacity: compact.opacity, transform: `scale(${compact.scale})`, transformOrigin: '50% 0' }}>
                <CompactRow task={tasks[0]} frame={frame} />
                {extraA > 0 && <CompactRow task={tasks[1]} frame={frame} extra windowActions={false} style={{ opacity: extraA, transform: `translateY(${(1 - extraA) * 7}px)` }} />}
                {extraB > 0 && <CompactRow task={tasks[2]} frame={frame} extra windowActions={false} style={{ opacity: extraB, transform: `translateY(${(1 - extraB) * 7}px)` }} />}
              </div>}
            </div>
            {dock.opacity > 0 && <div style={{ position: 'absolute', left: DOCK_X + dockSlide, top: APP_Y, opacity: dock.opacity, transform: `scale(${dock.scale})`, transformOrigin: '100% 50%' }}>
              <DockPill side="right" seconds={worked} live frame={frame} />
            </div>}
          </Desktop>
        </div>

        <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(8,9,8,.95) 0%, rgba(8,9,8,.85) 40%, transparent 64%)' }} />
        <div style={{ position: 'absolute', left: 140, top: 340, width: 900 }}>
          <Eyebrow style={{ opacity: tween(frame, 4, 18) }}>Your size, your spot</Eyebrow>
          <div style={{ position: 'relative', height: 330, marginTop: 22 }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <Words frame={frame} at={COLLAPSE + 4} out={DOCK - 6} text={'One slim bar.'} gradientWords={['bar']} style={{ ...titleStyle, fontSize: 100 }} />
              <Words frame={frame} at={COLLAPSE + 18} out={DOCK - 6} stagger={2} text={'Collapse to a single line.\nHover to peek at every timer.'} style={{ ...subStyle, fontSize: 30, marginTop: 30 }} />
            </div>
            <div style={{ position: 'absolute', inset: 0 }}>
              <Words frame={frame} at={DOCK + 6} text={'Or dock it\nto the edge.'} gradientWords={['edge']} style={{ ...titleStyle, fontSize: 100 }} />
              <Words frame={frame} at={DOCK + 20} stagger={2} text={'Out of your way.\nNever out of reach.'} style={{ ...subStyle, fontSize: 30, marginTop: 30 }} />
            </div>
          </div>
        </div>
        <Cursor frame={frame} path={path} clicks={[COLLAPSE, DOCK, UNDOCK]} />
      </AbsoluteFill>
    </SceneFade>
  )
}
