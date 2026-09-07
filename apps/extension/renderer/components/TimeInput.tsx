import { useEffect, useRef, useState } from 'react'

interface TimeInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  autoFocus?: boolean
  ariaLabel?: string
  allowEmpty?: boolean
}

const hours = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0'))

function splitTime(value: string): [string, string] | null {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  return match && hours.includes(match[1]) && minutes.includes(match[2]) ? [match[1], match[2]] : null
}

/** A compact click-only time picker that remains usable in the narrow desktop and extension layouts. */
export function TimeInput({ value, onChange, className, autoFocus = false, ariaLabel = 'Time', allowEmpty = false }: TimeInputProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [part, setPart] = useState<'hour' | 'minute'>('hour')
  const current = splitTime(value)
  const hour = current?.[0] ?? ''
  const minute = current?.[1] ?? ''

  useEffect(() => {
    if (!autoFocus) return
    triggerRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: MouseEvent): void => {
      if (!event.composedPath().includes(rootRef.current as EventTarget)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const chooseHour = (nextHour: string): void => {
    onChange(`${nextHour}:${minute || '00'}`)
    setPart('minute')
  }

  const chooseMinute = (nextMinute: string): void => {
    onChange(`${hour || '00'}:${nextMinute}`)
    setOpen(false)
  }

  const toggle = (): void => {
    setPart('hour')
    setOpen((currentOpen) => !currentOpen)
  }

  return <div ref={rootRef} className={`time-picker ${className ?? ''}`}>
    <button ref={triggerRef} type="button" className="time-picker__trigger" onClick={toggle} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}>
      <span>{current ? `${hour}:${minute}` : '--:--'}</span><i aria-hidden="true">⌄</i>
    </button>
    {open && <div className="time-picker__menu" role="dialog" aria-label={ariaLabel}>
      <div className="time-picker__tabs">
        <button type="button" className={part === 'hour' ? 'active' : ''} onClick={() => setPart('hour')}>{hour || '--'} <small>год</small></button>
        <button type="button" className={part === 'minute' ? 'active' : ''} onClick={() => setPart('minute')}><small>хв</small> {minute || '--'}</button>
      </div>
      <div className={`time-picker__options time-picker__options--${part}`}>
        {(part === 'hour' ? hours : minutes).map((item) => <button key={item} type="button" className={item === (part === 'hour' ? hour : minute) ? 'selected' : ''} onClick={() => part === 'hour' ? chooseHour(item) : chooseMinute(item)}>{item}</button>)}
      </div>
      {allowEmpty && <button type="button" className="time-picker__clear" onClick={() => { onChange(''); setOpen(false) }}>Без часу</button>}
    </div>}
  </div>
}
