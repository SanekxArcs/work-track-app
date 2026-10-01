import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle } from 'lucide-react'
import { springSoft } from './Animated'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}

/** A small modal for destructive actions; focus starts on Cancel so Enter never destroys by accident. */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, busy = false, error, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancel.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  return createPortal(<AnimatePresence>
    {open && <motion.div className="confirm-backdrop no-drag" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
      <motion.section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="confirm-dialog" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.97 }} transition={springSoft}>
        <span className="confirm-dialog__icon"><AlertTriangle size={17} /></span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog__body">{body}</div>
        {error && <p className="form-error">{error}</p>}
        <div className="confirm-dialog__actions">
          <button ref={cancel} className="secondary-button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button className="danger-button confirm-dialog__confirm" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </motion.section>
    </motion.div>}
  </AnimatePresence>, document.body)
}
