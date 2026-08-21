import { useEffect, useState } from 'react'

interface TimeInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  autoFocus?: boolean
  ariaLabel?: string
}

function normalizeTime(value: string): string | undefined {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return undefined
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function TimeInput({ value, onChange, className, autoFocus = false, ariaLabel }: TimeInputProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    const normalized = normalizeTime(draft)
    if (!normalized) {
      setDraft(value)
      return
    }
    setDraft(normalized)
    onChange(normalized)
  }

  return <input
    className={className}
    type="text"
    inputMode="numeric"
    autoComplete="off"
    autoFocus={autoFocus}
    maxLength={5}
    placeholder="HH:MM"
    aria-label={ariaLabel}
    value={draft}
    onChange={(event) => {
      const next = event.target.value.replace(/[^0-9:]/g, '')
      setDraft(next)
      const normalized = normalizeTime(next)
      if (normalized) onChange(normalized)
    }}
    onBlur={commit}
  />
}
