import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { IntroOrb } from '../three/IntroOrb'
import { OutroMark } from '../three/OutroMark'
import { Words, tween } from '../ui/kit'
import { COLORS, DISPLAY_FONT, SceneFade, titleStyle } from '../ui/stage'

export const Intro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  return (
    <SceneFade frame={frame} duration={duration} fadeIn={1} fadeOut={8}>
      <IntroOrb />
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 130 }}>
        <Words frame={frame} at={22} stagger={4} text={'Your workday never happens'} style={{ ...titleStyle, fontSize: 72, textAlign: 'center' }} />
        <Words frame={frame} at={44} stagger={4} text={'one thing at a time.'} gradientWords={['one', 'thing']} style={{ ...titleStyle, fontSize: 72, textAlign: 'center', marginTop: 6 }} />
      </AbsoluteFill>
    </SceneFade>
  )
}

export const Outro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const tag = tween(frame, 70, 96)
  return (
    <SceneFade frame={frame} duration={duration} fadeIn={1} fadeOut={24}>
      <OutroMark />
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 }}>
        <Words frame={frame} at={30} stagger={6} text={'Work Buddy'} style={{ ...titleStyle, fontSize: 118, textAlign: 'center' }} />
        <Words frame={frame} at={48} stagger={3} text={'Your workday sidekick.'} gradientWords={['sidekick']} style={{ ...titleStyle, fontSize: 52, fontWeight: 600, letterSpacing: '-0.03em', marginTop: 14 }} />
        <div style={{ marginTop: 34, display: 'flex', gap: 14, opacity: tag, transform: `translateY(${(1 - tag) * 12}px)` }}>
          {['Windows', 'macOS', 'Linux', 'Chrome'].map((label) => (
            <span key={label} style={{ padding: '9px 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', color: '#c3c9bf', fontFamily: DISPLAY_FONT, fontSize: 19, fontWeight: 600 }}>{label}</span>
          ))}
        </div>
        <div style={{ marginTop: 22, color: COLORS.muted, fontFamily: DISPLAY_FONT, fontSize: 18, opacity: tag }}>Local-first · Private · English & Українська</div>
      </AbsoluteFill>
    </SceneFade>
  )
}
