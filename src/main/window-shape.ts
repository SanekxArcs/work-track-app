import type { WindowRect } from './window-layout'
/** Scanline region excludes every transparent rounded corner from native hit testing. */
export function surfaceRegion(
  rect: WindowRect,
  radius: number,
  roundTop: boolean,
  roundBottom: boolean,
  roundLeft = true,
  roundRight = true
): WindowRect[] {
  const x = Math.ceil(rect.x),
    y = Math.ceil(rect.y),
    width = Math.max(0, Math.floor(rect.x + rect.width) - x),
    height = Math.max(0, Math.floor(rect.y + rect.height) - y)
  if (!width || !height) return []
  const r = Math.min(Math.max(0, radius), width / 2, height / 2),
    rows: WindowRect[] = []
  for (let row = 0; row < height; row++) {
    const distance =
      roundTop && row < r
        ? r - row - 0.5
        : roundBottom && height - row <= r
          ? r - (height - row) + 0.5
          : 0
    const inset =
      distance > 0
        ? Math.ceil(r - Math.sqrt(Math.max(0, r * r - distance * distance)))
        : 0
    const left = roundLeft ? inset : 0,
      right = roundRight ? inset : 0
    const previous = rows.at(-1),
      line = { x: x + left, y: y + row, width: width - left - right, height: 1 }
    if (line.width <= 0) continue
    if (
      previous &&
      previous.x === line.x &&
      previous.width === line.width &&
      previous.y + previous.height === line.y
    )
      previous.height++
    else rows.push(line)
  }
  return rows
}
export function notchBounds(
  area: WindowRect,
  center: number,
  size: { width: number; height: number },
  edge: 'top' | 'bottom'
): WindowRect {
  const width = Math.min(size.width, area.width),
    height = Math.min(size.height, area.height)
  return {
    x: Math.round(
      Math.min(
        Math.max(center - width / 2, area.x),
        area.x + area.width - width
      )
    ),
    y: edge === 'bottom' ? area.y + area.height - height : area.y,
    width,
    height
  }
}
