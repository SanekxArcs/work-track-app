import type { CSSProperties, ReactNode } from 'react'
import { Easing, interpolate, spring } from 'remotion'
import { FPS } from '../timeline'

export const ease = Easing.bezier(0.22, 1, 0.36, 1)
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1)

/** 0→1 (or a→b) between two frames, clamped and eased. */
export function tween(frame: number, from: number, to: number, a = 0, b = 1, easing: (t: number) => number = ease): number {
  if (to <= from) return frame >= from ? b : a
  return interpolate(frame, [from, to], [a, b], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing })
}

export function pop(frame: number, delay = 0, damping = 14, stiffness = 140, mass = 0.8): number {
  return spring({ frame: frame - delay, fps: FPS, config: { damping, stiffness, mass } })
}

export function soft(frame: number, delay = 0, durationInFrames?: number): number {
  return spring({ frame: frame - delay, fps: FPS, config: { damping: 200 }, durationInFrames })
}

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t

export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0')
}

export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad2(s / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`
}

export function hm(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad2(s / 3600)}:${pad2((s % 3600) / 60)}`
}

export function compactDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const ROLL = 0.28

/**
 * A ticking clock whose changed digits roll up, like the app's NumberFlow timers.
 * `seconds` is continuous, so the roll is a pure function of the frame.
 */
