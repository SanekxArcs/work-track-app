import { mix } from './kit'

export interface Shot { s: number; px: number; py: number; fx: number; fy: number }

/** Blend two camera shots; `px,py` is the point of the scene placed at frame point `fx,fy`. */
export function blendShot(a: Shot, b: Shot, t: number): Shot {
  // Interpolate zoom geometrically so pushes feel constant-speed.
  const s = Math.exp(mix(Math.log(a.s), Math.log(b.s), t))
  return { s, px: mix(a.px, b.px, t), py: mix(a.py, b.py, t), fx: mix(a.fx, b.fx, t), fy: mix(a.fy, b.fy, t) }
}

export function shotTransform(shot: Shot): string {
  return `translate(${shot.fx - shot.px * shot.s}px, ${shot.fy - shot.py * shot.s}px) scale(${shot.s})`
}

export function toFrame(shot: Shot, x: number, y: number): { x: number; y: number } {
  return { x: shot.fx + (x - shot.px) * shot.s, y: shot.fy + (y - shot.py) * shot.s }
}
