import { Composition } from 'remotion'
import { FPS, HEIGHT, SCENES, TOTAL_FRAMES, WIDTH } from './timeline'
import { Promo, SCENE_COMPONENTS } from './Promo'
import { IntroOrb } from './three/IntroOrb'
import { OutroMark } from './three/OutroMark'

export const Root: React.FC = () => (
  <>
    <Composition id="WorkBuddyPromo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Intro3D" component={IntroOrb} durationInFrames={150} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Outro3D" component={OutroMark} durationInFrames={180} fps={FPS} width={WIDTH} height={HEIGHT} />
    {SCENES.map((scene) => {
      const Scene = SCENE_COMPONENTS[scene.id]
      return Scene ? <Composition key={scene.id} id={`S-${scene.id}`} component={() => <Scene duration={scene.frames} />} durationInFrames={scene.frames} fps={FPS} width={WIDTH} height={HEIGHT} /> : null
    })}
  </>
)
