import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, BellRing, BriefcaseBusiness, Check, Coffee, Copy, Download, Dumbbell, FolderOpen, Info, KeyRound, Laptop2, Languages, Palette, Play, PlugZap, Plus, Shapes, Sparkles, Tags, Trash2, Upload, Volume2 } from 'lucide-react'
import type { AppSettings, AppSnapshot, BackupPreview, ExtensionServerStatus, GeminiModel, Locale, NotificationSound, WellnessAction } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { errorText } from '../lib/errors'
import { playNotificationSound } from '../lib/sounds'
import { AnimatedText, Collapse, ease, Fade, StackItem, Swap } from './Animated'
import { ColorPicker } from './ColorPicker'
import { ConfirmDialog } from './ConfirmDialog'
import { CustomSelect } from './CustomSelect'
import { TimeInput } from './TimeInput'

interface SettingsProps {
  snapshot: AppSnapshot
  t: Translator
  onSnapshot: (snapshot: AppSnapshot) => void
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return <button type="button" className={`toggle ${checked ? 'toggle--on' : ''}`} onClick={() => onChange(!checked)}><motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} /></button>
}

/** Keeps a local draft so clearing the field to retype it does not save the minimum in between. */
function NumberField({ value, onChange, suffix, min = 1 }: { value: number; onChange: (value: number) => void; suffix: string; min?: number }): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (text: string): void => {
    setDraft(text)
    const parsed = Number(text)
    if (text.trim() && Number.isInteger(parsed) && parsed >= min && parsed !== value) onChange(parsed)
  }
  return <label className="number-field"><input type="number" min={min} step={1} value={draft} onChange={(event) => commit(event.target.value)} onBlur={() => setDraft(String(value))} /><span>{suffix}</span></label>
}

/**
 * Status/type name field. Keeps its own draft so an emptied name stays on screen while
 * being retyped: settings only receive non-empty names (the main process drops nameless
 * entries), and the row is removed only if the field is left empty on blur.
 */
