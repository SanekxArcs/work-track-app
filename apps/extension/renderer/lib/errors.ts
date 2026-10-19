import { remoteErrorCode } from '../../lib/remote-api'
import type { MessageKey, Translator } from './i18n'

/** Turns a failed bridge call into text for the interface. */
export function errorText(error: unknown, t: Translator, fallback: MessageKey = 'requestFailed'): string {
  const code = remoteErrorCode(error)
  if (code === 'offline') return t('extensionOffline')
  if (code === 'invalidated') return t('extensionReloaded')
  const message = error instanceof Error ? error.message.trim() : ''
  const splitErrors: Record<string, string> = {
    'Only today’s active task can be split': 'Розділити можна сьогоднішню активну задачу',
    'Task changed; reopen the editor': 'Задача змінилася; відкрийте редактор знову',
    'Invalid split time': 'Некоректний момент поділу',
    'Both parts must contain tracked time': 'Обидві частини мають містити записаний час'
  }
  return (t.locale === 'uk' ? splitErrors[message] : undefined) || message || t(fallback)
}
