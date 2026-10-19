import { AbsoluteFill, staticFile, useCurrentFrame } from 'remotion'
import { useAudioData, visualizeAudio } from '@remotion/media-utils'
import { ChevronDown, LoaderCircle, Mic, Sparkles, Square, Trash2, X } from 'lucide-react'
import { AppFrame, FocusActions, FocusHero, Header, PROJECTS, TabBar, TaskCard, type VideoTask } from '../ui/app'
import { Caret, Cursor, Words, compactDuration, mix, pop, tween, typed } from '../ui/kit'
import { Showcase } from '../ui/layout'
import { Backdrop, BottomFade, COLORS, DISPLAY_FONT, Eyebrow, SceneFade, subStyle, titleStyle } from '../ui/stage'

export const COMMAND_AT = 76
export const VOICE_B_AT = 198
const MIC = 66
const STOP = 172
const APPLY = 196
const SAVE = 304
const TRANSCRIPT = 'Reviewing the checkout pull request for the Northwind store.'
const NOTES = 'Review the checkout pull request'

function Waveform({ frame, active }: { frame: number; active: number }): React.JSX.Element {
  const audio = useAudioData(staticFile('audio/vo/command.mp3'))
  const bars = 38
  const values = Array.from({ length: bars }, (_, index) => {
    const center = Math.abs(index - (bars - 1) / 2) / (bars / 2)
    let level = 0.06 + 0.05 * Math.sin(frame / 4 + index)
    if (audio && frame >= COMMAND_AT && frame < COMMAND_AT + 90) {
      const spectrum = visualizeAudio({ fps: 30, frame: frame - COMMAND_AT, audioData: audio, numberOfSamples: 64, smoothing: true })
      level = Math.min(1, spectrum[Math.floor(center * 18) + 1] * 7 + 0.05)
    }
    return level * (1 - center * 0.55) * active
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 120 }}>
      {values.map((value, index) => {
        const hue = index / bars
        const color = hue < 0.33 ? COLORS.lime : hue < 0.66 ? COLORS.blue : COLORS.purple
        return <span key={index} style={{ width: 8, height: Math.max(8, value * 120), borderRadius: 8, background: color, boxShadow: `0 0 18px ${color}88`, opacity: 0.9 }} />
      })}
    </div>
  )
}

