import type { ReactNode } from 'react'
import { useCurrentFrame } from 'remotion'
import { ArrowRightLeft, CalendarDays, Clock3, GitBranch, Layers3, Sparkles } from 'lucide-react'
import { PROJECTS } from '../ui/app'
import { Caret, Words, compactDuration, pop, tween, typed } from '../ui/kit'
import { Backdrop, COLORS, Eyebrow, SceneFade, titleStyle } from '../ui/stage'

const CARD_W = 400
const SCALE = 1.36

function Card({ frame, at, x, y, children, rotate = 0 }: { frame: number; at: number; x: number; y: number; children: ReactNode; rotate?: number }): React.JSX.Element {
  const k = pop(frame, at, 20, 120)
  const drift = Math.sin((frame + at * 3) / 50) * 4
  return (
    <div style={{ position: 'absolute', left: x, top: y + (1 - k) * 80 + drift, perspective: 2000, opacity: Math.min(1, k * 1.4) }}>
      <div className="wb" style={{ width: CARD_W, transform: `scale(${SCALE}) rotateX(${(1 - k) * 18}deg) rotateY(${rotate * (1 - k)}deg)`, transformOrigin: '0 0', filter: `blur(${Math.max(0, 1 - k) * 8}px)` }}>{children}</div>
    </div>
  )
}

const LANES = [
  { title: 'Code review: payment flow', project: PROJECTS.checkout, spans: [[2, 20], [44, 58]], total: '1h 52m' },
  { title: 'Sprint sync with the team', project: PROJECTS.calls, spans: [[10, 18], [62, 70]], total: '37m' },
  { title: 'Fix flaky login test', project: PROJECTS.bugs, spans: [[16, 40], [72, 86]], total: '1h 41m' },
  { title: 'Button tokens v2', project: PROJECTS.design, spans: [[30, 46], [86, 98]], total: '1h 08m' },
  { title: 'Review the checkout pull request', project: PROJECTS.northwind, spans: [[58, 80]], total: '58m' }
]

/** Six months of seeded, plausible workdays: weekends light, weekdays strong. */
function heatLevel(index: number): number {
  const weekday = index % 7
  const noise = (Math.sin(index * 12.9898) * 43758.5453) % 1
  const r = Math.abs(noise)
  if (weekday >= 5) return r > 0.8 ? 1 : 0
  if (index > 175) return 0
  return r < 0.08 ? 1 : r < 0.25 ? 2 : r < 0.6 ? 3 : 4
}

const RECAP = 'Most of today went to Checkout revamp (3h 10m), with a steady parallel block next to the bug bash. Two breaks and lunch on time. Nice rhythm.'

