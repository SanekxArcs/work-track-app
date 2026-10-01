import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { useAnchoredMenu } from '../lib/popover'

interface ColorPickerProps {
  value: string
  colors: string[]
  onChange: (value: string) => void
  ariaLabel: string
}

export function ColorPicker({ value, colors, onChange, ariaLabel }: ColorPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuStyle = useAnchoredMenu(open, root, menu)
  const isCustom = !colors.some((color) => color.toLowerCase() === value.toLowerCase())

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
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
    {createPortal(<AnimatePresence>
      {open && <motion.div ref={menu} className="color-picker__menu color-picker__menu--floating" style={menuStyle} initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .98 }} transition={{ duration: .14 }}>
        {colors.map((color) => <button type="button" key={color} className={color === value ? 'selected' : ''} style={{ background: color }} aria-label={color} title={color.toUpperCase()} onClick={() => { onChange(color); setOpen(false) }}>
          {color === value && <Check size={13} />}
        </button>)}
        <label className={`color-picker__custom ${isCustom ? 'selected' : ''}`} title={ariaLabel}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#b8e986'} onChange={(event) => onChange(event.target.value)} />
          <span>+</span>
        </label>
      </motion.div>}
    </AnimatePresence>, document.body)}
  </div>
}
