import { useEffect, useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'
import type { ConvexSyncStatus } from '@shared/convex-sync'

export function ConvexSyncSettings({ locale }: { locale: 'uk' | 'en' }): React.JSX.Element {
  const uk = locale === 'uk'
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
    }).catch((error) => { if (mounted) setMessage(String(error)) })
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
      setMessage(result.error || (uk ? 'Збережено' : 'Saved'))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const date = (time: number | null): string => time ? new Date(time).toLocaleString(uk ? 'uk-UA' : 'en-GB') : '—'
  return <section className="settings-section convex-sync-settings">
    <div className="settings-title"><Cloud size={17} /><div><h3>{uk ? 'Синхронізація з Convex' : 'Convex sync'}</h3><p>{uk ? 'Копія робочих даних у хмарі для інших застосунків.' : 'A cloud copy of your work data for other apps.'}</p></div></div>
    <label className="setting-line"><span>{uk ? 'Автоматичне завантаження' : 'Automatic upload'}</span><button type="button" role="switch" aria-checked={enabled} aria-label={uk ? 'Автоматичне завантаження' : 'Automatic upload'} className={`toggle ${enabled ? 'toggle--on' : ''}`} disabled={busy} onClick={() => setEnabled(!enabled)}><span /></button></label>
    <label className="convex-field"><span>{uk ? 'Адреса Convex' : 'Convex site URL'}</span><input placeholder="https://your-deployment.convex.site" value={siteUrl} disabled={busy} onChange={(event) => setSiteUrl(event.target.value)} /></label>
    <label className="convex-field"><span>{uk ? 'Ключ запису' : 'Write key'}</span><input type="password" autoComplete="off" placeholder={status?.hasKey ? (uk ? 'Ключ збережено' : 'Key saved') : (uk ? 'Щонайменше 32 символи' : 'At least 32 characters')} value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
    <div className="setting-line"><span>{uk ? 'Завантажувати кожні' : 'Upload every'}</span><div className="convex-frequency">{([6, 12, 24] as const).map((value) => <button type="button" key={value} className={hours === value ? 'primary-button' : 'secondary-button'} aria-pressed={hours === value} disabled={busy} onClick={() => setHours(value)}>{value}{uk ? ' год' : 'h'}</button>)}</div></div>
    <p className="settings-note">{uk ? 'Локальна база залишається основною. Потрібен запущений Work Buddy та інтернет. Інші застосунки читають останню копію окремим ключем лише для читання.' : 'Your local database stays primary. Work Buddy must be running and online. Other apps read the latest copy using a separate read-only key.'}</p>
    <div className="convex-actions"><button type="button" className="secondary-button" disabled={!status || busy || status.syncing} onClick={() => void save(false)}>{uk ? 'Зберегти' : 'Save'}</button><button type="button" className="primary-button" disabled={!status || busy || status.syncing || !enabled} onClick={() => void save(true)}><RefreshCw size={14} />{busy || status?.syncing ? (uk ? 'Синхронізація…' : 'Syncing…') : (uk ? 'Синхронізувати зараз' : 'Sync now')}</button></div>
    {status && <><p className="settings-note">{uk ? 'Остання успішна: ' : 'Last successful: '}{date(status.lastSyncedAt)}<br />{uk ? 'Наступна спроба: ' : 'Next attempt: '}{date(status.nextSyncAt)}</p><label className="convex-field"><span>{uk ? 'ID джерела для інших застосунків' : 'Source ID for other apps'}</span><input readOnly value={status.sourceId} onFocus={(event) => event.target.select()} /></label></>}
    {(message || status?.error) && <p className="settings-note" role="status">{message || status?.error}</p>}
  </section>
}