function NameField({ value, ariaLabel, onChange, onEmptyBlur }: { value: string; ariaLabel: string; onChange: (value: string) => void; onEmptyBlur: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return <input
    value={draft}
    maxLength={40}
    aria-label={ariaLabel}
    onFocus={() => { focused.current = true }}
    onChange={(event) => {
      setDraft(event.target.value)
      if (event.target.value.trim()) onChange(event.target.value)
    }}
    onBlur={() => {
      focused.current = false
      if (draft.trim()) setDraft(value)
      else onEmptyBlur()
    }}
  />
}

function shiftTime(value: string, minutes: number): string {
  const [hours, mins] = value.split(':').map(Number)
  const total = (hours * 60 + mins + minutes + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function shortcutLabel(shortcut: string): string {
  return shortcut.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win').replaceAll('+', ' + ')
}

function shortcutFromKey(event: React.KeyboardEvent<HTMLButtonElement>): string | null {
  const specialKeys: Record<string, string> = {
    ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Delete: 'Delete', Backspace: 'Backspace', Tab: 'Tab'
  }
  if (['Control', 'Shift', 'Alt', 'Meta', 'OS', 'Dead'].includes(event.key)) return null
  const key = specialKeys[event.key] ?? (/^F(?:[1-9]|1\d|2[0-4])$/i.test(event.key) ? event.key.toUpperCase() : /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : null)
  if (!key || (!event.ctrlKey && !event.altKey && !event.metaKey)) return null
  return [event.ctrlKey && 'CommandOrControl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+')
}

export function SettingsPage({ snapshot, t, onSnapshot }: SettingsProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(snapshot.settings)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [actionUk, setActionUk] = useState('')
  const [actionEn, setActionEn] = useState('')
  const [newColor, setNewColor] = useState('#ff8fab')
  const [aiKey, setAiKey] = useState('')
  const [aiKeyStatus, setAiKeyStatus] = useState('')
  const [customPreviewData, setCustomPreviewData] = useState('')
  const [soundError, setSoundError] = useState('')
  const [extensionKeyError, setExtensionKeyError] = useState('')
  const [newStatusName, setNewStatusName] = useState('')
  const [newTypeName, setNewTypeName] = useState('')
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState('')
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [extensionServer, setExtensionServer] = useState<ExtensionServerStatus | null>(null)
  const [extensionKey, setExtensionKey] = useState('')
  const [showExtensionKey, setShowExtensionKey] = useState(false)
  const [extensionKeyCopied, setExtensionKeyCopied] = useState(false)
  const [shortcutError, setShortcutError] = useState('')
  const lastSynced = useRef(JSON.stringify(snapshot.settings))
  const saveRevision = useRef(0)

  useEffect(() => {
    const incoming = JSON.stringify(snapshot.settings)
    if (incoming === lastSynced.current) return
    lastSynced.current = incoming
    setSettings(snapshot.settings)
  }, [snapshot.settings])

  useEffect(() => {
    void window.workBuddy.getAppVersion().then(setAppVersion).catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.workBuddy.getExtensionServerStatus().then(setExtensionServer).catch(() => undefined)
    return window.workBuddy.onExtensionServerStatus(setExtensionServer)
  }, [])

  useEffect(() => {
    const serialized = JSON.stringify(settings)
    if (serialized === lastSynced.current) return
    lastSynced.current = serialized
    const revision = ++saveRevision.current
    setSaveState('saving')
    void window.workBuddy.updateSettings(settings).then((result) => {
      if (revision !== saveRevision.current) return
      onSnapshot(result)
      setSaveState('saved')
    }).catch(() => {
      if (revision === saveRevision.current) setSaveState('error')
    })
  }, [settings])

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => setSettings((current) => ({ ...current, [key]: value }))
  const nested = <K extends 'workday' | 'breaks' | 'lunch' | 'idle' | 'ai' | 'notifications'>(key: K, value: Partial<AppSettings[K]>): void => {
    setSettings((current) => ({ ...current, [key]: { ...current[key], ...value } }))
  }

  const addAction = (): void => {
    if (!actionUk.trim() && !actionEn.trim()) return
    const action: WellnessAction = {
      id: crypto.randomUUID(),
      labelUk: actionUk.trim() || actionEn.trim(),
      labelEn: actionEn.trim() || actionUk.trim(),
      enabled: true
    }
    patch('wellnessActions', [...settings.wellnessActions, action])
    setActionUk('')
    setActionEn('')
  }

  const setLocale = (locale: Locale): void => patch('locale', locale)

  const saveGlobalShortcut = async (shortcut: string): Promise<void> => {
    setShortcutError('')
    try {
      const result = await window.workBuddy.setGlobalShortcut(shortcut)
      lastSynced.current = JSON.stringify(result.settings)
      onSnapshot(result)
      setSettings(result.settings)
    } catch {
      setShortcutError(t('globalShortcutUnavailable'))
    }
  }

  const captureGlobalShortcut = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey
    // Plain Tab keeps keyboard navigation working; plain Escape leaves the capture field.
    if (plain && event.key === 'Tab') return
    event.preventDefault()
    if (plain && event.key === 'Escape') {
      setShortcutError('')
      event.currentTarget.blur()
      return
    }
    const shortcut = shortcutFromKey(event)
    if (!shortcut) {
      setShortcutError(t('globalShortcutNeedsModifier'))
      return
    }
    void saveGlobalShortcut(shortcut)
  }

  const setLunchCounting = (included: boolean): void => {
    setSettings((current) => ({
      ...current,
      workday: {
        ...current.workday,
        endTime: shiftTime(current.workday.endTime, included ? -current.lunch.durationMinutes : current.lunch.durationMinutes)
      },
      lunch: { ...current.lunch, includedInWorkHours: included }
    }))
  }

  const addColor = (): void => {
    if (settings.projectColors.some((color) => color.toLowerCase() === newColor.toLowerCase())) return
    patch('projectColors', [...settings.projectColors, newColor])
  }

  const saveKey = async (): Promise<void> => {
    try {
      await window.workBuddy.updateSettings(settings)
      const result = await window.workBuddy.saveAiKey(aiKey)
      onSnapshot(result)
      setSettings(result.settings)
      setAiKey('')
      setAiKeyStatus(result.settings.ai.hasApiKey ? t('aiKeySaved') : t('aiKeyRemoved'))
    } catch (error) {
      setAiKeyStatus(errorText(error, t, 'aiError'))
    }
  }

  const removeKey = async (): Promise<void> => {
    try {
      await window.workBuddy.updateSettings(settings)
      const result = await window.workBuddy.saveAiKey('')
      onSnapshot(result)
      setSettings(result.settings)
      setAiKeyStatus(t('aiKeyRemoved'))
    } catch (error) {
      setAiKeyStatus(errorText(error, t, 'aiError'))
    }
  }

  const modelOptions: Array<{ value: GeminiModel; label: string; description: string }> = [
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: t('aiModelHighVolume') },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: t('aiModelBalanced') },
    { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: t('aiModelSmart') },
    { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: t('aiModelAlternative') },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: t('aiModelLegacy') }
  ]

  const soundOptions: Array<{ value: NotificationSound; label: string; description: string }> = [
    { value: 'soft', label: t('soundSoft'), description: t('soundSoftBody') },
    { value: 'bell', label: t('soundBell'), description: t('soundBellBody') },
    { value: 'pop', label: t('soundPop'), description: t('soundPopBody') },
    { value: 'system', label: t('soundSystem'), description: t('soundSystemBody') },
    { value: 'custom', label: settings.notifications.customSoundName || t('soundCustom'), description: t('soundCustomBody') }
  ]

  const chooseSound = async (): Promise<void> => {
    setSoundError('')
    try {
      const result = await window.workBuddy.chooseNotificationSound()
      if (!result) return
      setCustomPreviewData(result.dataUrl)
      nested('notifications', { sound: 'custom', customSoundPath: result.path, customSoundName: result.name })
      await playNotificationSound('custom', result.dataUrl)
    } catch (error) {
      setSoundError(errorText(error, t, 'soundPlayError'))
    }
  }

  const previewSound = async (): Promise<void> => {
    setSoundError('')
    try {
      await playNotificationSound(settings.notifications.sound, settings.notifications.sound === 'custom' ? customPreviewData : undefined, settings.notifications.volume)
    } catch {
      setSoundError(t('soundPlayError'))
    }
  }

  const addStatus = (): void => {
    const name = newStatusName.trim()
    if (!name) return
    const color = settings.projectColors[settings.projectStatuses.length % settings.projectColors.length]
    patch('projectStatuses', [...settings.projectStatuses, { id: crypto.randomUUID(), name, color }])
    setNewStatusName('')
  }

  const addType = (): void => {
    const name = newTypeName.trim()
    if (!name) return
    const color = settings.projectColors[(settings.projectTypes.length + 3) % settings.projectColors.length]
    patch('projectTypes', [...settings.projectTypes, { id: crypto.randomUUID(), name, color }])
    setNewTypeName('')
  }

  const updateType = (id: string, change: Partial<AppSettings['projectTypes'][number]>): void => {
    patch('projectTypes', settings.projectTypes.map((type) => type.id === id ? { ...type, ...change } : type))
  }

  const updateStatus = (id: string, change: Partial<AppSettings['projectStatuses'][number]>): void => {
    patch('projectStatuses', settings.projectStatuses.map((status) => status.id === id ? { ...status, ...change } : status))
  }

  const exportBackup = async (): Promise<void> => {
    setBackupBusy(true)
    setBackupStatus('')
    try {
      const result = await window.workBuddy.exportBackup()
      if (result) setBackupStatus(t('backupSaved'))
    } catch (error) {
      setBackupStatus(errorText(error, t, 'backupError'))
    } finally {
      setBackupBusy(false)
    }
  }

  const chooseBackup = async (): Promise<void> => {
    setBackupBusy(true)
    setBackupStatus('')
    try {
      const preview = await window.workBuddy.chooseBackupImport()
      setBackupPreview(preview)
      if (preview) setBackupStatus(t('backupReady'))
    } catch (error) {
      setBackupStatus(errorText(error, t, 'backupError'))
    } finally {
      setBackupBusy(false)
    }
  }

  const importBackup = async (mode: 'merge' | 'replace'): Promise<void> => {
    setBackupBusy(true)
    try {
      const result = await window.workBuddy.applyBackupImport(mode)
      onSnapshot(result)
      setSettings(result.settings)
      setBackupPreview(null)
      setBackupStatus(t('backupImported'))
    } catch (error) {
      setBackupStatus(errorText(error, t, 'backupError'))
    } finally {
      setBackupBusy(false)
      setReplaceConfirmOpen(false)
    }
  }

  const revealExtensionKey = async (): Promise<void> => {
    setExtensionKeyError('')
    try {
      if (!extensionKey) setExtensionKey(await window.workBuddy.getExtensionAccessKey())
      setShowExtensionKey((shown) => !shown)
    } catch (error) {
      setExtensionKeyError(errorText(error, t, 'saveFailed'))
    }
  }

  const copyExtensionKey = async (): Promise<void> => {
    if (!extensionKey) return
    try {
      await navigator.clipboard.writeText(extensionKey)
      setExtensionKeyCopied(true)
      window.setTimeout(() => setExtensionKeyCopied(false), 1600)
    } catch {
      setExtensionKeyError(t('saveFailed'))
    }
  }

  const uk = settings.locale === 'uk'

  return (
    <motion.div className="page-stack settings-page" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
      <section className="settings-section">
        <div className="settings-title"><Languages size={17} /><div><h3>{t('language')}</h3></div></div>
        <div className="segment-control">
          <button className={settings.locale === 'uk' ? 'active' : ''} onClick={() => setLocale('uk')}>{t('ukrainian')}</button>
          <button className={settings.locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>{t('english')}</button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-title"><Laptop2 size={17} /><div><h3>{t('appBehavior')}</h3></div></div>
        <div className="setting-line"><span>{t('alwaysOnTop')}</span><Toggle checked={settings.alwaysOnTop} onChange={(value) => patch('alwaysOnTop', value)} /></div>
        <div className="setting-line"><span>{t('autoStart')}</span><Toggle checked={settings.autoStart} onChange={(value) => patch('autoStart', value)} /></div>
        <div className="setting-line"><div><strong>{t('notchLook')}</strong><p>{t('notchLookBody')}</p></div><Toggle checked={settings.notchEnabled} onChange={(value) => patch('notchEnabled', value)} /></div>
        <div className="setting-line global-shortcut-setting"><div><strong>{t('globalShortcut')}</strong><p>{t('globalShortcutBody')}</p></div><div className="global-shortcut-controls"><button type="button" className="global-shortcut-capture" onKeyDown={captureGlobalShortcut} aria-label={t('globalShortcut')} title={t('globalShortcutBody')}>{shortcutLabel(settings.globalShortcut)}</button><button type="button" className="global-shortcut-reset" onClick={() => void saveGlobalShortcut('CommandOrControl+Shift+T')} title={t('globalShortcutReset')} aria-label={t('globalShortcutReset')}>↺</button></div></div>
        {shortcutError && <p className="form-error global-shortcut-error">{shortcutError}</p>}
      </section>

      <section className="settings-section extension-server-settings">
        <div className="settings-title"><PlugZap size={17} /><div><h3>{uk ? 'Chrome extension' : 'Chrome extension'}</h3><p>{uk ? 'Локальний міст до Work Buddy. Дані не виходять з цього комп’ютера.' : 'Local bridge to Work Buddy. Your data never leaves this computer.'}</p></div></div>
        <div className={`extension-server-state ${extensionServer?.running ? 'extension-server-state--online' : ''}`}>
          <span />
          <div><strong><AnimatedText text={extensionServer?.running ? (uk ? 'Сервер увімкнено' : 'Server is running') : (uk ? 'Сервер недоступний' : 'Server is unavailable')} /></strong><small>{extensionServer?.running ? `${uk ? 'Порт' : 'Port'} ${extensionServer.port} · ${extensionServer.connections} ${uk ? 'підключень' : 'connections'}` : extensionServer?.error}</small></div>
        </div>
        <div className="extension-key-actions">
          <button className="secondary-button" onClick={() => void revealExtensionKey()}><AnimatedText text={showExtensionKey ? (uk ? 'Сховати ключ' : 'Hide key') : (uk ? 'Показати ключ підключення' : 'Show connection key')} /></button>
          <Fade show={showExtensionKey && Boolean(extensionKey)}><button className="icon-button icon-button--quiet" onClick={() => void copyExtensionKey()} title={uk ? 'Копіювати ключ' : 'Copy key'}><Swap id={extensionKeyCopied ? 'copied' : 'copy'}>{extensionKeyCopied ? <Check size={15} /> : <Copy size={15} />}</Swap></button></Fade>
        </div>
        <Collapse open={showExtensionKey && Boolean(extensionKey)}><code className="extension-access-key">{extensionKey}</code></Collapse>
        <Collapse open={Boolean(extensionKeyError)}><p className="form-error">{extensionKeyError}</p></Collapse>
      </section>

      <section className="settings-section settings-section--sound">
        <div className="settings-title"><Volume2 size={17} /><div><h3>{t('notificationSound')}</h3><p>{t('notificationSoundBody')}</p></div></div>
        <label className="field"><span>{t('sound')}</span><CustomSelect value={settings.notifications.sound} ariaLabel={t('notificationSound')} onChange={(value) => { if (value === 'custom' && !settings.notifications.customSoundPath) void chooseSound(); else nested('notifications', { sound: value as NotificationSound }) }} options={soundOptions} /></label>
        <div className="sound-actions">
          <button className="secondary-button" onClick={previewSound}><Play size={14} fill="currentColor" />{t('previewSound')}</button>
          <button className="secondary-button" onClick={chooseSound}><FolderOpen size={14} />{t('chooseSound')}</button>
        </div>
        <Collapse open={Boolean(soundError)}><p className="form-error">{soundError}</p></Collapse>
        <label className="sound-volume"><span>{t('volume')}</span><input type="range" min="0" max="100" value={Math.round(settings.notifications.volume * 100)} onChange={(event) => nested('notifications', { volume: Number(event.target.value) / 100 })} /><strong>{Math.round(settings.notifications.volume * 100)}%</strong></label>
      </section>

      <section className="settings-section">
        <div className="settings-title"><BriefcaseBusiness size={17} /><div><h3>{t('workSchedule')}</h3></div></div>
        <div className="setting-line"><span>{t('startReminder')}</span><div className="setting-inline"><TimeInput className="time-input" ariaLabel={t('startReminder')} value={settings.workday.startTime} onChange={(value) => nested('workday', { startTime: value })} /><Toggle checked={settings.workday.startReminder} onChange={(value) => nested('workday', { startReminder: value })} /></div></div>
        <div className="setting-line"><span>{t('endReminder')}</span><div className="setting-inline"><TimeInput className="time-input" ariaLabel={t('endReminder')} value={settings.workday.endTime} onChange={(value) => nested('workday', { endTime: value })} /><Toggle checked={settings.workday.endReminder} onChange={(value) => nested('workday', { endReminder: value })} /></div></div>
      </section>

      <section className="settings-section settings-section--accent">
        <div className="settings-title"><BellRing size={17} /><div><h3>{t('breaks')}</h3><p>{t('breakBody')}</p></div><Toggle checked={settings.breaks.enabled} onChange={(value) => nested('breaks', { enabled: value })} /></div>
        <div className="two-fields">
          <div><span>{t('every')}</span><NumberField value={settings.breaks.everyMinutes} onChange={(value) => nested('breaks', { everyMinutes: value })} suffix={t('minutes')} /></div>
          <div><span>{t('forMinutes')}</span><NumberField value={settings.breaks.durationMinutes} onChange={(value) => nested('breaks', { durationMinutes: value })} suffix={t('minutes')} /></div>
        </div>
      </section>

      <section className="settings-section settings-section--lunch">
        <div className="settings-title"><Coffee size={17} /><div><h3>{t('lunch')}</h3><p>{t('lunchBody')}</p></div><Toggle checked={settings.lunch.enabled} onChange={(value) => nested('lunch', { enabled: value })} /></div>
        <div className="segment-control segment-control--small">
          <button className={settings.lunch.mode === 'clock' ? 'active' : ''} onClick={() => nested('lunch', { mode: 'clock' })}>{t('atTime')}</button>
          <button className={settings.lunch.mode === 'worked' ? 'active' : ''} onClick={() => nested('lunch', { mode: 'worked' })}>{t('afterWork')}</button>
        </div>
        <div className="two-fields">
          <div><span><AnimatedText text={settings.lunch.mode === 'clock' ? t('atTime') : t('after')} /></span><motion.div key={settings.lunch.mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease }}>{settings.lunch.mode === 'clock' ? <TimeInput className="time-input block" ariaLabel={t('atTime')} value={settings.lunch.time} onChange={(value) => nested('lunch', { time: value })} /> : <NumberField value={settings.lunch.afterMinutes} onChange={(value) => nested('lunch', { afterMinutes: value })} suffix={t('minutes')} />}</motion.div></div>
          <div><span>{t('lunchDuration')}</span><NumberField value={settings.lunch.durationMinutes} onChange={(value) => nested('lunch', { durationMinutes: value })} suffix={t('minutes')} /></div>
        </div>
        <div className="setting-line lunch-counting"><div><strong>{t('lunchIncluded')}</strong><p>{t('lunchIncludedBody')}</p></div><Toggle checked={settings.lunch.includedInWorkHours} onChange={setLunchCounting} /></div>
      </section>

      <section className="settings-section">
        <div className="settings-title"><Palette size={17} /><div><h3>{t('projectPalette')}</h3><p>{t('projectPaletteBody')}</p></div></div>
        <div className="palette-editor">
          <AnimatePresence initial={false} mode="popLayout">
            {settings.projectColors.map((color) => (
              <motion.button key={color} layout="position" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.18, ease }} className="palette-chip" style={{ '--chip-color': color } as React.CSSProperties} title={t('removeColor')} disabled={settings.projectColors.length <= 1} onClick={() => patch('projectColors', settings.projectColors.filter((item) => item !== color))}><span /><Trash2 size={12} /></motion.button>
            ))}
          </AnimatePresence>
          <motion.div layout="position" transition={{ duration: 0.18, ease }} className="color-adder"><input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} /><button className="icon-button icon-button--accent" onClick={addColor} title={t('addColor')}><Plus size={15} /></button></motion.div>
        </div>
      </section>

      <section className="settings-section project-statuses-settings">
        <div className="settings-title"><Tags size={17} /><div><h3>{t('projectStatuses')}</h3><p>{t('projectStatusesBody')}</p></div></div>
        <div className="status-editor-list">
          <AnimatePresence initial={false}>
          {settings.projectStatuses.map((status) => (
            <StackItem key={status.id} gap={6}><div className="status-editor-row">
              <ColorPicker value={status.color} colors={settings.projectColors} onChange={(color) => updateStatus(status.id, { color })} ariaLabel={t('projectPalette')} />
              <NameField value={status.name} ariaLabel={t('statusName')} onChange={(name) => updateStatus(status.id, { name })} onEmptyBlur={() => patch('projectStatuses', settings.projectStatuses.filter((item) => item.id !== status.id))} />
              <button className="icon-button icon-button--quiet" onClick={() => patch('projectStatuses', settings.projectStatuses.filter((item) => item.id !== status.id))} title={t('deleteStatus')}><Trash2 size={14} /></button>
            </div></StackItem>
          ))}
          </AnimatePresence>
          <Collapse open={settings.projectStatuses.length === 0}><p className="empty-copy">{t('noStatusesYet')}</p></Collapse>
        </div>
        <div className="action-inputs status-add-row"><input value={newStatusName} maxLength={40} onChange={(event) => setNewStatusName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addStatus() }} placeholder={t('statusName')} /><button className="icon-button icon-button--accent" onClick={addStatus} title={t('addStatus')}><Plus size={16} /></button></div>
      </section>

      <section className="settings-section project-types-settings">
        <div className="settings-title"><Shapes size={17} /><div><h3>{t('projectTypes')}</h3><p>{t('projectTypesBody')}</p></div></div>
        <div className="status-editor-list">
          <AnimatePresence initial={false}>
          {settings.projectTypes.map((type) => (
            <StackItem key={type.id} gap={6}><div className="status-editor-row">
              <ColorPicker value={type.color} colors={settings.projectColors} onChange={(color) => updateType(type.id, { color })} ariaLabel={t('projectPalette')} />
              <NameField value={type.name} ariaLabel={t('typeName')} onChange={(name) => updateType(type.id, { name })} onEmptyBlur={() => patch('projectTypes', settings.projectTypes.filter((item) => item.id !== type.id))} />
              <button className="icon-button icon-button--quiet" onClick={() => patch('projectTypes', settings.projectTypes.filter((item) => item.id !== type.id))} title={t('deleteType')}><Trash2 size={14} /></button>
            </div></StackItem>
          ))}
          </AnimatePresence>
          <Collapse open={settings.projectTypes.length === 0}><p className="empty-copy">{t('noTypesYet')}</p></Collapse>
        </div>
        <div className="action-inputs status-add-row"><input value={newTypeName} maxLength={40} onChange={(event) => setNewTypeName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addType() }} placeholder={t('typeName')} /><button className="icon-button icon-button--accent" onClick={addType} title={t('addType')}><Plus size={16} /></button></div>
      </section>

      <section className="settings-section settings-section--ai">
        <div className="settings-title"><Sparkles size={17} /><div><h3>{t('aiAssistant')}</h3><p>{t('aiAssistantBody')}</p></div><Toggle checked={settings.ai.enabled} onChange={(value) => nested('ai', { enabled: value })} /></div>
        <label className="field"><span>{t('aiModel')}</span><CustomSelect value={settings.ai.model} ariaLabel={t('aiModel')} onChange={(value) => nested('ai', { model: value as GeminiModel })} options={modelOptions} /></label>
        <label className="field"><span><KeyRound size={13} /> {t('geminiApiKey')} {settings.ai.hasApiKey && <em>{t('configured')}</em>}</span><div className="api-key-row"><input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={settings.ai.hasApiKey ? '••••••••••••••••' : 'AIza…'} /><button className="secondary-button" disabled={!aiKey.trim()} onClick={saveKey}>{t('saveKey')}</button>{settings.ai.hasApiKey && <button className="icon-button icon-button--quiet" title={t('removeKey')} onClick={removeKey}><Trash2 size={14} /></button>}</div></label>
        <Collapse open={Boolean(aiKeyStatus)}><p className="settings-status">{aiKeyStatus}</p></Collapse>
        <p className="security-note">{t('aiSecurity')}</p>
      </section>

      <section className="settings-section settings-section--backup">
        <div className="settings-title"><Archive size={17} /><div><h3>{t('backup')}</h3><p>{t('backupBody')}</p></div></div>
        <div className="sound-actions">
          <button className="secondary-button" disabled={backupBusy} onClick={exportBackup}><Download size={14} />{t('backupExport')}</button>
          <button className="secondary-button" disabled={backupBusy} onClick={chooseBackup}><Upload size={14} />{t('backupImport')}</button>
        </div>
        <Collapse open={Boolean(backupPreview)}>{backupPreview && <div className="backup-preview">
          <p>{t('backupContents')}</p>
          <strong>{backupPreview.projectCount} {t('backupProjects')} · {backupPreview.plannedTaskCount} {t('backupPlanned')} · {backupPreview.taskCount} {t('backupTasks')} · {backupPreview.intervalCount} {t('backupIntervals')}</strong>
          <small>{backupPreview.workdayCount} {t('backupDays')} · {backupPreview.restCount} {t('backupRests')}</small>
          <div className="sound-actions">
            <button className="primary-button" disabled={backupBusy} onClick={() => void importBackup('merge')}>{t('backupMerge')}</button>
            <button className="secondary-button" disabled={backupBusy} onClick={() => setReplaceConfirmOpen(true)}>{t('backupReplace')}</button>
          </div>
        </div>}</Collapse>
        <Collapse open={Boolean(backupStatus)}><p className="settings-status">{backupStatus}</p></Collapse>
        <p className="security-note">{t('backupSecurity')}</p>
      </section>

      <section className="settings-section">
        <div className="settings-title"><Dumbbell size={17} /><div><h3>{t('wellness')}</h3><p>{t('wellnessBody')}</p></div><Toggle checked={settings.wellnessEnabled} onChange={(value) => patch('wellnessEnabled', value)} /></div>
        <div className="wellness-list">
          <AnimatePresence initial={false}>
          {settings.wellnessActions.map((action) => (
            <StackItem key={action.id} gap={6}><div className="wellness-item">
              <Toggle checked={action.enabled} onChange={(enabled) => patch('wellnessActions', settings.wellnessActions.map((item) => item.id === action.id ? { ...item, enabled } : item))} />
              <span>{settings.locale === 'uk' ? action.labelUk : action.labelEn}</span>
              <button className="icon-button icon-button--quiet" onClick={() => patch('wellnessActions', settings.wellnessActions.filter((item) => item.id !== action.id))}><Trash2 size={14} /></button>
            </div></StackItem>
          ))}
          </AnimatePresence>
        </div>
        <div className="action-inputs"><input value={actionUk} onChange={(event) => setActionUk(event.target.value)} placeholder={t('actionUk')} /><input value={actionEn} onChange={(event) => setActionEn(event.target.value)} placeholder={t('actionEn')} /><button className="icon-button icon-button--accent" onClick={addAction}><Plus size={16} /></button></div>
      </section>

      <section className="settings-section compact-settings">
        <div className="setting-line"><div><strong>{t('idle')}</strong><p>{t('idleAfter')}</p></div><div className="setting-inline"><NumberField value={settings.idle.thresholdMinutes} onChange={(value) => nested('idle', { thresholdMinutes: value })} suffix={t('minutes')} /><Toggle checked={settings.idle.enabled} onChange={(value) => nested('idle', { enabled: value })} /></div></div>
      </section>

      <section className="app-version"><Info size={14} /><span>{t('appVersion')}</span><strong>{appVersion ? `v${appVersion}` : '…'}</strong></section>

      <div className={`autosave-indicator autosave-indicator--${saveState}`}><span /><AnimatedText text={saveState === 'saving' ? t('saving') : saveState === 'error' ? t('saveFailed') : t('autosaved')} /></div>

      <ConfirmDialog
        open={replaceConfirmOpen}
        title={t('backupReplaceTitle')}
        body={<p>{t('backupReplaceBody')}</p>}
        confirmLabel={t('backupReplace')}
        cancelLabel={t('cancel')}
        busy={backupBusy}
        onConfirm={() => void importBackup('replace')}
        onCancel={() => setReplaceConfirmOpen(false)}
      />
    </motion.div>
  )
}
