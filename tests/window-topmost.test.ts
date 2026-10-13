import assert from 'node:assert/strict'
import test from 'node:test'
import { syncWindowTopmost } from '../src/main/window-topmost.ts'

function mockWindow(options: { destroyed?: boolean; visible?: boolean; minimized?: boolean } = {}) {
  const calls: unknown[] = []
  return {
    calls,
    isDestroyed: () => options.destroyed ?? false,
    isVisible: () => options.visible ?? true,
    isMinimized: () => options.minimized ?? false,
    setAlwaysOnTop: (flag: boolean, level: string) => { calls.push([flag, level]) },
    moveTop: () => { calls.push('moveTop') }
  }
}

test('restores stacking even when the native topmost flag was already set, without focusing', () => {
  const window = mockWindow()
  syncWindowTopmost(window, true)
  syncWindowTopmost(window, true)
  assert.deepEqual(window.calls, [[true, 'pop-up-menu'], 'moveTop', [true, 'pop-up-menu'], 'moveTop'])
})

test('disabling always-on-top restores normal stacking without raising the window', () => {
  const window = mockWindow()
  syncWindowTopmost(window, false)
  assert.deepEqual(window.calls, [[false, 'normal']])
})

test('hidden and minimized windows are not raised', () => {
  for (const options of [{ visible: false }, { minimized: true }]) {
    const window = mockWindow(options)
    syncWindowTopmost(window, true)
    assert.deepEqual(window.calls, [[true, 'pop-up-menu']])
  }
})

test('missing and destroyed windows are ignored', () => {
  const window = mockWindow({ destroyed: true })
  syncWindowTopmost(null, true)
  syncWindowTopmost(window, true)
  assert.deepEqual(window.calls, [])
})
