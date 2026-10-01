import { useLayoutEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/**
 * Positions a menu rendered in a portal beside its trigger, flipping above and
 * sliding sideways so it always stays inside the window instead of being cut off.
 * It re-places itself when either element resizes (e.g. a filtered list shrinking)
 * and keeps the side it opened on while that side still fits, so it does not jump.
 */
export function useAnchoredMenu(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return
    let side: 'below' | 'above' | undefined
    const place = (): void => {
      const trigger = anchor.current
      const element = menu.current
      if (!trigger || !element) return
      const rect = trigger.getBoundingClientRect()
      const width = element.offsetWidth
      const height = element.offsetHeight
      const margin = 8
      const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin))
      const below = rect.bottom + 6
      const above = rect.top - 6 - height
      const fitsBelow = below + height <= window.innerHeight - margin
      const fitsAbove = above >= margin
      if (side === 'above' ? !fitsAbove : side === 'below' ? !fitsBelow : true) side = fitsBelow ? 'below' : fitsAbove ? 'above' : undefined
      const top = side === 'below' ? below : side === 'above' ? above : Math.max(margin, window.innerHeight - height - margin)
      setStyle({ position: 'fixed', top, left, right: 'auto', bottom: 'auto', zIndex: 1000, visibility: 'visible' })
    }
    place()
    const observer = new ResizeObserver(place)
    if (anchor.current) observer.observe(anchor.current)
    if (menu.current) observer.observe(menu.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, menu])

  return style
}