export const Voice: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame()
  const sheet = pop(frame, 10, 26, 300) * (1 - tween(frame, SAVE + 2, SAVE + 14))
  const recording = frame >= MIC && frame < STOP
  const processing = frame >= STOP && frame < APPLY
  const applied = frame >= APPLY
  const notes = applied ? typed(NOTES, frame, APPLY + 4, 1.6) : ''
  const projectK = tween(frame, APPLY, APPLY + 8)
  const saved = frame >= SAVE + 6
  const worked = 4 * 3600 + 48 * 60 + frame / 30

  const task: VideoTask = saved
    ? { id: 'new', title: NOTES, project: PROJECTS.northwind, seconds: 96 + frame / 30, running: true }
    : { id: 'new', title: 'Untitled', seconds: 96 + frame / 30, running: true }
  const others: VideoTask[] = [
    { id: 'bug', title: 'Fix flaky login test', project: PROJECTS.bugs, seconds: 2671 + frame / 30, running: true },
    { id: 'sync', title: 'Sprint sync with the team', project: PROJECTS.calls, seconds: 2245, running: false }
  ]
  const savedGlow = tween(frame, SAVE + 6, SAVE + 16) * (1 - tween(frame, SAVE + 30, SAVE + 60))

  const bubble = tween(frame, MIC + 2, MIC + 16) * (1 - tween(frame, APPLY + 30, APPLY + 46))
  const listen = tween(frame, MIC, MIC + 10) * (1 - tween(frame, STOP, STOP + 8))
  const sweep = tween(frame, STOP, APPLY + 6, 0, 1, (t) => t)

  // The voice button sits in the sheet's action row; its spot in app coordinates.
  const micX = 72
  const micY = 600
  const path = [
    { f: 16, x: 330, y: 420 },
    { f: MIC, x: micX, y: micY },
    { f: STOP - 30, x: micX + 30, y: micY - 30 },
    { f: STOP, x: micX, y: micY },
    { f: SAVE - 30, x: 300, y: 520 },
    { f: SAVE, x: 330, y: micY },
    { f: duration, x: 360, y: 470 }
  ]

  return (
    <SceneFade frame={frame} duration={duration}>
      <Backdrop frame={frame} tint={COLORS.purple} second={COLORS.blue} />
      <div style={{ position: 'absolute', left: 150, top: 200, width: 820 }}>
        <Eyebrow color={COLORS.purple} style={{ opacity: tween(frame, 4, 18) }}>Voice + Gemini</Eyebrow>
        <Words frame={frame} at={10} text={'Just say it.'} gradientWords={['say']} style={{ ...titleStyle, fontSize: 112, marginTop: 22 }} />
        <Words frame={frame} at={30} stagger={2} text={'Gemini turns your words into a named task.\nProject included.'} style={{ ...subStyle, fontSize: 30, marginTop: 30 }} />
        <div style={{ marginTop: 60, opacity: bubble, transform: `translateY(${(1 - bubble) * 20}px) scale(${0.96 + 0.04 * bubble})`, transformOrigin: '0 50%' }}>
          <div style={{ width: 760, padding: '26px 34px', borderRadius: 34, background: 'rgba(22,24,22,.82)', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 30px 80px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: DISPLAY_FONT, fontSize: 20, fontWeight: 600, color: applied ? COLORS.lime : processing ? COLORS.purple : COLORS.warm }}>
              {processing || applied ? <Sparkles size={22} /> : <Mic size={22} />}
              {applied ? 'Task updated' : processing ? 'Gemini is thinking…' : 'Listening…'}
            </div>
            <div style={{ height: 120, marginTop: 6, opacity: 0.25 + 0.75 * listen }}><Waveform frame={frame} active={0.25 + 0.75 * listen} /></div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 30, fontWeight: 500, color: COLORS.text, letterSpacing: '-0.015em', minHeight: 42 }}>
              “{typed(TRANSCRIPT, frame, COMMAND_AT + 4, 0.72)}{recording && <Caret frame={frame} color={COLORS.warm} />}{frame > COMMAND_AT + 90 ? '”' : ''}
            </div>
          </div>
        </div>
      </div>

      <Showcase x={1010} y={70} scale={1.55} rotateY={-12 + 6 * tween(frame, 0, duration)} rotateX={3} glow={COLORS.purple} opacity={tween(frame, 0, 12)}>
        <AppFrame height={640}>
          <Header label={<>Worked today<b>{compactDuration(worked)}</b></>} />
          <div className="expanded-view">
            <TabBar active={0} />
            <div className="content-scroll" style={{ overflow: 'hidden' }}>
              <div className="page-stack">
                <FocusHero frame={frame} eyebrow="2 active now" seconds={task.seconds + others[0].seconds} segments={[{ left: 0, width: 30, color: COLORS.blue }, { left: 34, width: 40, color: COLORS.warm }, { left: 80, width: 20, color: saved ? '#f6d365' : COLORS.lime }]} />
                <FocusActions live />
                <div className="task-list">
                  <TaskCard task={task} frame={frame} style={{ boxShadow: `0 0 0 ${2 * savedGlow}px rgba(246,211,101,${0.8 * savedGlow}), 0 0 ${40 * savedGlow}px rgba(246,211,101,${0.35 * savedGlow})` }} />
                  {others.map((item) => <TaskCard key={item.id} task={item} frame={frame} />)}
                </div>
              </div>
            </div>
          </div>
          {sheet > 0.01 && <div className="modal-backdrop" style={{ background: `rgba(6,8,6,${0.35 * sheet})` }}>
            <section className="modal-sheet" style={{ transform: `translateY(${(1 - sheet) * 60}px)`, opacity: sheet, position: 'relative', overflow: 'hidden' }}>
              {sweep > 0 && sweep < 1 && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(100deg, transparent ${mix(-30, 100, sweep)}%, rgba(205,180,219,.22) ${mix(-15, 115, sweep)}%, transparent ${mix(0, 130, sweep)}%)`, pointerEvents: 'none' }} />}
              <div className="modal-header"><button className="icon-button"><X size={18} /></button></div>
              <div className="field">
                <span>Project</span>
                <div className="custom-select project-picker">
                  <div className="custom-select__trigger project-picker__field" style={projectK > 0 ? { borderColor: `rgba(246,211,101,${0.6 * (1 - tween(frame, APPLY + 30, APPLY + 60))})` } : undefined}>
                    {projectK > 0 && <i className="project-picker__dot" style={{ background: PROJECTS.northwind.color, opacity: projectK }} />}
                    <input readOnly value={projectK > 0 ? PROJECTS.northwind.name : ''} placeholder="Choose a project" style={{ opacity: projectK > 0 ? projectK : 1 }} />
                    <ChevronDown size={15} />
                  </div>
                </div>
              </div>
              <div className="task-time-fields">
                <label className="field time-edit-field"><span>When this session started</span>
                  <div className="time-picker time-input block"><div className="time-picker__trigger">14:24</div></div>
                </label>
              </div>
              <label className="field">
                <span>Short description</span>
                <textarea readOnly rows={3} value={notes} placeholder="What are you working on right now…" />
              </label>
              {applied && <p className="ai-note" style={{ opacity: tween(frame, APPLY + 24, APPLY + 34) }}>Voice command applied: {NOTES} · Northwind store</p>}
              <div className="modal-actions">
                <button className="icon-button icon-button--quiet delete-task-icon"><Trash2 size={15} /></button>
                <div className="ai-editor-actions">
                  {applied && <button className="secondary-button ai-refine-button"  style={{ opacity: tween(frame, APPLY + 10, APPLY + 18) }}><Sparkles size={14} />Refine AI</button>}
                  <button className={`voice-button ${recording ? 'voice-button--recording' : ''}`} style={recording ? { boxShadow: `0 0 0 ${5 * (0.5 + 0.5 * Math.sin(frame / 4.8))}px rgba(247,160,114,.12)` } : undefined}>
                    {processing ? <LoaderCircle size={15} style={{ transform: `rotate(${frame * 14}deg)` }} /> : recording ? <Square size={13} fill="currentColor" /> : <Mic size={15} />}
                  </button>
                </div>
                <button className="primary-button" style={Math.abs(frame - SAVE) < 4 ? { transform: 'scale(.96)' } : undefined}>Save</button>
              </div>
            </section>
          </div>}
        </AppFrame>
        <Cursor frame={frame} path={path} clicks={[MIC, STOP, SAVE]} scale={0.85} />
      </Showcase>
      <BottomFade height={120} />
    </SceneFade>
  )
}
