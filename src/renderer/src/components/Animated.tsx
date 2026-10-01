import NumberFlow, { NumberFlowGroup } from '@number-flow/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

/** One shared feel for every opening, closing and swapping element. */
export const ease = [0.22, 1, 0.36, 1] as const
export const springSoft = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const
const two = { minimumIntegerDigits: 2 } as const

function durationParts(milliseconds: number): [hours: number, minutes: number, seconds: number] {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  return [Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60]
}

/** Same text as formatDuration, with digits that roll instead of jumping. */
export function AnimatedDuration({ ms, compact = false, className }: { ms: number; compact?: boolean; className?: string }): React.JSX.Element {
  const [hours, minutes, seconds] = durationParts(ms)
  if (compact) {
    return <NumberFlowGroup><span className={`animated-number ${className ?? ''}`}>
      {hours > 0 && <><NumberFlow value={hours} suffix="h" /> </>}
      <NumberFlow value={minutes} suffix="m" />
    </span></NumberFlowGroup>
  }
  return <NumberFlowGroup><span className={`animated-number ${className ?? ''}`}>
    <NumberFlow value={hours} format={two} />:<NumberFlow value={minutes} format={two} digits={{ 1: { max: 5 } }} />:<NumberFlow value={seconds} format={two} digits={{ 1: { max: 5 } }} />
  </span></NumberFlowGroup>
}

/** HH:MM, as formatHm. */
export function AnimatedHm({ ms, className }: { ms: number; className?: string }): React.JSX.Element {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  return <NumberFlowGroup><span className={`animated-number ${className ?? ''}`}>
    <NumberFlow value={Math.floor(totalMinutes / 60)} format={two} />:<NumberFlow value={totalMinutes % 60} format={two} digits={{ 1: { max: 5 } }} />
  </span></NumberFlowGroup>
}

export function AnimatedNumber({ value, suffix, prefix, className }: { value: number; suffix?: string; prefix?: string; className?: string }): React.JSX.Element {
  return <NumberFlow className={`animated-number ${className ?? ''}`} value={value} suffix={suffix} prefix={prefix} />
}

/** Cross-fades a short label when its text changes, sliding the new one in from below. */
export function AnimatedText({ text, className }: { text: string; className?: string }): React.JSX.Element {
  return <span className={`animated-text ${className ?? ''}`}>
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={text} initial={{ opacity: 0, y: '0.45em' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '-0.45em' }} transition={{ duration: 0.2, ease }}>
        {text}
      </motion.span>
    </AnimatePresence>
  </span>
}

/** Opens and closes its content by animating the height, so nothing below jumps. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }): React.JSX.Element {
  return <AnimatePresence initial={false}>
    {open && <motion.div
      className={`collapse ${className ?? ''}`}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ height: { duration: 0.26, ease }, opacity: { duration: 0.18 } }}
    >{children}</motion.div>}
  </AnimatePresence>
}

/** One open/close motion for every floating menu and popover, so they all feel the same. */
export const popoverMotion = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.98 },
  transition: { duration: 0.16, ease }
} as const

/**
 * An item in a flex column with `gap` that grows out of nothing, swallowing its gap too, so the
 * siblings below glide instead of jumping. Use as a direct, keyed child of AnimatePresence.
 * Overflow is clipped only while it moves, so shadows stay intact once it has settled.
 */
export function StackItem({ children, gap = 12, className }: { children: ReactNode; gap?: number; className?: string }): React.JSX.Element {
  return <motion.div
    className={`stack-item ${className ?? ''}`}
    initial={{ height: 0, opacity: 0, marginTop: -gap, overflow: 'hidden' }}
    animate={{ height: 'auto', opacity: 1, marginTop: 0, transitionEnd: { overflow: 'visible' } }}
    exit={{ height: 0, opacity: 0, marginTop: -gap, overflow: 'hidden' }}
    transition={{ height: { duration: 0.26, ease }, marginTop: { duration: 0.26, ease }, opacity: { duration: 0.18 } }}
  >{children}</motion.div>
}

/** Collapse for an item inside a flex column with `gap` (see StackItem). */
export function StackCollapse({ open, children, gap = 12, className }: { open: boolean; children: ReactNode; gap?: number; className?: string }): React.JSX.Element {
  return <AnimatePresence initial={false}>
    {open && <StackItem gap={gap} className={className}>{children}</StackItem>}
  </AnimatePresence>
}

/** Cross-fades a small piece of content (usually an icon) when `id` changes. */
export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }): React.JSX.Element {
  return <span className={`swap ${className ?? ''}`}>
    <AnimatePresence initial={false}>
      <motion.span key={id} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.16, ease }}>
        {children}
      </motion.span>
    </AnimatePresence>
  </span>
}

/** Fades a short inline element (an error line, a hint, a small button) in and out where it sits. */
export function Fade({ show, children }: { show: boolean; children: ReactNode }): React.JSX.Element {
  return <AnimatePresence initial={false}>
    {show && <motion.span className="fade-wrap" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.16, ease }}>{children}</motion.span>}
  </AnimatePresence>
}
