import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { popoverMotion } from './Animated'
import { useAnchoredMenu } from '../lib/popover'
import { translator } from '../lib/i18n'

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

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

/**
 * A select that also filters: click it and pick as usual, or just start typing (closed or open)
 * and the list narrows to matching options. Arrow keys and Enter work like the project picker.
 */
export function CustomSelect({ value, options, onChange, ariaLabel }: CustomSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // The menu lives in a portal so a card, panel or the scroll area can never clip it;
  // it opens above the field when there is no room below.
  const menuStyle = useAnchoredMenu(open, root, menu)
  const selected = options.find((option) => option.value === value) ?? options[0]
  // The interface language is mirrored on <html lang>, which saves threading a translator through every select.
  const t = translator(document.documentElement.lang === 'en' ? 'en' : 'uk')

  const matches = useMemo(() => {
    const needle = normalize(query)
    if (!needle) return options
    return options
      .filter((option) => normalize(`${option.label} ${option.description ?? ''}`).includes(needle))
      .sort((first, second) => Number(!normalize(first.label).startsWith(needle)) - Number(!normalize(second.label).startsWith(needle)))
  }, [options, query])

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (root.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
      setQuery('')
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  /** Opens the list, highlighting the current choice, or the best match when typing started it. */
  const openWith = (text: string): void => {
    setQuery(text)
    setHighlighted(text ? 0 : Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  const close = (refocus: boolean): void => {
    setOpen(false)
    setQuery('')
    if (refocus) window.requestAnimationFrame(() => trigger.current?.focus())
  }

  const choose = (option: SelectOption): void => {
    onChange(option.value)
    close(true)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      openWith('')
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Typing on the closed select opens it already filtered.
      event.preventDefault()
      openWith(event.key)
    }
  }

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((index) => Math.min(matches.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = matches[highlighted]
      if (option) choose(option)
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }

  const onSearchBlur = (event: React.FocusEvent<HTMLInputElement>): void => {
    const next = event.relatedTarget as Node | null
    if (next && (root.current?.contains(next) || menu.current?.contains(next))) return
    close(false)
  }

  return (
    <div className={`custom-select ${open ? 'custom-select--open' : ''}`} ref={root}>
      {open ? (
        <div className="custom-select__trigger project-picker__field" onClick={(event) => (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
          <Search size={14} className="project-picker__lead" />
          <input
            autoFocus
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded
            value={query}
            placeholder={selected?.label ?? ''}
            onChange={(event) => { setQuery(event.target.value); setHighlighted(0) }}
            onKeyDown={onSearchKeyDown}
            onBlur={onSearchBlur}
          />
          <ChevronDown size={15} />
        </div>
      ) : (
        <button ref={trigger} type="button" className="custom-select__trigger" aria-label={ariaLabel} aria-expanded={false} onClick={() => openWith('')} onKeyDown={onTriggerKeyDown}>
          <span className="custom-select__value">
            {selected?.color && <i style={{ background: selected.color }} />}
            <span><strong>{selected?.label}</strong>{selected?.description && <small>{selected.description}</small>}</span>
          </span>
          <ChevronDown size={15} />
        </button>
      )}
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div ref={menu} className="custom-select__menu no-drag" style={{ ...menuStyle, width: root.current?.offsetWidth }} {...popoverMotion}>
            {matches.length === 0 && <p className="project-picker__empty">{t('noProjectMatches')}</p>}
            {matches.map((option, index) => (
              <button type="button" tabIndex={-1} key={option.value} className={`${option.value === value ? 'selected' : ''} ${index === highlighted ? 'highlighted' : ''}`} onMouseEnter={() => setHighlighted(index)} onClick={() => choose(option)}>
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