export function Clock({ seconds, format = hms, className, style }: { seconds: number; format?: (s: number) => string; className?: string; style?: CSSProperties }): React.JSX.Element {
  const whole = Math.floor(seconds)
  const progress = seconds - whole
  const current = format(whole)
  const previous = format(whole - 1)
  const k = whole > 0 ? Easing.out(Easing.cubic)(Math.min(1, progress / ROLL)) : 1
  return (
    <span className={`animated-number ${className ?? ''}`} style={style}>
      {current.split('').map((char, index) => {
        const before = previous[index]
        if (previous.length !== current.length || before === char || !/\d/.test(char)) return <span key={index}>{char}</span>
        return (
          <span key={index} style={{ display: 'inline-block', position: 'relative', overflow: 'hidden', height: '1.12em', lineHeight: '1.12em', verticalAlign: 'bottom' }}>
            <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-k * 1.12}em)` }}>
              <span style={{ height: '1.12em', opacity: 1 - k }}>{before}</span>
              <span style={{ height: '1.12em', opacity: k }}>{char}</span>
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** A number that eases from 0 to its value between two frames. */
export function CountUp({ frame, from, to, value, format, className }: { frame: number; from: number; to: number; value: number; format: (n: number) => string; className?: string }): React.JSX.Element {
  return <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(value * tween(frame, from, to, 0, 1, Easing.out(Easing.cubic)))}</span>
}

/** Text typed out character by character. */
export function typed(text: string, frame: number, start: number, charsPerFrame = 1.4): string {
  const count = Math.max(0, Math.floor((frame - start) * charsPerFrame))
  return text.slice(0, count)
}

export function Caret({ frame, color = 'var(--accent)' }: { frame: number; color?: string }): React.JSX.Element {
  return <span style={{ display: 'inline-block', width: 2, height: '1.05em', marginLeft: 1, verticalAlign: 'text-bottom', background: color, opacity: Math.floor(frame / 15) % 2 === 0 ? 1 : 0.15 }} />
}

/** Breathing live dot, frame-driven version of the app's CSS pulse. */
export function LiveDot({ frame, live, size = 7, style }: { frame: number; live: boolean; size?: number; style?: CSSProperties }): React.JSX.Element {
  const phase = (Math.sin((frame / FPS) * Math.PI * 2 / 1.6) + 1) / 2
  return <span className={`status-dot ${live ? 'status-dot--live' : ''}`} style={{ width: size, height: size, ...(live ? { opacity: 0.65 + 0.35 * phase, transform: `scale(${0.88 + 0.12 * phase})` } : {}), ...style }} />
}

export interface CursorKey { f: number; x: number; y: number }

/** A macOS-style pointer that glides between keyframes and dips on clicks. */
export function Cursor({ frame, path, clicks = [], scale = 1.25, hidden = false }: { frame: number; path: CursorKey[]; clicks?: number[]; scale?: number; hidden?: boolean }): React.JSX.Element | null {
  if (hidden || path.length === 0) return null
  let x = path[0].x
  let y = path[0].y
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index]
    const b = path[index + 1]
    if (frame >= a.f && frame <= b.f) {
      const t = easeInOut((frame - a.f) / Math.max(1, b.f - a.f))
      // A slight arc reads as a human hand rather than a robot.
      const arc = Math.sin(t * Math.PI) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12)
      x = mix(a.x, b.x, t)
      y = mix(a.y, b.y, t) - arc
    } else if (frame > b.f) {
      x = b.x
      y = b.y
    }
  }
  const appear = tween(frame, path[0].f - 8, path[0].f + 4)
  let press = 0
  let ripple: { k: number } | null = null
  for (const click of clicks) {
    if (frame >= click - 3 && frame <= click + 6) press = Math.max(press, 1 - Math.abs(frame - click) / 5)
    if (frame >= click && frame <= click + 18) ripple = { k: (frame - click) / 18 }
  }
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 1000, pointerEvents: 'none', opacity: appear }}>
      {ripple && <div style={{ position: 'absolute', left: -28, top: -28, width: 56, height: 56, borderRadius: '50%', border: '2px solid rgba(255,255,255,.75)', transform: `scale(${0.3 + ripple.k * 0.9})`, opacity: 1 - ripple.k }} />}
      <svg width={26 * scale} height={34 * scale} viewBox="0 0 26 34" style={{ transform: `scale(${1 - press * 0.14})`, transformOrigin: '3px 3px', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.45))', marginLeft: -3, marginTop: -3 }}>
        <path d="M3 2 L3 26 L9.2 20.4 L13.4 30.2 L17.6 28.4 L13.5 18.8 L21.6 18.8 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Fades, lifts and de-blurs a block in; optional exit. */
export function Reveal({ frame, at, out, children, y = 26, blur = 12, style, duration = 22 }: { frame: number; at: number; out?: number; children: ReactNode; y?: number; blur?: number; style?: CSSProperties; duration?: number }): React.JSX.Element {
  const k = tween(frame, at, at + duration)
  const o = out === undefined ? 0 : tween(frame, out, out + 14)
  return <div style={{ opacity: k * (1 - o), transform: `translateY(${(1 - k) * y - o * 14}px)`, filter: `blur(${(1 - k) * blur + o * 8}px)`, ...style }}>{children}</div>
}

/** Apple-like headline: each word rises in with a soft blur, staggered. */
export function Words({ text, frame, at, stagger = 4, className, style, out, gradientWords = [] }: { text: string; frame: number; at: number; stagger?: number; className?: string; style?: CSSProperties; out?: number; gradientWords?: string[] }): React.JSX.Element {
  const lines = text.split('\n')
  let index = 0
  const o = out === undefined ? 0 : tween(frame, out, out + 14)
  return (
    <div className={className} style={{ ...style, opacity: 1 - o, filter: `blur(${o * 10}px)` }}>
      {lines.map((line, lineIndex) => (
        <div key={lineIndex} style={{ display: 'block', whiteSpace: 'nowrap' }}>
          {line.split(' ').map((word, wordIndex) => {
            const k = tween(frame, at + index * stagger, at + index * stagger + 20)
            index += 1
            const gradient = gradientWords.includes(word.replace(/[.,!?]/g, ''))
            return (
              <span key={wordIndex} style={{ display: 'inline-block', marginRight: '0.24em', opacity: k, transform: `translateY(${(1 - k) * 0.42}em)`, filter: `blur(${(1 - k) * 10}px)`, ...(gradient ? { backgroundImage: 'linear-gradient(100deg, #d9f7b8 0%, #b8e986 35%, #7bdff2 75%, #cdb4db 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {}) }}>{word}</span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
