import { useState } from 'react'
import { Coffee, Dumbbell, Play } from 'lucide-react'
import type { AppSnapshot } from '@shared/types'
import { dailyRestBalance } from '@shared/rest'
import type { Translator } from '../lib/i18n'
import { formatDuration } from '../lib/time'
import { errorText } from '../lib/errors'

export function RestSummary({ snapshot, now, t, onSnapshot, allowActions = true }: {
  snapshot: AppSnapshot; now: number; t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void; allowActions?: boolean
}): React.JSX.Element | null {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!snapshot.workday) return null
  const running = snapshot.rests.some((rest) => rest.status === 'running')
  const balances = dailyRestBalance(snapshot.settings, snapshot.workday, snapshot.rests, now)
    .filter((balance) => balance.usedMs > 0 || balance.remainingMs > 0
      || (balance.type === 'lunch' ? snapshot.settings.lunch.enabled : snapshot.settings.breaks.enabled))
  const useRest = async (type: 'lunch' | 'break'): Promise<void> => {
    setError('')
    setBusy(true)
    try { onSnapshot(await window.workBuddy.startRest(type)) }
    catch (reason) { setError(errorText(reason, t, 'saveFailed')) }
    finally { setBusy(false) }
  }
  return <section className="rest-balance" aria-label={t('restBalanceTitle')}>
    <strong className="rest-balance__heading">{t('restBalanceTitle')}</strong>
    {balances.map(({ type, usedMs, remainingMs }) => {
      const Icon = type === 'lunch' ? Coffee : Dumbbell
      return <div className={`rest-balance__row rest-balance__row--${type}`} key={type}>
        <Icon size={16} />
        <div><strong>{type === 'lunch' ? t('lunchTime') : t('breakTime')}</strong>
          <small>{t('restUsed')} {formatDuration(usedMs, true, t.locale)} · {t('restUnused')} {formatDuration(remainingMs, true, t.locale)}</small>
        </div>
        {allowActions && snapshot.workday?.endedAt === null && remainingMs > 0 && <button disabled={busy || running} onClick={() => void useRest(type)} title={t('useRestNow')} aria-label={`${t('useRestNow')}: ${type === 'lunch' ? t('lunchTime') : t('breakTime')}`}><Play size={14} fill="currentColor" /><span>{t('useRestNow')}</span></button>}
      </div>
    })}
    <p>{t('restBalanceHint')}</p>
    {error && <small className="form-error" role="alert">{error}</small>}
  </section>
}
