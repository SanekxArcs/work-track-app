import assert from 'node:assert/strict'
import test from 'node:test'
import { surfaceRegion, notchBounds } from '../src/main/window-shape.ts'
const inside = (
  region: ReturnType<typeof surfaceRegion>,
  x: number,
  y: number
) =>
  region.some(
    (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
  )
test('notch native hit regions exclude rounded transparent corners and every pixel outside the visible surface', () => {
  const top = surfaceRegion(
    { x: 83, y: 0, width: 264, height: 30 },
    11,
    false,
    true
  )
  assert.equal(inside(top, 83, 29), false)
  assert.equal(inside(top, 84, 0), true)
  assert.equal(inside(top, 215, 29), true)
  assert.equal(inside(top, 82, 15), false)
  assert.equal(inside(top, 347, 15), false)
  assert.equal(inside(top, 215, 30), false)
  const bottom = surfaceRegion(
    { x: 83, y: 470, width: 264, height: 30 },
    11,
    true,
    false
  )
  assert.equal(inside(bottom, 83, 470), false)
  assert.equal(inside(bottom, 83, 499), true)
  assert.equal(inside(bottom, 215, 469), false)
  const closing = surfaceRegion(
    { x: 45, y: 0, width: 340, height: 240 },
    11,
    false,
    true
  )
  assert.equal(inside(closing, 30, 20), false)
  assert.equal(inside(closing, 200, 250), false)
})
test('notch bounds retain the requested edge when opening and on negative-coordinate displays', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1040 }
  const closed = notchBounds(area, -960, { width: 264, height: 30 }, 'bottom')
  const open = notchBounds(area, -960, { width: 430, height: 700 }, 'bottom')
  assert.equal(closed.y + closed.height, 840)
  assert.equal(open.y + open.height, 840)
  assert.equal(closed.x + closed.width / 2, open.x + open.width / 2)
  assert.equal(
    notchBounds(area, -99999, { width: 430, height: 700 }, 'top').x,
    area.x
  )
  assert.equal(
    notchBounds(area, -960, { width: 430, height: 700 }, 'top').y,
    -200
  )
})
