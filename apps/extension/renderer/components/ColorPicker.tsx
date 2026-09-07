import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from '../../lib/motion-shim'
import { Check, ChevronDown } from 'lucide-react'

interface ColorPickerProps {
  value: string
  colors: string[]
  onChange: (value: string) => void
  ariaLabel: string
}

export function ColorPicker({ value, colors, onChange, ariaLabel }: ColorPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  return <div className={`color-picker ${open ? 'color-picker--open' : ''}`} ref={root}>
    <button type="button" className="color-picker__trigger" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <i style={{ background: value }} />
      <span>{value.toUpperCase()}</span>
      <ChevronDown size={14} />
    </button>
    <AnimatePresence>
      {open && <motion.div className="color-picker__menu" initial={{ opacity: 0, y: -4, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: .98 }} transition={{ duration: .14 }}>
        {colors.map((color) => <button type="button" key={color} className={color === value ? 'selected' : ''} style={{ background: color }} aria-label={color} title={color.toUpperCase()} onClick={() => { onChange(color); setOpen(false) }}>
          {color === value && <Check size={13} />}
        </button>)}
      </motion.div>}
    </AnimatePresence>
  </div>
}
