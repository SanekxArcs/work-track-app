import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { ThreeCanvas } from '@remotion/three'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import * as THREE from 'three'
import { BRAND, hexToRgb, mulberry32 } from './brand'
import { BrandMark, MarkLights } from './BrandMark'
import { Glow } from './Glow'

const W = 1920
const H = 1080
const FOV = 35
const COUNT = 3600
const MARK_Y = 0.42
const deg = Math.PI / 180

const vert = /* glsl */ `
attribute vec4 aSeed;    // radius, angle0, z0, angular speed
attribute vec4 aTarget;  // target xyz, delay
attribute vec3 aColor;
attribute vec3 aMisc;    // size, kind (0 = converge, 1 = residual orbit), orbit radius
uniform float uT;
uniform float uConv;
uniform float uScale;
uniform vec3 uMark;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float r = aSeed.x;
  float ang = aSeed.y + uT * aSeed.w;
  float zv = aSeed.z + uT * 1.1;
  vec3 vortex = vec3(cos(ang) * r, sin(ang) * r * 0.62 + 0.35, zv + sin(ang * 2.0 + aSeed.y) * 0.6);

  float k = clamp((uConv - aTarget.w * 0.55) / 0.45, 0.0, 1.0);
  vec3 pos;
  float alpha = 1.0;
  float size = aMisc.x;

  if (aMisc.y < 0.5) {
    // stream into the mark along a tightening spiral
    float e = k * k;
    float a2 = ang + e * 4.0;
    float rr = r * (1.0 - e);
    vec3 c = mix(vec3(0.0, 0.35, 0.0), uMark, e);
    vec3 spiral = c + vec3(cos(a2) * rr, sin(a2) * rr * 0.62, mix(zv, aTarget.z, e));
    pos = mix(spiral, aTarget.xyz, e * e);
    alpha *= 1.0 - smoothstep(0.55, 1.0, k);
  } else {
    // ease into a gentle orbit around the mark
    float e = k * k * (3.0 - 2.0 * k);
    float R = aMisc.z;
    float oa = aSeed.y + uT * (0.18 + aSeed.w * 0.6);
    vec3 orbit = uMark + vec3(cos(oa) * R, sin(oa) * R * 0.24 + (aTarget.y - uMark.y) * 0.22, sin(oa) * R * 0.55 - 0.4);
    pos = mix(vortex, orbit, e);
    alpha *= mix(1.0, 0.75, e);
    size *= mix(1.0, 0.8, e);
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(size * uScale / max(d, 0.1), 0.0, 42.0);
  // fade very close particles and keep the lower third of the frame calm
  alpha *= smoothstep(0.6, 3.5, d);
  float ndcY = gl_Position.y / gl_Position.w;
  alpha *= mix(0.08, 1.0, smoothstep(-0.52, -0.16, ndcY));
  vColor = aColor;
  vAlpha = alpha;
}
`

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float g = exp(-d * d * 22.0);
  float core = smoothstep(0.16, 0.0, d);
  vec3 col = vColor * g * 1.25 + vColor * core * 0.6 + vec3(core * 0.35);
  gl_FragColor = vec4(col * vAlpha, 1.0);
}
`

const Particles: React.FC<{ frame: number }> = ({ frame }) => {
  const { geometry, material } = useMemo(() => {
    const rnd = mulberry32(20240611)
    const seed = new Float32Array(COUNT * 4)
    const target = new Float32Array(COUNT * 4)
    const color = new Float32Array(COUNT * 3)
    const misc = new Float32Array(COUNT * 3)
    const pos = new Float32Array(COUNT * 3)
    const palette = [
      { c: hexToRgb(BRAND.lime), w: 0.4 },
      { c: hexToRgb(BRAND.blue), w: 0.22 },
      { c: hexToRgb(BRAND.purple), w: 0.22 },
      { c: hexToRgb(BRAND.warm), w: 0.16 },
    ]
    for (let i = 0; i < COUNT; i++) {
      const r = 1.3 + 13 * Math.pow(rnd(), 0.85)
      seed[i * 4] = r
      // four loose spiral arms, one hue each, plus a diffuse haze
      const arm = Math.floor(rnd() * 4)
      const inArm = rnd() < 0.8
      seed[i * 4 + 1] = inArm ? arm * (Math.PI / 2) + r * 0.32 + (rnd() - 0.5) * 0.55 : rnd() * Math.PI * 2
      seed[i * 4 + 2] = -36 + rnd() * 37
      seed[i * 4 + 3] = (0.25 + rnd() * 0.45) * (3.2 / (2.2 + r * 0.35))
      // targets: inside the rounded square face
      const ta = rnd() * Math.PI * 2
      const tr = Math.sqrt(rnd()) * 0.85
      target[i * 4] = Math.cos(ta) * tr
      target[i * 4 + 1] = MARK_Y + Math.sin(ta) * tr
      target[i * 4 + 2] = (rnd() - 0.5) * 0.4
      target[i * 4 + 3] = rnd()
      let pick = rnd()
      let c = palette[0].c
      if (inArm && rnd() < 0.8) c = palette[arm].c
      else
        for (const p of palette) {
          if (pick < p.w) {
            c = p.c
            break
          }
          pick -= p.w
        }
      const bright = 0.75 + rnd() * 0.35
      color[i * 3] = c[0] * bright
      color[i * 3 + 1] = c[1] * bright
      color[i * 3 + 2] = c[2] * bright
      misc[i * 3] = 0.7 + Math.pow(rnd(), 3) * 2.6
      misc[i * 3 + 1] = rnd() < 0.2 ? 1 : 0
      misc[i * 3 + 2] = 2.0 + Math.pow(rnd(), 0.7) * 3.2
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    g.setAttribute('aTarget', new THREE.BufferAttribute(target, 4))
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
    g.setAttribute('aMisc', new THREE.BufferAttribute(misc, 3))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -15), 100)
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uT: { value: 0 },
        uConv: { value: 0 },
        uScale: { value: (H / 2 / Math.tan((FOV / 2) * deg)) * 0.085 },
        uMark: { value: new THREE.Vector3(0, MARK_Y, 0) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry: g, material: m }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  material.uniforms.uT.value = frame / 30
  material.uniforms.uConv.value = interpolate(frame, [46, 104], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.sin),
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}

const CameraRig: React.FC<{ frame: number }> = ({ frame }) => {
  const camera = useThree((s) => s.camera)
  const z = interpolate(frame, [0, 150], [17.5, 9.2], { easing: Easing.bezier(0.33, 0, 0.2, 1) })
  const x = interpolate(frame, [0, 110], [0.9, 0], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) })
  const y = interpolate(frame, [0, 110], [-0.5, 0], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) })
  camera.position.set(x, y, z)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return null
}

const Scene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const pop = spring({ frame: frame - 60, fps, config: { damping: 13, stiffness: 90, mass: 0.9 } })
  const turn = spring({ frame: frame - 58, fps, config: { damping: 22, stiffness: 40, mass: 1.2 } })
  const scale = interpolate(pop, [0, 1], [0.6, 1])
  const opacity = interpolate(frame, [60, 67], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const glow = interpolate(frame, [58, 66, 108], [2.2, 1.6, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  })
  const settle = interpolate(frame, [96, 130], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const tf = (frame - 96) / 30
  const yaw = interpolate(turn, [0, 1], [35 * deg, 0]) + settle * Math.sin(tf * 1.1) * 5 * deg
  const pitch = interpolate(turn, [0, 1], [-10 * deg, 0]) + settle * Math.sin(tf * 0.8 + 1) * 2.5 * deg
  const floatY = settle * Math.sin(tf * 1.4) * 0.05
  const halo = interpolate(frame, [64, 116], [0, 0.42], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const flash = interpolate(frame, [56, 66, 96], [0, 0.6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <>
      <color attach="background" args={[BRAND.bg]} />
      <CameraRig frame={frame} />
      <MarkLights />
      <Glow color={BRAND.lime} opacity={halo} size={7.5} position={[0, MARK_Y, -1.2]} />
      <Glow color="#eaffd2" opacity={flash} size={4.5} position={[0, MARK_Y, -0.6]} />
      <group position={[0, MARK_Y + floatY, 0]} scale={scale} visible={opacity > 0.001}>
        <BrandMark opacity={opacity} glow={glow} rotation={[pitch, yaw, 0]} />
      </group>
      <Particles frame={frame} />
    </>
  )
}

export const IntroOrb: React.FC = () => {
  const frame = useCurrentFrame()
  const fadeIn = interpolate(frame, [0, 12], [1, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      <ThreeCanvas
        width={W}
        height={H}
        camera={{ fov: FOV, position: [0, 0, 17.5], near: 0.1, far: 200 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1.0
        }}
      >
        <Scene />
      </ThreeCanvas>
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse 75% 70% at 50% 42%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill style={{ background: '#000', opacity: fadeIn, pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}
