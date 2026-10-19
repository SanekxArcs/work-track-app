import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { ThreeCanvas } from '@remotion/three'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import * as THREE from 'three'
import { BRAND, hexToRgb, makeGlowTexture } from './brand'
import { BrandMark, MarkLights } from './BrandMark'
import { Glow } from './Glow'

const W = 1920
const H = 1080
const FOV = 32
const MARK_Y = 0.55
const deg = Math.PI / 180

class EllipseCurve3 extends THREE.Curve<THREE.Vector3> {
  constructor(
    private a: number,
    private b: number,
  ) {
    super()
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const ang = t * Math.PI * 2
    return target.set(Math.cos(ang) * this.a, Math.sin(ang) * this.b, 0)
  }
}

const ringVert = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec3 n = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`

const ringFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
uniform float uOpacity;
uniform float uGlow;
varying vec2 vUv;
varying float vFacing;
void main() {
  if (vUv.x > uProgress) discard;
  float t = vUv.x / max(uProgress, 1e-4);
  float trail = mix(0.18, 1.0, smoothstep(0.0, 1.0, t));
  float head = smoothstep(0.9, 1.0, t);
  float profile = uGlow > 0.5 ? pow(vFacing, 2.5) : mix(0.65, 1.0, vFacing);
  vec3 col = mix(uColor, vec3(1.0), (uGlow > 0.5 ? 0.0 : 0.25 + head * 0.5));
  gl_FragColor = vec4(col * profile * trail * uOpacity, 1.0);
}
`

type RingSpec = {
  color: string
  a: number
  b: number
  tilt: [number, number, number]
  start: number
  phase: number
  spin: number
}

const RINGS: RingSpec[] = [
  { color: BRAND.lime, a: 3.3, b: 3.1, tilt: [61 * deg, 0, -6 * deg], start: 12, phase: 0.62, spin: 1 },
  { color: BRAND.blue, a: 3.8, b: 3.5, tilt: [60 * deg, 6 * deg, 8 * deg], start: 22, phase: 0.1, spin: -1 },
  { color: BRAND.purple, a: 4.3, b: 3.9, tilt: [66 * deg, -5 * deg, 3 * deg], start: 32, phase: 0.35, spin: 1 },
  { color: BRAND.warm, a: 3.0, b: 2.9, tilt: [58 * deg, 0, -13 * deg], start: 42, phase: 0.85, spin: -1 },
]

