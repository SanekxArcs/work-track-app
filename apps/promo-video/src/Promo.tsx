import { AbsoluteFill, Audio, Sequence, Series, interpolate, staticFile } from 'remotion'
import { SCENES, TOTAL_FRAMES, sceneStart, type SceneId } from './timeline'
import { Intro, Outro } from './scenes/Bookends'
import { Problem } from './scenes/Problem'
import { Parallel } from './scenes/Parallel'
import { Notch } from './scenes/Notch'
import { Compact } from './scenes/Compact'
import { COMMAND_AT, VOICE_B_AT, Voice } from './scenes/Voice'
import { Breaks } from './scenes/Breaks'
import { Insights } from './scenes/Insights'
import { Everywhere } from './scenes/Everywhere'
import timings from '../public/audio/timings.json'

export const SCENE_COMPONENTS: Partial<Record<SceneId, React.FC<{ duration: number }>>> = {
  intro: Intro,
  problem: Problem,
  parallel: Parallel,
  notch: Notch,
  compact: Compact,
  voice: Voice,
  breaks: Breaks,
  insights: Insights,
  everywhere: Everywhere,
  outro: Outro
}

const FPS = 30
const at = (id: SceneId, frame: number): number => sceneStart(id) + frame
const voAt = (id: SceneId): number => at(id, SCENES.find((scene) => scene.id === id)!.voAt)

/** Every spoken clip: [file, start frame, length in frames]. */
const VOICE: Array<[string, number, number]> = [
  ...SCENES.filter((scene) => scene.id !== 'voice').map((scene) => [`audio/vo/${scene.id}.mp3`, voAt(scene.id), Math.ceil(timings.vo[scene.id] * FPS)] as [string, number, number]),
  ['audio/vo/voice-a.mp3', voAt('voice'), Math.ceil(2.05 * FPS)],
  ['audio/vo/command.mp3', at('voice', COMMAND_AT), Math.ceil(timings.vo.command * FPS)],
  ['audio/vo/voice-b.mp3', at('voice', VOICE_B_AT), Math.ceil(5.36 * FPS)]
]

type Sfx = 'whoosh' | 'whoosh-soft' | 'click' | 'pop' | 'chime' | 'shimmer' | 'boom' | 'tick'
const SFX: Array<[Sfx, number, number]> = [
  ['boom', at('intro', 58), 0.55],
  ['whoosh', at('problem', 0), 0.5],
  ...[6, 37, 68].map((f) => ['pop', at('problem', f), 0.55] as [Sfx, number, number]),
  ['whoosh', at('parallel', 0), 0.55],
  ...[62, 112, 178, 232].map((f) => ['click', at('parallel', f), 0.8] as [Sfx, number, number]),
  ...[64, 114, 234].map((f) => ['pop', at('parallel', f), 0.5] as [Sfx, number, number]),
  ['whoosh', at('notch', 0), 0.5],
  ['whoosh-soft', at('notch', 40), 0.5],
  ['whoosh-soft', at('notch', 116), 0.75],
  ['whoosh-soft', at('notch', 216), 0.5],
  ['whoosh', at('compact', 0), 0.5],
  ...[46, 176, 252].map((f) => ['click', at('compact', f), 0.8] as [Sfx, number, number]),
  ...[50, 182, 258].map((f) => ['whoosh-soft', at('compact', f), 0.45] as [Sfx, number, number]),
  ['pop', at('compact', 106), 0.4],
  ['whoosh', at('voice', 0), 0.5],
  ...[66, 172, 304].map((f) => ['click', at('voice', f), 0.8] as [Sfx, number, number]),
  ['shimmer', at('voice', 174), 0.6],
  ['pop', at('voice', 198), 0.5],
  ['whoosh', at('breaks', 0), 0.5],
  ['chime', at('breaks', 16), 0.75],
  ['click', at('breaks', 72), 0.8],
  ...[96, 102, 108, 114].map((f) => ['tick', at('breaks', f), 0.5] as [Sfx, number, number]),
  ['whoosh', at('insights', 0), 0.5],
  ...[18, 30, 42].map((f) => ['whoosh-soft', at('insights', f), 0.35] as [Sfx, number, number]),
  ['shimmer', at('insights', 166), 0.5],
  ['whoosh', at('everywhere', 0), 0.5],
  ['click', at('everywhere', 46), 0.8],
  ['pop', at('everywhere', 48), 0.5],
  ...[70, 92, 114].map((f) => ['tick', at('everywhere', f), 0.5] as [Sfx, number, number]),
  ['boom', at('outro', 2), 0.7]
]

/** Music sits under the voice: louder in gaps, ducked while someone speaks, faded at both ends. */
function musicVolume(frame: number): number {
  const speaking = VOICE.some(([, start, length]) => frame >= start - 6 && frame <= start + length + 6)
  const nearest = VOICE.reduce((best, [, start, length]) => Math.min(best, Math.max(0, start - 6 - frame, frame - (start + length + 6))), 1e9)
  const duck = speaking ? 1 : Math.max(0, 1 - nearest / 10)
  const level = 0.62 - 0.32 * duck
  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' })
  const fadeOut = interpolate(frame, [TOTAL_FRAMES - 40, TOTAL_FRAMES], [1, 0], { extrapolateLeft: 'clamp' })
  return level * fadeIn * fadeOut
}

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: '#0a0b0a' }}>
    <Series>
      {SCENES.map((scene) => {
        const Scene = SCENE_COMPONENTS[scene.id]
        return <Series.Sequence key={scene.id} durationInFrames={scene.frames}>{Scene ? <Scene duration={scene.frames} /> : null}</Series.Sequence>
      })}
    </Series>
    <Audio src={staticFile('audio/music.wav')} volume={musicVolume} />
    {VOICE.map(([file, start, length]) => (
      <Sequence key={file} from={start} durationInFrames={length + 15}><Audio src={staticFile(file)} volume={file.includes('command') ? 1.3 : 1} /></Sequence>
    ))}
    {SFX.map(([name, start, volume], index) => (
      <Sequence key={`${name}-${index}`} from={start} durationInFrames={90}><Audio src={staticFile(`audio/sfx/${name}.wav`)} volume={volume} /></Sequence>
    ))}
  </AbsoluteFill>
)
