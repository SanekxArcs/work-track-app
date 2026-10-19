import { useCurrentFrame } from 'remotion'
import { ChevronLeft, ChevronRight, HardDrive, Lock, RotateCw, ShieldCheck, WifiOff } from 'lucide-react'
import { DESK_TASKS, FocusApp } from '../ui/app'
import { Cursor, Words, compactDuration, pop, tween } from '../ui/kit'
import { Slides } from '../ui/layout'
import { Backdrop, COLORS, DISPLAY_FONT, Eyebrow, SceneFade, subStyle, titleStyle } from '../ui/stage'

const OPEN = 46
const BW = 1120
const BH = 760

function Browser({ frame }: { frame: number }): React.JSX.Element {
  const panel = pop(frame, OPEN, 22, 220)
  const worked = 5 * 3600 + 2 * 60 + frame / 30
  return (
    <div style={{ width: BW, height: BH, borderRadius: 18, overflow: 'hidden', background: '#f4f5f2', boxShadow: '0 60px 140px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)', position: 'relative' }}>
      <div style={{ height: 50, background: '#202421', display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', color: '#9aa196' }}>
        <div style={{ display: 'flex', gap: 8 }}>{['#ff6b5f', '#f6c445', '#5cc552'].map((c) => <i key={c} style={{ width: 12, height: 12, borderRadius: 9, background: c }} />)}</div>
        <ChevronLeft size={18} /><ChevronRight size={18} /><RotateCw size={15} />
        <div style={{ flex: 1, height: 32, borderRadius: 16, background: '#151816', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', fontFamily: 'Segoe UI', fontSize: 14, color: '#c3c9bf' }}><Lock size={13} />code.example.dev/northwind/checkout/pull/482</div>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: '#b8e986', display: 'grid', placeItems: 'center' }}><span style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '8px solid #17200e', marginLeft: 2 }} /></div>
      </div>
      <div style={{ padding: '34px 46px', fontFamily: 'Segoe UI', color: '#1d211e' }}>
        <div style={{ fontSize: 30, fontWeight: 700 }}>Speed up checkout payment step <span style={{ color: '#7b8278', fontWeight: 400 }}>#482</span></div>
        <div style={{ marginTop: 10, display: 'inline-block', padding: '5px 12px', borderRadius: 20, background: '#2f9e44', color: '#fff', fontSize: 14, fontWeight: 600 }}>Open</div>
        {[0.92, 0.74, 0.86, 0.6].map((w, i) => <div key={i} style={{ marginTop: i === 0 ? 30 : 14, height: 14, width: `${w * 60}%`, borderRadius: 7, background: '#dfe2dc' }} />)}
        <div style={{ marginTop: 30, width: '58%', borderRadius: 12, border: '1px solid #dfe2dc', overflow: 'hidden', fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 14 }}>
          {['- const session = createSession(cart)', '+ const session = await createSession(cart)', '+ if (!session.ok) return retry()', '  return <PaymentStep order={order} />'].map((line) => <div key={line} style={{ padding: '6px 12px', background: line.startsWith('+') ? '#e6f6dc' : line.startsWith('-') ? '#fde4e0' : '#fafbf9' }}>{line}</div>)}
        </div>
      </div>
      <div className="wb" style={{ position: 'absolute', right: 14, bottom: 14, width: 30, height: 30, borderRadius: 10, background: '#111310', display: 'grid', placeItems: 'center', boxShadow: '0 6px 18px rgba(0,0,0,.3)', transform: `scale(${1 + (Math.abs(frame - OPEN) < 4 ? -0.1 : 0)})` }}><div className="brand-mark" style={{ width: 22, height: 22, borderRadius: 8 }}><span /></div></div>
      {panel > 0.01 && <div className="wb" style={{ position: 'absolute', right: 14, bottom: 54, width: 430, height: 620, borderRadius: 22, background: 'rgba(14,16,13,.94)', boxShadow: '0 30px 80px rgba(0,0,0,.45)', opacity: Math.min(1, panel), transform: `translateY(${(1 - panel) * 30}px) scale(${0.94 + 0.06 * panel})`, transformOrigin: '100% 100%', overflow: 'hidden' }}>
        <FocusApp frame={frame} tasks={DESK_TASKS(frame + 900)} header={<Slides frame={frame} slides={[{ label: 'Worked today', value: compactDuration(worked) }, { label: 'running now', value: '2' }]} period={70} />} height={620} />
      </div>}
    </div>
  )
}

export const Everywhere: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const enter = pop(frame, 0, 22, 90)
  const scale = 0.86
  const features = [
    { at: 70, icon: HardDrive, title: 'Local first', body: 'Your data lives in SQLite, on your PC.', color: COLORS.lime },
    { at: 92, icon: ShieldCheck, title: 'Private by design', body: 'Your Gemini key stays encrypted.', color: COLORS.blue },
    { at: 114, icon: WifiOff, title: 'Works offline', body: 'No account. No cloud required.', color: COLORS.purple }
  ]
  return (
    <SceneFade frame={frame} duration={duration}>
      <Backdrop frame={frame} tint={COLORS.blue} second={COLORS.lime} />
      <div style={{ position: 'absolute', left: 110, top: 120 + (1 - enter) * 100, perspective: 2600, opacity: Math.min(1, enter * 1.5) }}>
        <div style={{ transform: `rotateY(${10 - 6 * tween(frame, 0, duration)}deg) scale(${scale})`, transformOrigin: '0 0', position: 'relative' }}>
          <Browser frame={frame} />
          <Cursor frame={frame} path={[{ f: 14, x: 760, y: 420 }, { f: OPEN, x: BW - 26, y: BH - 26 }, { f: duration, x: 560, y: 520 }]} clicks={[OPEN]} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1180, top: 200, width: 680 }}>
        <Eyebrow color={COLORS.blue} style={{ opacity: tween(frame, 4, 18) }}>Chrome extension</Eyebrow>
        <Words frame={frame} at={10} text={'In Chrome, too.'} gradientWords={['too.']} style={{ ...titleStyle, fontSize: 92, marginTop: 20 }} />
        <Words frame={frame} at={28} stagger={2} text={'Same buddy, on every tab.'} style={{ ...subStyle, fontSize: 30, marginTop: 24 }} />
        <div style={{ display: 'grid', gap: 18, marginTop: 50 }}>
          {features.map(({ at, icon: Icon, title, body, color }) => {
            const k = pop(frame, at, 18, 160)
            return (
              <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: Math.min(1, k), transform: `translateX(${(1 - Math.min(1, k)) * 40}px)` }}>
                <div style={{ width: 70, height: 70, borderRadius: 22, display: 'grid', placeItems: 'center', color, background: `${color}17`, border: `1px solid ${color}40` }}><Icon size={32} /></div>
                <div style={{ fontFamily: DISPLAY_FONT }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: COLORS.text, letterSpacing: '-0.02em' }}>{title}</div>
                  <div style={{ fontSize: 22, color: '#a7aea1', marginTop: 3 }}>{body}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </SceneFade>
  )
}
