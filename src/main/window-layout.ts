export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

/** Keep a resized transparent window fully reachable on its current display. */
export function fitWindowHeight(
  bounds: WindowRect,
  workArea: WindowRect,
  requestedHeight: number,
  keepBottom: boolean,
  minHeight = 64,
  inset = 16
): WindowRect {
  const maxHeight = Math.max(minHeight, workArea.height - inset)
  const height = Math.min(maxHeight, Math.max(minHeight, Math.round(requestedHeight)))
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width)
  const maxY = workArea.y + Math.max(0, workArea.height - height)
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: keepBottom ? maxY : Math.min(Math.max(bounds.y, workArea.y), maxY),
    height
  }
}

export function isBottomAnchored(bounds: WindowRect, workArea: WindowRect, tolerance = 16): boolean {
  return Math.abs(bounds.y + bounds.height - (workArea.y + workArea.height)) <= tolerance
}
