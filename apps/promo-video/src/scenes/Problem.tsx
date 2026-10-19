import { useCurrentFrame } from 'remotion'
import { CalendarDays, Bug, GitPullRequest } from 'lucide-react'
import { Clock, Words, mix, pop, tween } from '../ui/kit'
import { Backdrop, COLORS, DISPLAY_FONT, SceneFade, titleStyle } from '../ui/stage'

/** Word timings follow the narration: "Meetings. Reviews. That one bug… So why… pick just one?" */
const ITEMS = [
  { at: 6, label: 'Meetings.', color: COLORS.blue, icon: CalendarDays, x: 220, y: 230, base: 1860 },
  { at: 37, label: 'Reviews.', color: COLORS.lime, icon: GitPullRequest, x: 640, y: 440, base: 942 },
  { at: 68, label: 'That one bug.', color: COLORS.warm, icon: Bug, x: 900, y: 650, base: 3305 }
]
const QUESTION = 138

export const Problem: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const q = tween(frame, QUESTION, QUESTION + 26)
  return (
    <SceneFade frame={frame} duration={duration} fadeIn={6}>
      <Backdrop frame={frame} tint={COLORS.warm} second={COLORS.blue} intensity={0.8} />
      {ITEMS.map((item, index) => {
        const k = pop(frame, item.at, 16, 150)
        const kept = index === 1
        const dim = kept ? 0 : q
        const Icon = item.icon
        const running = kept || frame < QUESTION
        const x = mix(item.x, kept ? 660 : item.x + (index === 0 ? -120 : 120), q)
        const y = mix(item.y, kept ? 330 : item.y + 60, q)
        return (
          <div key={item.label} style={{ position: 'absolute', left: x, top: y + (1 - k) * 60, opacity: Math.min(1, k) * (1 - dim * 0.82), filter: `blur(${(1 - Math.min(1, k)) * 14 + dim * 6}px)`, transform: `scale(${(0.9 + 0.1 * Math.min(1, k)) * (1 - dim * 0.15)})`, transformOrigin: '0 50%', display: 'flex', alignItems: 'center', gap: 34 }}>
            <div style={{ width: 120, height: 120, borderRadius: 36, display: 'grid', placeItems: 'center', color: item.color, background: `${item.color}1f`, border: `1px solid ${item.color}44`, boxShadow: `0 0 60px ${item.color}22` }}><Icon size={56} /></div>
            <div>
              <div style={{ ...titleStyle, fontSize: 116, whiteSpace: 'nowrap' }}>{item.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 600, color: running ? item.color : COLORS.muted }}>
                <span style={{ width: 12, height: 12, borderRadius: 9, background: running ? item.color : '#555c52' }} />
                <Clock seconds={item.base + (running ? frame : QUESTION) / 30} />
                <span style={{ color: COLORS.muted, fontWeight: 500 }}>{running ? 'tracking' : 'paused'}</span>
              </div>
            </div>
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center' }}>
        <Words frame={frame} at={QUESTION + 14} text={'Why pick just one?'} gradientWords={['one?']} style={{ ...titleStyle, fontSize: 92, color: '#d7dbd2' }} />
      </div>
    </SceneFade>
  )
}
