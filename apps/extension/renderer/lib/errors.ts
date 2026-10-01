import { remoteErrorCode } from '../../lib/remote-api'
import type { MessageKey, Translator } from './i18n'

/** Turns a failed bridge call into text for the interface. */
export function errorText(error: unknown, t: Translator, fallback: MessageKey = 'requestFailed'): string {
  const code = remoteErrorCode(error)
  if (code === 'offline') return t('extensionOffline')
  if (code === 'invalidated') return t('extensionReloaded')
  const message = error instanceof Error ? error.message.trim() : ''
  return message || t(fallback)
}
