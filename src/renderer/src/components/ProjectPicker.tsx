import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, FolderPlus, Search } from 'lucide-react'
import type { AppSnapshot, Project } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { useAnchoredMenu } from '../lib/popover'

interface ProjectPickerProps {
  value: string
  snapshot: AppSnapshot
  ariaLabel: string
  autoFocus?: boolean
  t: Translator
  onChange: (projectId: string) => void
  onSnapshot: (snapshot: AppSnapshot) => void
  onError: (message: string) => void
}

type Row =
  | { kind: 'none' }
  | { kind: 'project'; project: Project }
  | { kind: 'create'; name: string }

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

/** Prefer a palette color no project uses yet, then fall back to any palette color. */
export function randomProjectColor(snapshot: AppSnapshot): string {
  const palette = snapshot.settings.projectColors
  const used = new Set(snapshot.projects.map((project) => project.color.toLowerCase()))
  const unused = palette.filter((color) => !used.has(color.toLowerCase()))
  const pool = unused.length ? unused : palette
  return pool[Math.floor(Math.random() * pool.length)]
}

export function ProjectPicker({ value, snapshot, ariaLabel, autoFocus, t, onChange, onSnapshot, onError }: ProjectPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuStyle = useAnchoredMenu(open, root, menu)
  const selected = snapshot.projects.find((project) => project.id === value)

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

  const rows = useMemo((): Row[] => {
    const needle = normalize(query)
    const order = new Map(snapshot.projects.map((project, index) => [project.id, index]))
    const matches = snapshot.projects
      .filter((project) => (needle ? normalize(project.name).includes(needle) : !project.archived))
      .sort((first, second) => {
        // Prefix matches first, then active before archived.
        const firstStarts = needle && normalize(first.name).startsWith(needle) ? 0 : 1
        const secondStarts = needle && normalize(second.name).startsWith(needle) ? 0 : 1
        return firstStarts - secondStarts || Number(first.archived) - Number(second.archived) || (order.get(first.id) ?? 0) - (order.get(second.id) ?? 0)
      })
    const result: Row[] = []
    if (!needle) result.push({ kind: 'none' })
    result.push(...matches.map((project): Row => ({ kind: 'project', project })))
    if (needle && !snapshot.projects.some((project) => normalize(project.name) === needle)) result.push({ kind: 'create', name: query.trim() })
    return result
  }, [query, snapshot.projects])

  useEffect(() => setHighlighted(0), [query, open])

  const create = async (name: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.workBuddy.createProject({ name, color: randomProjectColor(snapshot) })
      const created = result.projects.find((project) => normalize(project.name) === normalize(name))
      onSnapshot(result)
      if (created) onChange(created.id)
      setOpen(false)
      setQuery('')
    } catch (error) {
      onError(error instanceof Error ? error.message : t('timeUpdateError'))
    } finally {
      setBusy(false)
    }
  }

  const choose = (row: Row): void => {
    if (row.kind === 'create') {
      void create(row.name)
      return
    }
    onChange(row.kind === 'project' ? row.project.id : '')
    setOpen(false)
    setQuery('')
    input.current?.blur()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((index) => Math.min(rows.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[highlighted]
      if (open && row) choose(row)
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className={`custom-select project-picker ${open ? 'custom-select--open' : ''}`} ref={root}>
      <div className="custom-select__trigger project-picker__field" onClick={() => input.current?.focus()}>
        {open ? <Search size={14} className="project-picker__lead" /> : selected ? <i className="project-picker__dot" style={{ background: selected.color }} /> : null}
        <input
          ref={input}
          autoFocus={autoFocus}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          value={open ? query : selected?.name ?? ''}
          placeholder={open ? t('projectSearchPlaceholder') : t('noProject')}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
        />
        <ChevronDown size={15} />
      </div>
      {createPortal(<AnimatePresence>
        {open && (
          <motion.div ref={menu} className="custom-select__menu project-picker__menu" style={{ ...menuStyle, width: root.current?.offsetWidth }} initial={{ opacity: 0, y: -5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.14 }}>
            {rows.length === 0 && <p className="project-picker__empty">{t('noProjectMatches')}</p>}
            {rows.map((row, index) => {
              const key = row.kind === 'project' ? row.project.id : row.kind
              const active = index === highlighted
              if (row.kind === 'create') {
                return (
                  <button type="button" key={key} className={`project-picker__create ${active ? 'highlighted' : ''}`} disabled={busy} onMouseEnter={() => setHighlighted(index)} onClick={() => choose(row)}>
                    <FolderPlus size={15} />
                    <span><strong>{t('createProjectNamed')} «{row.name}»</strong></span>
                  </button>
                )
              }
              const project = row.kind === 'project' ? row.project : undefined
              const isSelected = (project?.id ?? '') === value
              return (
                <button type="button" key={key} className={`${isSelected ? 'selected' : ''} ${active ? 'highlighted' : ''}`} onMouseEnter={() => setHighlighted(index)} onClick={() => choose(row)}>
                  {project ? <i style={{ background: project.color }} /> : <i className="project-picker__dot--none" />}
                  <span><strong>{project?.name ?? t('noProject')}</strong>{project?.archived && <small>{t('archivedTag')}</small>}</span>
                  {isSelected && <Check size={14} />}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
