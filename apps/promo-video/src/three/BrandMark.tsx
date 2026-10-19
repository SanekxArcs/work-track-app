import { useEffect, useMemo } from 'react'
import { useThree, type ThreeElements } from '@react-three/fiber'
import * as THREE from 'three'
import { BRAND, makeStudioEnvironment, roundedPolygonShape, roundedRectShape } from './brand'

const SIZE = 2
const DEPTH = 0.34
const BEVEL_T = 0.14
const BEVEL_S = 0.1
/** z of the lime front face after centring. */
const FRONT_Z = DEPTH / 2 + BEVEL_T

export type BrandMarkProps = {
  /** 0..1 material opacity. */
  opacity?: number
  /** Extra lime emissive glow (used while materialising). */
  glow?: number
} & Omit<ThreeElements['group'], 'children'>

/** The Work Buddy mark: an extruded lime rounded square with an ink play glyph. Unit size ~2.2 world units. */
export const BrandMark: React.FC<BrandMarkProps> = ({ opacity = 1, glow = 0, ...group }) => {
  const gl = useThree((s) => s.gl)
  const env = useMemo(() => makeStudioEnvironment(gl), [gl])

  const { body, tri } = useMemo(() => {
    const body = new THREE.ExtrudeGeometry(roundedRectShape(SIZE, SIZE * 0.35), {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: BEVEL_T,
      bevelSize: BEVEL_S,
      bevelSegments: 12,
      curveSegments: 48,
    })
    body.center()
    body.computeVertexNormals()
    // ▶ glyph: bounding box shifted slightly right of centre for optical balance
    const tShape = roundedPolygonShape(
      [
        [-0.3, 0.5],
        [0.56, 0],
        [-0.3, -0.5],
      ],
      0.13,
    )
    const tri = new THREE.ExtrudeGeometry(tShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.03,
      bevelSegments: 6,
      curveSegments: 16,
    })
    tri.translate(0.02, 0, FRONT_Z - 0.03)
    return { body, tri }
  }, [])

  const mats = useMemo(() => {
    const lime = new THREE.MeshPhysicalMaterial({
      color: BRAND.lime,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      sheen: 0.4,
      sheenColor: new THREE.Color('#effbd9'),
      sheenRoughness: 0.5,
      emissive: new THREE.Color(BRAND.lime),
      transparent: true,
      envMap: env,
      envMapIntensity: 1.0,
    })
    const ink = new THREE.MeshPhysicalMaterial({
      color: BRAND.ink,
      roughness: 0.32,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      transparent: true,
      envMap: env,
      envMapIntensity: 1.1,
    })
    return { lime, ink }
  }, [env])

  useEffect(
    () => () => {
      body.dispose()
      tri.dispose()
      mats.lime.dispose()
      mats.ink.dispose()
      env.dispose()
    },
    [body, tri, mats, env],
  )

  // Deterministic per-render material state (pure function of props).
  mats.lime.opacity = opacity
  mats.ink.opacity = opacity
  mats.lime.emissiveIntensity = 0.04 + glow
  mats.lime.depthWrite = opacity > 0.98
  mats.ink.depthWrite = opacity > 0.98

  return (
    <group {...group}>
      <mesh geometry={body} material={mats.lime} renderOrder={1} />
      <mesh geometry={tri} material={mats.ink} renderOrder={2} />
    </group>
  )
}

/** Studio lights shared by both shots. */
export const MarkLights: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => (
  <>
    <ambientLight intensity={0.12 * intensity} />
    <directionalLight position={[-4, 5, 7]} intensity={2.4 * intensity} color="#ffffff" />
    <directionalLight position={[5, -1, 5]} intensity={0.6 * intensity} color="#f2ffe6" />
    <pointLight position={[-4.5, 1.5, -3]} intensity={30 * intensity} distance={14} decay={2} color={BRAND.blue} />
    <pointLight position={[4.5, 2.5, -3]} intensity={30 * intensity} distance={14} decay={2} color={BRAND.purple} />
    <pointLight position={[-1.6, 2.2, 3.2]} intensity={9 * intensity} distance={9} decay={2} color="#ffffff" />
    <pointLight position={[0, -3.5, 2]} intensity={10 * intensity} distance={10} decay={2} color={BRAND.warm} />
  </>
)
