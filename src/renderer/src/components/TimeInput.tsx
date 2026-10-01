import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Clock3 } from 'lucide-react'
import { useAnchoredMenu } from '../lib/popover'
import { popoverMotion } from './Animated'

interface TimeInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  autoFocus?: boolean
  ariaLabel?: string
  allowEmpty?: boolean
  /** When set, shows a button that jumps to this time (e.g. the end of the previous task). */
  previousTime?: string
}

const hours = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0'))

const labels = {
  uk: { hours: 'Години', minutes: 'Хвилини', now: 'Зараз', previous: 'Попередня', done: 'Готово', clear: 'Без часу', type: 'ГГ:ХХ' },
  en: { hours: 'Hours', minutes: 'Minutes', now: 'Now', previous: 'Prev', done: 'Done', clear: 'No time', type: 'HH:MM' }
}

function splitTime(value: string): [string, string] | null {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  return match && hours.includes(match[1]) && minutes.includes(match[2]) ? [match[1], match[2]] : null
}

/** Keeps at most four digits and inserts the colon while typing; a typed colon ends the hour, so `9:30` works. */
function maskTime(raw: string): string {
  const colon = raw.indexOf(':')
  if (colon !== -1) {
    const hour = raw.slice(0, colon).replace(/\D/g, '').slice(0, 2)
    const minute = raw.slice(colon + 1).replace(/\D/g, '').slice(0, 2)
    return `${hour}:${minute}`
  }
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
}

/** Pads a one-digit hour (`9:30` → `09:30`) so it can be committed. */
function padHour(value: string): string {
  return /^\d:\d{2}$/.test(value) ? `0${value}` : value
}

function Column({ items, selected, label, onPick }: { items: string[]; selected: string; label: string; onPick: (item: string) => void }): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = list.current?.querySelector<HTMLElement>('[data-selected="true"]')
    if (element && list.current) list.current.scrollTop = element.offsetTop - list.current.clientHeight / 2 + element.clientHeight / 2
  }, [])

  return <div className="tp-column" role="listbox" aria-label={label}>
    <span className="tp-column__label">{label}</span>
    <div className="tp-column__list" ref={list}>
      {items.map((item) => <button key={item} type="button" role="option" aria-selected={item === selected} data-selected={item === selected} className={item === selected ? 'selected' : ''} onClick={() => onPick(item)}>{item}</button>)}
    </div>
  </div>
}

/** A time field you can type into or pick from two scrollable hour and minute columns. */
export function TimeInput({ value, onChange, className, autoFocus = false, ariaLabel = 'Time', allowEmpty = false, previousTime }:TimeInputProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const typedRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuStyle = useAnchoredMenu(open, rootRef, menuRef)
  const copy = labels[document.documentElement.lang === 'en' ? 'en' : 'uk']
  const current = splitTime(value)
  const hour = current?.[0] ?? ''
  const minute = current?.[1] ?? ''

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (!open) return
    typedRef.current?.select()
    const closeOnOutside = (event: MouseEvent): void => {
      const path = event.composedPath()
      if (!path.includes(rootRef.current as EventTarget) && !path.includes(menuRef.current as EventTarget)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside, true)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [open])

  const type = (raw: string): void => {
    const masked = maskTime(raw)
    setDraft(masked)
    const normalized = padHour(masked)
    if (splitTime(normalized)) onChange(normalized)
  }

  const setNow = (): void => {
    const date = new Date()
    onChange(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
  }

  return <div ref={rootRef} className={`time-picker ${className ?? ''}`}>
    <button ref={triggerRef} type="button" className="time-picker__trigger" onClick={() => setOpen((isOpen) => !isOpen)} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}>
      <Clock3 size={14} aria-hidden="true" />
      <span>{current ? `${hour}:${minute}` : '--:--'}</span>
    </button>
    {createPortal(<AnimatePresence>{open && <motion.div ref={menuRef} className="tp-menu" style={menuStyle} role="dialog" aria-label={ariaLabel} {...popoverMotion}>
      <input
        ref={typedRef}
        className="tp-typed"
        inputMode="numeric"
        value={draft}
        placeholder={copy.type}
        aria-label={ariaLabel}
        onChange={(event) => type(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setOpen(false) } }}
        onBlur={() => setDraft(value)}
      />
      <div className="tp-columns">
        <Column items={hours} selected={hour} label={copy.hours} onPick={(item) => onChange(`${item}:${minute || '00'}`)} />
        <span className="tp-colon">:</span>
        <Column items={minutes} selected={minute} label={copy.minutes} onPick={(item) => onChange(`${hour || '00'}:${item}`)} />
      </div>
      <div className="tp-footer">
        <button type="button" className="tp-secondary" onClick={setNow}>{copy.now}</button>
        {previousTime && <button type="button" className="tp-secondary" onClick={() => onChange(previousTime)} title={previousTime}>{copy.previous}</button>}
        {allowEmpty && <button type="button" className="tp-secondary tp-secondary--danger" onClick={() => { onChange(''); setOpen(false) }}>{copy.clear}</button>}
        <button type="button" className="tp-done" onClick={() => setOpen(false)}>{copy.done}</button>
      </div>
    </motion.div>}</AnimatePresence>, document.body)}
  </div>
}
