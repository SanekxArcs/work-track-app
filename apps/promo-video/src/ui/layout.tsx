import type { CSSProperties, ReactNode } from 'react'
import { tween } from './kit'

/** Product shot: perspective tilt, slow float and a soft glow beneath. */
export function Showcase({ children, x, y, scale, rotateY = 0, rotateX = 0, glow = '#b8e986', opacity = 1, style }: { children: ReactNode; x: number; y: number; scale: number; rotateY?: number; rotateX?: number; glow?: string; opacity?: number; style?: CSSProperties }): React.JSX.Element {
  return (
    <div style={{ position: 'absolute', left: x, top: y, perspective: 2600, opacity, ...style }}>
      <div style={{ position: 'absolute', left: -220, top: -120, width: 1100, height: 1300, background: `radial-gradient(closest-side, ${glow}26, transparent 70%)`, filter: 'blur(10px)', transform: `scale(${scale * 0.75})`, transformOrigin: '0 0' }} />
      <div style={{ transform: `rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${scale})`, transformOrigin: '0 0', transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </div>
  )
}

/** Grows a stack item's height and fades it in, like the app's StackItem. */
export function Grow({ k, height, gap = 9, children }: { k: number; height: number; gap?: number; children: ReactNode }): React.JSX.Element {
  return (
    <div style={{ height: (height + gap) * k, overflow: 'visible' }}>
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 10}px) scale(${0.98 + 0.02 * k})`, transformOrigin: '50% 0' }}>{children}</div>
    </div>
  )
}

/** A carousel line for the header: slides change with a small vertical roll. */
export function Slides({ frame, slides, period = 90, offset = 0 }: { frame: number; slides: Array<{ label: string; value: ReactNode }>; period?: number; offset?: number }): React.JSX.Element {
  const local = frame + offset
  const index = Math.floor(local / period) % slides.length
  const within = local % period
  const k = tween(within, 0, 8)
  const out = tween(within, period - 7, period)
  const slide = slides[index]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, opacity: k * (1 - out), transform: `translateY(${(1 - k) * 6 - out * 6}px)` }}>
      <span className="notch-pill__label" style={{ color: 'inherit' }}>{slide.label}</span><b>{slide.value}</b>
    </span>
  )
}
