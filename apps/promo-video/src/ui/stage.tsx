import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import { loadFont } from '@remotion/google-fonts/Inter'
import { tween } from './kit'

export const { fontFamily: DISPLAY_FONT } = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin', 'cyrillic'] })

export const COLORS = {
  bg: '#0a0b0a',
  lime: '#b8e986',
  blue: '#7bdff2',
  purple: '#cdb4db',
  warm: '#f7a072',
  text: '#f2f4ec',
  muted: '#92998d'
}

/** Near-black stage with slow drifting color glows and fine grain. */
export function Backdrop({ frame, tint = COLORS.lime, second = COLORS.blue, intensity = 1 }: { frame: number; tint?: string; second?: string; intensity?: number }): React.JSX.Element {
  const a = Math.sin(frame / 90) * 80
  const b = Math.cos(frame / 110) * 70
  return (
    <AbsoluteFill style={{ background: COLORS.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 1300, height: 1300, left: 900 + a, top: -380 + b, borderRadius: '50%', background: `radial-gradient(circle, ${tint}2b 0%, transparent 62%)`, opacity: intensity }} />
      <div style={{ position: 'absolute', width: 1200, height: 1200, left: -420 - b, top: 260 + a * 0.6, borderRadius: '50%', background: `radial-gradient(circle, ${second}1f 0%, transparent 62%)`, opacity: intensity }} />
      <Grain />
      <Vignette />
    </AbsoluteFill>
  )
}

