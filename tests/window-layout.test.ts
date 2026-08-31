import assert from 'node:assert/strict'
import test from 'node:test'
import { fitWindowHeight, isBottomAnchored } from '../src/main/window-layout.ts'

const area = { x: 0, y: 0, width: 1920, height: 1040 }

test('lifting an editor from a bottom-anchored window keeps its lower edge visible', () => {
  const compactHeight = 280
  const initial = { x: 1490, y: area.height - compactHeight, width: 430, height: compactHeight }
  const expanded = fitWindowHeight(initial, area, 700, isBottomAnchored(initial, area), 230)

  assert.equal(expanded.height, 700)
  assert.equal(expanded.y, area.height - 700)
  assert.equal(expanded.y + expanded.height, area.height)
})

test('restoring a manually sized window keeps the saved size and bottom anchor', () => {
  const initial = { x: 1490, y: 680, width: 430, height: 360 }
  const restored = fitWindowHeight(initial, area, initial.height, isBottomAnchored(initial, area), 230)

  assert.deepEqual(restored, initial)
})

test('content fitting clamps an oversized request to the visible work area', () => {
  const initial = { x: 1490, y: 740, width: 430, height: 300 }
  const fitted = fitWindowHeight(initial, area, 5000, true, 230)

  assert.equal(fitted.height, 1024)
  assert.equal(fitted.y, 16)
})
