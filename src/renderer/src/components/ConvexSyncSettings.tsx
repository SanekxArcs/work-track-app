import { useEffect, useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'
import type { ConvexSyncStatus } from '@shared/convex-sync'
import { translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { SettingsSection } from './SettingsSection'

export function ConvexSyncSettings({ locale }: { locale: 'uk' | 'en' }): React.JSX.Element {
  const uk = locale === 'uk'
  const t = translator(locale)
  const [status, setStatus] = useState<ConvexSyncStatus | null>(null)
  const [siteUrl, setSiteUrl] = useState('')
  const [key, setKey] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState<6 | 12 | 24>(12)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let mounted = true
    void window.workBuddy.getConvexSyncStatus().then((value) => {
      if (!mounted) return
      setStatus(value); setSiteUrl(value.siteUrl); setEnabled(value.enabled); setHours(value.intervalHours)
    }).catch((error) => { if (mounted) setMessage(errorText(error, t, 'actionFailed')) })
    const timer = setInterval(() => {
      void window.workBuddy.getConvexSyncStatus().then((value) => { if (mounted) setStatus(value) }).catch(() => undefined)
    }, 5000)
    return () => { mounted = false; clearInterval(timer) }
  }, [])
  const save = async (sync: boolean): Promise<void> => {
    setBusy(true); setMessage('')
    try {
      const saved = await window.workBuddy.configureConvexSync({ enabled, siteUrl, intervalHours: hours }, key || undefined)
      setStatus(saved); setKey('')
      const result = sync ? await window.workBuddy.syncConvexNow() : saved
      setStatus(result)
      setMessage(result.error || t('saved'))
    } catch (error) { setMessage(errorText(error, t, 'saveFailed')) }
    finally { setBusy(false) }
  }
  const date = (time: number | null): string => time ? new Date(time).toLocaleString(uk ? 'uk-UA' : 'en-GB') : '—'
  return <SettingsSection id="convex" icon={<Cloud size={17} />} title={t('convexTitle')} body={t('convexBody')} className="convex-sync-settings">
    <label className="setting-line"><span>{t('convexAutoUpload')}</span><button type="button" role="switch" aria-checked={enabled} aria-label={t('convexAutoUpload')} className={`toggle ${enabled ? 'toggle--on' : ''}`} disabled={busy} onClick={() => setEnabled(!enabled)}><span /></button></label>
    <label className="convex-field"><span>{t('convexSiteUrl')}</span><input placeholder="https://your-deployment.convex.site" value={siteUrl} disabled={busy} onChange={(event) => setSiteUrl(event.target.value)} /></label>
    <label className="convex-field"><span>{t('convexWriteKey')}</span><input type="password" autoComplete="off" placeholder={status?.hasKey ? t('convexKeySaved') : t('convexKeyMin')} value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
    <div className="setting-line"><span>{t('convexUploadEvery')}</span><div className="convex-frequency">{([6, 12, 24] as const).map((value) => <button type="button" key={value} className={hours === value ? 'primary-button' : 'secondary-button'} aria-pressed={hours === value} disabled={busy} onClick={() => setHours(value)}>{value}{t('convexHoursShort')}</button>)}</div></div>
    <p className="settings-note">{t('convexNote')}</p>
    <div className="convex-actions"><button type="button" className="secondary-button" disabled={!status || busy || status.syncing} onClick={() => void save(false)}>{t('save')}</button><button type="button" className="primary-button" disabled={!status || busy || status.syncing || !enabled} onClick={() => void save(true)}><RefreshCw size={14} />{busy || status?.syncing ? t('convexSyncing') : t('convexSyncNow')}</button></div>
    {status && <><p className="settings-note">{t('convexLastSuccess')}{date(status.lastSyncedAt)}<br />{t('convexNextAttempt')}{date(status.nextSyncAt)}</p><label className="convex-field"><span>{t('convexSourceId')}</span><input readOnly value={status.sourceId} onFocus={(event) => event.target.select()} /></label></>}
    {(message || status?.error) && <p className="settings-note" role="status">{message || status?.error}</p>}
  </SettingsSection>
}
