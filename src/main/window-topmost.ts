/** The native window operations needed to restore stacking without stealing focus. */
interface TopmostWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  setAlwaysOnTop(flag: boolean, level: 'pop-up-menu' | 'normal'): void
  moveTop(): void
}

export function syncWindowTopmost(window: TopmostWindow | null, enabled: boolean): void {
  if (!window || window.isDestroyed()) return
  window.setAlwaysOnTop(enabled, enabled ? 'pop-up-menu' : 'normal')
  if (enabled && window.isVisible() && !window.isMinimized()) window.moveTop()
}
