import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { Collapse, ease } from './Animated'

const STORAGE_KEY = 'work-buddy:settings-open'

function readOpenState(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {}
  } catch {
    return {}
  }
}

interface SettingsSectionProps {
  /** Stable key the open/closed state is remembered under. */
  id: string
  icon: ReactNode
  title: string
  /** Shown under the title only while the section is open, keeping the collapsed list short. */
  body?: string
  /** A control that lives in the header (a toggle); clicking it never folds the section. */
  control?: ReactNode
  className?: string
  defaultOpen?: boolean
  children: ReactNode
}

/** One foldable card on the settings page; every section remembers whether it was left open. */
export function SettingsSection({ id, icon, title, body, control, className, defaultOpen = false, children }: SettingsSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(() => readOpenState()[id] ?? defaultOpen)
  const toggle = (): void => setOpen((current) => {
    const next = !current
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOpenState(), [id]: next })) } catch { /* private mode: forget */ }
    return next
  })
  return <section className={`settings-section settings-section--collapsible ${open ? 'settings-section--open' : ''} ${className ?? ''}`}>
    <div
      className="settings-title settings-title--toggle"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() } }}
    >
      {icon}
      <div><h3>{title}</h3></div>
      {control && <div className="settings-title__control" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{control}</div>}
      <motion.span className="settings-title__chevron" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease }}><ChevronDown size={15} /></motion.span>
    </div>
    <Collapse open={open}>
      <div className="settings-section__body">
        {body && <p className="settings-section__intro">{body}</p>}
        {children}
      </div>
    </Collapse>
  </section>
}
