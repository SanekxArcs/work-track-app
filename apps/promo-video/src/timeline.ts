export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

/** Scene order and lengths in frames. Voiceover for each scene starts at `voAt` frames into the scene. */
export const SCENES = [
  { id: 'intro', frames: 150, voAt: 20 },
  { id: 'problem', frames: 215, voAt: 6 },
  { id: 'parallel', frames: 340, voAt: 10 },
  { id: 'notch', frames: 290, voAt: 10 },
  { id: 'compact', frames: 300, voAt: 10 },
  { id: 'voice', frames: 380, voAt: 6 },
  { id: 'breaks', frames: 235, voAt: 10 },
  { id: 'insights', frames: 370, voAt: 10 },
  { id: 'everywhere', frames: 240, voAt: 10 },
  { id: 'outro', frames: 180, voAt: 30 }
] as const

export type SceneId = (typeof SCENES)[number]['id']

export const sceneStart = (id: SceneId): number => {
  let at = 0
  for (const scene of SCENES) {
    if (scene.id === id) return at
    at += scene.frames
  }
  throw new Error(id)
}

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.frames, 0)