export const Insights: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const metrics = [
    { label: 'Real work', value: 6 * 3600 + 42 * 60, icon: Clock3, tone: 'green' },
    { label: 'Task total', value: 8 * 3600 + 15 * 60, icon: Layers3, tone: 'blue' },
    { label: 'In parallel', value: 3600 + 33 * 60, icon: GitBranch, tone: 'purple' },
    { label: 'Switches', value: 14, icon: ArrowRightLeft, tone: 'orange' }
  ]
  const countK = tween(frame, 26, 80)
  const columns = 26
  const heatK = tween(frame, 70, 150, 0, 1, (t) => t)
  const recapAt = 168

  return (
    <SceneFade frame={frame} duration={duration}>
      <Backdrop frame={frame} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 84, textAlign: 'center' }}>
        <Eyebrow style={{ opacity: tween(frame, 2, 16) }}>Day insights</Eyebrow>
        <Words frame={frame} at={6} text={'See your real day.'} gradientWords={['real']} style={{ ...titleStyle, fontSize: 88, marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }} />
      </div>

      <Card frame={frame} at={18} x={72} y={330} rotate={-14}>
        <div className="metrics-grid">
          {metrics.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className={`metric-card metric-card--${tone}`}>
              <Icon size={16} />
              <strong>{label === 'Switches' ? Math.round(value * countK) : compactDuration(value * countK)}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <section className="panel schedule-panel" style={{ marginTop: 8 }}>
          <div className="section-heading"><div><span className="eyebrow">Work rhythm</span><h3>Day plan</h3></div><strong>{Math.round(82 * countK)}%</strong></div>
          <div className="schedule-progress">
            <span className="schedule-progress__elapsed" style={{ width: `${82 * countK}%` }} />
            <span className="schedule-progress__segment schedule-progress__segment--break is-past" style={{ left: '22%', width: '3%' }} />
            <span className="schedule-progress__segment schedule-progress__segment--lunch is-past" style={{ left: '46%', width: '9%' }} />
            <span className="schedule-progress__segment schedule-progress__segment--break is-past" style={{ left: '70%', width: '3%' }} />
            <i className="schedule-progress__now" style={{ left: `${82 * countK}%` }} />
          </div>
          <div className="schedule-times"><span>09:02</span><span>18:00</span></div>
          <div className="schedule-legend"><span><i className="work" />Work</span><span><i className="break" />Break taken</span><span><i className="lunch" />Actual lunch</span></div>
        </section>
      </Card>

      <Card frame={frame} at={30} x={688} y={330}>
        <section className="panel timeline-panel">
          <div className="section-heading"><div><span className="eyebrow">Timeline</span><h3>Day branches</h3></div></div>
          <div className="timeline">
            {LANES.map((lane, laneIndex) => (
              <div className="timeline-row" key={lane.title}>
                <div className="timeline-label"><strong>{lane.title}</strong><span>{lane.total}</span></div>
                <div className="timeline-track">
                  {lane.spans.map(([start, end], spanIndex) => {
                    const k = tween(frame, 40 + laneIndex * 7 + spanIndex * 10, 70 + laneIndex * 7 + spanIndex * 10)
                    return <span key={spanIndex} style={{ left: `${start}%`, width: `${(end - start) * k}%`, background: lane.project.color }} />
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </Card>

      <Card frame={frame} at={42} x={1304} y={330} rotate={14}>
        <section className="panel history-panel">
          <div className="section-heading"><div><span className="eyebrow">History</span><h3>Work history</h3></div><CalendarDays size={16} /></div>
          <p>Your rhythm for the last six months. A stronger square means more real work.</p>
          <div className="history-heatmap" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns * 7 }, (_, index) => {
              const column = Math.floor(index / 7)
              const shown = heatK * (columns + 6) - column - (index % 7) * 0.4 > 0
              const level = shown ? heatLevel(index) : 0
              return <span key={index} className={`history-cell history-cell--${level}`} style={{ cursor: 'default', ...(index === 172 ? { outline: '1px solid rgba(242,244,236,.85)' } : {}) }} />
            })}
          </div>
          <div className="history-legend"><span>Less</span><i className="history-cell--0" /><i className="history-cell--1" /><i className="history-cell--2" /><i className="history-cell--3" /><i className="history-cell--4" /><span>More</span></div>
        </section>
      </Card>

      <div style={{ position: 'absolute', left: 72, right: 72, top: 860, opacity: tween(frame, recapAt - 10, recapAt + 6), transform: `translateY(${(1 - tween(frame, recapAt - 10, recapAt + 10)) * 24}px)` }}>
        <div className="wb" style={{ padding: '22px 30px', borderRadius: 26, display: 'flex', gap: 22, alignItems: 'center', background: 'linear-gradient(135deg, rgba(205,180,219,.14), transparent 55%), rgba(25,28,24,.96)', border: '1px solid rgba(205,180,219,.2)', boxShadow: '0 30px 80px rgba(0,0,0,.4)' }}>
          <div style={{ flex: '0 0 auto', width: 58, height: 58, borderRadius: 18, display: 'grid', placeItems: 'center', color: COLORS.purple, background: 'rgba(205,180,219,.12)' }}><Sparkles size={28} /></div>
          <div>
            <div style={{ color: COLORS.purple, fontSize: 15, fontWeight: 750, letterSpacing: '.14em', textTransform: 'uppercase' }}>Sidekick recap · Gemini</div>
            <div style={{ marginTop: 6, color: '#dfe3da', fontSize: 25, lineHeight: 1.4 }}>{typed(RECAP, frame, recapAt + 4, 1.5)}{frame < recapAt + 4 + RECAP.length / 1.5 && <Caret frame={frame} color={COLORS.purple} />}</div>
          </div>
        </div>
      </div>
    </SceneFade>
  )
}
