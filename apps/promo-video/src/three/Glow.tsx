import { useEffect, useMemo } from 'react'
import { type ThreeElements } from '@react-three/fiber'
import * as THREE from 'three'
import { makeGlowTexture } from './brand'

type GlowProps = {
  color: string
  opacity: number
  size: number | [number, number]
} & Omit<ThreeElements['mesh'], 'children'>

/** Additive soft radial glow card. */
export const Glow: React.FC<GlowProps> = ({ color, opacity, size, ...mesh }) => {
  const tex = useMemo(
    () =>
      makeGlowTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.18, 'rgba(255,255,255,0.55)'],
        [0.45, 'rgba(255,255,255,0.16)'],
        [0.75, 'rgba(255,255,255,0.03)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
    [],
  )
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [tex],
  )
  useEffect(
    () => () => {
      tex.dispose()
      mat.dispose()
    },
    [tex, mat],
  )
  mat.color.set(color)
  mat.opacity = opacity
  const [w, h] = Array.isArray(size) ? size : [size, size]
  return (
    <mesh {...mesh} material={mat} visible={opacity > 0.001}>
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}
