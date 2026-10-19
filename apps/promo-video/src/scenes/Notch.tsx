import { AbsoluteFill, spring, useCurrentFrame } from 'remotion'
import { DESK_TASKS, FocusApp, NotchPill } from '../ui/app'
import { blendShot, shotTransform, toFrame, type Shot } from '../ui/camera'
import { Cursor, Words, compactDuration, mix, tween, easeInOut } from '../ui/kit'
import { Slides } from '../ui/layout'
import { COLORS, Desktop, Eyebrow, SceneFade, subStyle, titleStyle } from '../ui/stage'

const OPEN = 118
const CLOSE = 218
const OPEN_W = 430
const OPEN_H = 612

const WIDE: Shot = { s: 0.8, px: 960, py: 540, fx: 960, fy: 556 }
const PUSH: Shot = { s: 2.7, px: 960, py: 0, fx: 960, fy: 150 }
const OPENED: Shot = { s: 1.3, px: 960, py: 0, fx: 1230, fy: 92 }

function cameraAt(frame: number): Shot {
  if (frame < 40) return WIDE
  if (frame < 100) return blendShot(WIDE, PUSH, easeInOut(tween(frame, 40, 100, 0, 1, (t) => t)))
  return blendShot(PUSH, OPENED, easeInOut(tween(frame, OPEN - 4, OPEN + 40, 0, 1, (t) => t)))
}

export const Notch: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const shot = cameraAt(frame)
  const config = { stiffness: 380, damping: 38, mass: 0.9 }
  const k = spring({ frame: frame - OPEN, fps: 30, config }) - spring({ frame: frame - CLOSE, fps: 30, config })
  const width = mix(264, OPEN_W, k)
  const height = mix(30, OPEN_H, k)
  const radius = mix(11, 20, k)
  const worked = 4 * 3600 + 26 * 60 + frame / 30
  const tasks = DESK_TASKS(frame)
  const tilt = 12 * (1 - tween(frame, 0, 60))
  const pillOpacity = 1 - tween(frame, OPEN, OPEN + 5) + tween(frame, CLOSE + 12, CLOSE + 20)
  const fullOpacity = tween(frame, OPEN + 3, OPEN + 10) * (1 - tween(frame, CLOSE, CLOSE + 4))
  const slides = [{ label: 'Worked today', value: compactDuration(worked) }, { label: 'running now', value: '2' }, { label: 'Until end of day', value: '3h 34m' }]

  const path = [
    { f: 62, x: 1420, y: 640 },
    { f: 108, x: 1000, y: 18 },
    { f: 150, x: 1010, y: 40 },
    { f: 178, x: 1080, y: 330 },
    { f: 212, x: 1420, y: 760 },
    { f: 240, x: 1500, y: 820 }
  ].map((key) => ({ f: key.f, ...toFrame(shot, key.x, key.y) }))

  const captionK = tween(frame, OPEN, OPEN + 30)

  return (
    <SceneFade frame={frame} duration={duration}>
      <AbsoluteFill style={{ background: COLORS.bg, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: shotTransform(shot), transformOrigin: '0 0' }}>
          <div style={{ position: 'absolute', left: -18, top: -18, width: 1956, height: 1116, borderRadius: 30, background: 'linear-gradient(180deg, #2b2e2c, #111312)', boxShadow: '0 80px 160px rgba(0,0,0,.75)', transform: `perspective(2400px) rotateX(${tilt}deg)`, transformOrigin: '50% 100%' }}>
            <div style={{ position: 'absolute', left: 18, top: 18, width: 1920, height: 1080, borderRadius: 12, overflow: 'hidden' }}>
              <Desktop frame={frame} dim={0.35 * tween(frame, OPEN, OPEN + 30)} blur={5 * tween(frame, OPEN, OPEN + 30)}>
                <div className="wb notch" style={{ position: 'absolute', left: 960 - width / 2, top: 0, width, height, borderRadius: `0 0 ${radius}px ${radius}px`, boxShadow: `0 ${4 + 30 * k}px ${12 + 60 * k}px rgba(0,0,0,${0.22 + 0.4 * k})` }}>
                  <div style={{ position: 'absolute', inset: 0, opacity: pillOpacity }}>
                    <NotchPill frame={frame} live label={<Slides frame={frame} slides={slides} period={60} />} value="" />
                  </div>
                  {k > 0.02 && <div style={{ position: 'absolute', top: 0, left: width / 2 - OPEN_W / 2, width: OPEN_W, height: OPEN_H, opacity: fullOpacity }}>
                    <FocusApp frame={frame} tasks={tasks} notch height={OPEN_H} header={<Slides frame={frame} slides={slides} period={60} />} />
                  </div>}
                </div>
              </Desktop>
            </div>
          </div>
        </div>

        <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(8,9,8,.94) 0%, rgba(8,9,8,.82) 38%, transparent 60%)', opacity: captionK }} />
        <div style={{ position: 'absolute', left: 140, top: 330, width: 760 }}>
          <Eyebrow style={{ opacity: captionK }}>Notch mode</Eyebrow>
          <Words frame={frame} at={OPEN + 6} text={'Lives in a notch.'} gradientWords={['notch']} style={{ ...titleStyle, fontSize: 96, marginTop: 22 }} />
          <Words frame={frame} at={OPEN + 26} stagger={2} text={'Hover, and your whole day unfolds.\nDrag it anywhere along the top edge.'} style={{ ...subStyle, fontSize: 30, marginTop: 30 }} />
        </div>
        <Cursor frame={frame} path={path} clicks={[]} />
      </AbsoluteFill>
    </SceneFade>
  )
}