export function Vignette({ strength = 0.75 }: { strength?: number }): React.JSX.Element {
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${strength}) 100%)`, pointerEvents: 'none' }} />
}

export function Grain(): React.JSX.Element {
  return (
    <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <svg width="100%" height="100%"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter="url(#grain)" /></svg>
    </AbsoluteFill>
  )
}

/** A soft, abstract desktop wallpaper in the brand colors. */
export function Wallpaper({ frame, style }: { frame: number; style?: CSSProperties }): React.JSX.Element {
  const d = Math.sin(frame / 120) * 30
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg, #1b2a24 0%, #14181a 45%, #1f1a24 100%)', overflow: 'hidden', ...style }}>
      <div style={{ position: 'absolute', width: 1400, height: 900, left: -300 + d, top: 380, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(123,223,242,.32), transparent 65%)', filter: 'blur(20px)' }} />
      <div style={{ position: 'absolute', width: 1300, height: 1000, left: 900 - d, top: -300, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(184,233,134,.30), transparent 65%)', filter: 'blur(20px)' }} />
      <div style={{ position: 'absolute', width: 1000, height: 800, left: 700, top: 520 + d, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(205,180,219,.26), transparent 65%)', filter: 'blur(30px)' }} />
    </AbsoluteFill>
  )
}

/** A dimmed code-editor window that makes the desktop feel lived in. */
export function EditorWindow({ style }: { style?: CSSProperties }): React.JSX.Element {
  const lines = [
    [['const ', '#cdb4db'], ['checkout', '#7bdff2'], [' = ', '#92998d'], ['await ', '#cdb4db'], ['createSession', '#b8e986'], ['(cart)', '#e3e6df']],
    [['if ', '#cdb4db'], ['(!checkout.ok) ', '#e3e6df'], ['return ', '#cdb4db'], ['retry', '#b8e986'], ['()', '#e3e6df']],
    [['// TODO: flaky on slow networks', '#5f665b']],
    [['export function ', '#cdb4db'], ['PaymentStep', '#f7a072'], ['({ order }) {', '#e3e6df']],
    [['  const ', '#cdb4db'], ['[state, setState] ', '#e3e6df'], ['= ', '#92998d'], ['useState', '#b8e986'], ['(', '#e3e6df'], ["'idle'", '#f6d365'], [')', '#e3e6df']],
    [['  return ', '#cdb4db'], ['<', '#92998d'], ['Summary ', '#7bdff2'], ['total', '#cdb4db'], ['={order.total} />', '#e3e6df']],
    [['}', '#e3e6df']],
    [['', '#e3e6df']],
    [['test', '#b8e986'], ["('logs in on retry', ", '#e3e6df'], ['async ', '#cdb4db'], ['() => {', '#e3e6df']],
    [['  await ', '#cdb4db'], ['page', '#7bdff2'], ['.', '#e3e6df'], ['fill', '#b8e986'], ["('#email', user.email)", '#f6d365']],
    [['  expect', '#b8e986'], ['(await page.', '#e3e6df'], ['title', '#b8e986'], ['()).toBe(', '#e3e6df'], ["'Orders'", '#f6d365'], [')', '#e3e6df']],
    [['})', '#e3e6df']]
  ] as const
  return (
    <div style={{ position: 'absolute', borderRadius: 14, overflow: 'hidden', background: 'rgba(18,20,22,.92)', border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 40px 90px rgba(0,0,0,.5)', ...style }}>
      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: 'rgba(255,255,255,.035)', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <i style={{ width: 11, height: 11, borderRadius: 9, background: '#3a3f38' }} /><i style={{ width: 11, height: 11, borderRadius: 9, background: '#3a3f38' }} /><i style={{ width: 11, height: 11, borderRadius: 9, background: '#3a3f38' }} />
        <span style={{ marginLeft: 14, color: '#7d8479', fontSize: 13, fontFamily: 'Segoe UI' }}>checkout/PaymentStep.tsx</span>
      </div>
      <div style={{ padding: '18px 22px', fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 17, lineHeight: '30px' }}>
        {lines.map((line, index) => (
          <div key={index} style={{ display: 'flex', whiteSpace: 'pre' }}>
            <span style={{ width: 36, color: '#3f453c' }}>{index + 1}</span>
            {line.map(([text, color], part) => <span key={part} style={{ color }}>{text}</span>)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A thin-bezel monitor that frames a desktop screen. */
export function Monitor({ children, width, height, style }: { children: ReactNode; width: number; height: number; style?: CSSProperties }): React.JSX.Element {
  return (
    <div style={{ position: 'absolute', width: width + 28, height: height + 28, padding: 14, borderRadius: 26, background: 'linear-gradient(180deg, #2a2d2b, #121413)', boxShadow: '0 60px 140px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.12)', ...style }}>
      <div style={{ position: 'relative', width, height, borderRadius: 12, overflow: 'hidden', background: '#000' }}>{children}</div>
    </div>
  )
}

export const titleStyle: CSSProperties = { fontFamily: DISPLAY_FONT, color: COLORS.text, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.02 }
export const subStyle: CSSProperties = { fontFamily: DISPLAY_FONT, color: '#a7aea1', fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.4 }

export function Eyebrow({ children, color = COLORS.lime, style }: { children: ReactNode; color?: string; style?: CSSProperties }): React.JSX.Element {
  return <div style={{ fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color, ...style }}>{children}</div>
}

/** Fades a whole scene in and out so cuts feel like breaths. */
export function SceneFade({ frame, duration, children, fadeIn = 10, fadeOut = 10 }: { frame: number; duration: number; children: ReactNode; fadeIn?: number; fadeOut?: number }): React.JSX.Element {
  const k = tween(frame, 0, fadeIn) * (1 - tween(frame, duration - fadeOut, duration))
  return <AbsoluteFill style={{ opacity: k }}>{children}</AbsoluteFill>
}

/** A 1920×1080 virtual desktop: wallpaper, an editor window and a taskbar. */
export function Desktop({ frame, children, dim = 0, blur = 0 }: { frame: number; children?: ReactNode; dim?: number; blur?: number }): React.JSX.Element {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, filter: blur > 0 ? `blur(${blur}px)` : undefined }}>
      <Wallpaper frame={frame} />
      <EditorWindow style={{ left: 220, top: 150, width: 1040, height: 620 }} />
      <div style={{ position: 'absolute', left: 980, top: 420, width: 640, height: 400, borderRadius: 14, background: 'rgba(24,26,30,.9)', border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 40px 90px rgba(0,0,0,.5)', overflow: 'hidden' }}>
        <div style={{ height: 38, background: 'rgba(255,255,255,.04)', borderBottom: '1px solid rgba(255,255,255,.06)' }} />
        <div style={{ padding: 24, display: 'grid', gap: 14 }}>
          {[0.9, 0.7, 0.8, 0.55, 0.75].map((w, index) => <div key={index} style={{ height: 14, width: `${w * 100}%`, borderRadius: 7, background: index === 0 ? 'rgba(123,223,242,.25)' : 'rgba(255,255,255,.07)' }} />)}
          <div style={{ marginTop: 10, height: 120, borderRadius: 12, background: 'linear-gradient(120deg, rgba(184,233,134,.12), rgba(205,180,219,.1))' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 52, background: 'rgba(16,18,17,.82)', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {['#7bdff2', '#b8e986', '#cdb4db', '#f7a072', '#e3e6df'].map((color) => <i key={color} style={{ width: 30, height: 30, borderRadius: 8, background: `${color}55`, border: `1px solid ${color}66` }} />)}
        <span style={{ position: 'absolute', right: 22, color: '#c3c9bf', fontFamily: 'Segoe UI', fontSize: 14 }}>14:26</span>
      </div>
      </div>
      {dim > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${dim})` }} />}
      {children}
    </div>
  )
}

/** Darkens the bottom of the frame so cropped product shots fade out softly. */
export function BottomFade({ height = 160 }: { height?: number }): React.JSX.Element {
  return <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, background: `linear-gradient(transparent, ${COLORS.bg})`, pointerEvents: 'none' }} />
}
