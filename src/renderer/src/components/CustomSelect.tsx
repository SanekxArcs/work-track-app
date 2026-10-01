import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { popoverMotion } from './Animated'
import { useAnchoredMenu } from '../lib/popover'

export interface SelectOption {
  value: string
  label: string
  description?: string
  color?: string
}

interface CustomSelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
}

export function CustomSelect({ value, options, onChange, ariaLabel }: CustomSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // The menu lives in a portal so a card, panel or the scroll area can never clip it;
  // it opens above the field when there is no room below.
  const menuStyle = useAnchoredMenu(open, root, menu)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className={`custom-select ${open ? 'custom-select--open' : ''}`} ref={root}>
      <button type="button" className="custom-select__trigger" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="custom-select__value">
          {selected?.color && <i style={{ background: selected.color }} />}
          <span><strong>{selected?.label}</strong>{selected?.description && <small>{selected.description}</small>}</span>
        </span>
        <ChevronDown size={15} />
      </button>
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div ref={menu} className="custom-select__menu no-drag" style={{ ...menuStyle, width: root.current?.offsetWidth }} {...popoverMotion}>
            {options.map((option) => (
              <button type="button" key={option.value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false) }}>
                {option.color && <i style={{ background: option.color }} />}
                <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
