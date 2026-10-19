import * as THREE from 'three'

export const BRAND = {
  bg: '#0a0b0a',
  lime: '#b8e986',
  blue: '#7bdff2',
  purple: '#cdb4db',
  warm: '#f7a072',
  ink: '#17200e',
} as const

/** Raw (non color-managed) sRGB triple, for custom shaders that write straight to the canvas. */
export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Deterministic PRNG. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rounded square centred on the origin. */
export const roundedRectShape = (size: number, radius: number) => {
  const h = size / 2
  const r = Math.min(radius, h)
  const s = new THREE.Shape()
  s.moveTo(-h + r, -h)
  s.lineTo(h - r, -h)
  s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false)
  s.lineTo(h, h - r)
  s.absarc(h - r, h - r, r, 0, Math.PI / 2, false)
  s.lineTo(-h + r, h)
  s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-h, -h + r)
  s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

/** Polygon with softly rounded corners (quadratic curves). */
export const roundedPolygonShape = (pts: [number, number][], round: number) => {
  const s = new THREE.Shape()
  const n = pts.length
  const P = pts.map(([x, y]) => new THREE.Vector2(x, y))
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n]
    const cur = P[i]
    const next = P[(i + 1) % n]
    const a = cur.clone().add(prev.clone().sub(cur).setLength(round))
    const b = cur.clone().add(next.clone().sub(cur).setLength(round))
    if (i === 0) s.moveTo(a.x, a.y)
    else s.lineTo(a.x, a.y)
    s.quadraticCurveTo(cur.x, cur.y, b.x, b.y)
  }
  s.closePath()
  return s
}

/** Soft radial glow sprite texture. */
export const makeGlowTexture = (stops: [number, string][], size = 256) => {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [o, col] of stops) g.addColorStop(o, col)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A procedural studio environment (softboxes in brand tints), prefiltered with PMREM. Fully offline. */
export const makeStudioEnvironment = (gl: THREE.WebGLRenderer) => {
  const scene = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#070807'), side: THREE.BackSide }),
  )
  scene.add(room)
  const box = (color: string, intensity: number, w: number, h: number, pos: [number, number, number]) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    scene.add(m)
  }
  box('#ffffff', 5, 30, 8, [0, 30, 6]) // top strip
  box('#ffffff', 3.2, 14, 18, [-26, 8, 24]) // key softbox front-left
  box('#ffffff', 0.9, 34, 12, [0, 16, 34]) // broad soft panel behind/above camera: face sheen gradient
  box('#f4fff0', 1.4, 10, 10, [24, -2, 22]) // fill front-right
  box(BRAND.blue, 3.5, 6, 30, [-30, 0, -22]) // rim back-left
  box(BRAND.purple, 3.0, 6, 30, [30, 4, -20]) // rim back-right
  box(BRAND.warm, 1.6, 30, 4, [0, -26, 10]) // warm bounce below
  const pmrem = new THREE.PMREMGenerator(gl)
  const rt = pmrem.fromScene(scene, 0.03)
  pmrem.dispose()
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  return rt.texture
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