const makeRingMat = (color: string, glow: boolean) =>
  new THREE.ShaderMaterial({
    vertexShader: ringVert,
    fragmentShader: ringFrag,
    uniforms: {
      uColor: { value: new THREE.Vector3(...hexToRgb(color)) },
      uProgress: { value: 0 },
      uOpacity: { value: 1 },
      uGlow: { value: glow ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

const Ring: React.FC<{ spec: RingSpec; frame: number; headTex: THREE.Texture }> = ({ spec, frame, headTex }) => {
  const { curve, core, glow, coreMat, glowMat, headMat } = useMemo(() => {
    const curve = new EllipseCurve3(spec.a, spec.b)
    return {
      curve,
      core: new THREE.TubeGeometry(curve, 420, 0.014, 8, false),
      glow: new THREE.TubeGeometry(curve, 420, 0.075, 10, false),
      coreMat: makeRingMat(spec.color, false),
      glowMat: makeRingMat(spec.color, true),
      headMat: new THREE.SpriteMaterial({
        map: headTex,
        color: new THREE.Color(spec.color),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    }
  }, [spec, headTex])

  useEffect(
    () => () => {
      core.dispose()
      glow.dispose()
      coreMat.dispose()
      glowMat.dispose()
      headMat.dispose()
    },
    [core, glow, coreMat, glowMat, headMat],
  )

  const progress = interpolate(frame, [spec.start, spec.start + 70], [0, 0.93], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.22, 0.6, 0.25, 1),
  })
  const opacity = interpolate(frame, [spec.start, spec.start + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  coreMat.uniforms.uProgress.value = progress
  glowMat.uniforms.uProgress.value = progress
  coreMat.uniforms.uOpacity.value = opacity
  glowMat.uniforms.uOpacity.value = opacity * 0.55
  headMat.opacity = opacity * 0.9
  const head = curve.getPoint(Math.max(progress, 0.0001))
  // after drawing, keep the whole timer ring slowly orbiting
  const spinAngle = spec.phase * Math.PI * 2 + spec.spin * frame * 0.0035

  return (
    <group rotation={spec.tilt}>
      <group rotation={[0, 0, spinAngle]}>
        <mesh geometry={glow} material={glowMat} renderOrder={3} />
        <mesh geometry={core} material={coreMat} renderOrder={4} />
        <sprite material={headMat} position={head} scale={0.42} renderOrder={5} visible={progress > 0.001} />
      </group>
    </group>
  )
}

const CameraRig: React.FC<{ frame: number }> = ({ frame }) => {
  const camera = useThree((s) => s.camera)
  const z = interpolate(frame, [0, 180], [12.4, 11.4], { easing: Easing.inOut(Easing.sin) })
  camera.position.set(0, MARK_Y - 0.35, z)
  camera.lookAt(0, -0.2, 0)
  camera.updateMatrixWorld()
  return null
}

const Scene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const headTex = useMemo(
    () =>
      makeGlowTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.12, 'rgba(255,255,255,0.8)'],
        [0.35, 'rgba(255,255,255,0.18)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
    [],
  )
  useEffect(() => () => headTex.dispose(), [headTex])

  const pop = spring({ frame: frame - 2, fps, config: { damping: 16, stiffness: 80, mass: 1 } })
  const scale = interpolate(pop, [0, 1], [0.55, 1])
  const opacity = interpolate(frame, [2, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const glow = interpolate(frame, [2, 10, 50], [1.4, 1.0, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const yaw = interpolate(frame, [0, 180], [-20 * deg, 10 * deg], { easing: Easing.inOut(Easing.sin) })
  const tf = frame / 30
  const floatY = Math.sin(tf * 1.3) * 0.05
  const pitch = 4 * deg + Math.sin(tf * 0.9 + 0.6) * 2 * deg
  const halo = interpolate(frame, [4, 60], [0, 0.32], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <>
      <color attach="background" args={[BRAND.bg]} />
      <CameraRig frame={frame} />
      <MarkLights />
      <Glow color={BRAND.lime} opacity={halo} size={8} position={[0, MARK_Y, -2]} />
      <Glow color={BRAND.blue} opacity={halo * 0.35} size={6} position={[-2.2, MARK_Y + 0.4, -3]} />
      <Glow color={BRAND.purple} opacity={halo * 0.35} size={6} position={[2.2, MARK_Y + 0.3, -3]} />
      <Glow color={BRAND.lime} opacity={halo * 0.55} size={[7.5, 1.5]} position={[0, MARK_Y - 1.3, -0.8]} />
      <group position={[0, MARK_Y, 0]} scale={0.8}>
        {RINGS.map((r) => (
          <Ring key={r.color} spec={r} frame={frame} headTex={headTex} />
        ))}
      </group>
      <group position={[0, MARK_Y + floatY, 0]} scale={scale} visible={opacity > 0.001}>
        <BrandMark opacity={opacity} glow={glow} rotation={[pitch, yaw, 0]} />
      </group>
    </>
  )
}

export const OutroMark: React.FC = () => {
  const frame = useCurrentFrame()
  const fadeIn = interpolate(frame, [0, 10], [1, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      <ThreeCanvas
        width={W}
        height={H}
        camera={{ fov: FOV, position: [0, MARK_Y - 0.35, 12.4], near: 0.1, far: 200 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping
        }}
      >
        <Scene />
      </ThreeCanvas>
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse 70% 65% at 50% 40%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%)',
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill style={{ background: '#000', opacity: fadeIn, pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}
