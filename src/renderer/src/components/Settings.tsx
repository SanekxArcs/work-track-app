import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Archive, ArchiveRestore, BellRing, BriefcaseBusiness, Check, ChevronDown, ChevronUp, Coffee, Download, Dumbbell, Eye, EyeOff, FolderOpen, Info, KeyRound, Laptop2, Languages, Palette, Pencil, Play, Plus, Sparkles, Trash2, Upload, Volume2, X } from 'lucide-react'
import type { AppSettings, AppSnapshot, BackupPreview, GeminiModel, Locale, NotificationSound, Project, WellnessAction } from '@shared/types'
import type { Translator } from '../lib/i18n'
import { playNotificationSound } from '../lib/sounds'
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

function NumberField({ value, onChange, suffix, min = 1 }: { value: number; onChange: (value: number) => void; suffix: string; min?: number }): React.JSX.Element {
  return <label className="number-field"><input type="number" min={min} value={value} onChange={(event) => onChange(Math.max(min, Number(event.target.value)))} /><span>{suffix}</span></label>
}

function shiftTime(value: string, minutes: number): string {
  const [hours, mins] = value.split(':').map(Number)
  const total = (hours * 60 + mins + minutes + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
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
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingProjectName, setEditingProjectName] = useState('')
  const [editingProjectColor, setEditingProjectColor] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectError, setProjectError] = useState('')
  const [projectsExpanded, setProjectsExpanded] = useState(false)
  const [showArchivedProjects, setShowArchivedProjects] = useState(false)
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState('')
  const [appVersion, setAppVersion] = useState('')
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
      setAiKeyStatus(error instanceof Error ? error.message : t('aiError'))
    }
  }

  const removeKey = async (): Promise<void> => {
    await window.workBuddy.updateSettings(settings)
    const result = await window.workBuddy.saveAiKey('')
    onSnapshot(result)
    setSettings(result.settings)
    setAiKeyStatus(t('aiKeyRemoved'))
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
    const result = await window.workBuddy.chooseNotificationSound()
    if (!result) return
    setCustomPreviewData(result.dataUrl)
    nested('notifications', { sound: 'custom', customSoundPath: result.path, customSoundName: result.name })
    await playNotificationSound('custom', result.dataUrl)
  }

  const previewSound = async (): Promise<void> => {
    await playNotificationSound(settings.notifications.sound, settings.notifications.sound === 'custom' ? customPreviewData : undefined, settings.notifications.volume)
  }

  const beginProjectEdit = (project: Project): void => {
    setEditingProjectId(project.id)
    setEditingProjectName(project.name)
    setEditingProjectColor(project.color)
    setProjectError('')
  }

  const saveProject = async (): Promise<void> => {
    if (!editingProjectId || !editingProjectName.trim()) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const result = await window.workBuddy.updateProject({ id: editingProjectId, name: editingProjectName, color: editingProjectColor })
      onSnapshot(result)
      setEditingProjectId(null)
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : t('timeUpdateError'))
    } finally {
      setProjectBusy(false)
    }
  }

  const toggleProjectArchive = async (project: Project): Promise<void> => {
    setProjectBusy(true)
    try {
      const result = await window.workBuddy.updateProject({
        id: project.id,
        name: project.name,
        color: project.color,
        archived: !project.archived
      })
      onSnapshot(result)
    } finally {
      setProjectBusy(false)
    }
  }

  const exportBackup = async (): Promise<void> => {
    setBackupBusy(true)
    setBackupStatus('')
    try {
      const result = await window.workBuddy.exportBackup()
      if (result) setBackupStatus(t('backupSaved'))
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : t('backupError'))
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
      setBackupStatus(error instanceof Error ? error.message : t('backupError'))
    } finally {
      setBackupBusy(false)
    }
  }

  const importBackup = async (mode: 'merge' | 'replace'): Promise<void> => {
    if (mode === 'replace' && !window.confirm(t('backupReplaceConfirm'))) return
    setBackupBusy(true)
    try {
      const result = await window.workBuddy.applyBackupImport(mode)
      onSnapshot(result)
      setSettings(result.settings)
      setBackupPreview(null)
      setBackupStatus(t('backupImported'))
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : t('backupError'))
    } finally {
      setBackupBusy(false)
    }
  }

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
      </section>

      <section className="settings-section settings-section--sound">
        <div className="settings-title"><Volume2 size={17} /><div><h3>{t('notificationSound')}</h3><p>{t('notificationSoundBody')}</p></div></div>
        <label className="field"><span>{t('sound')}</span><CustomSelect value={settings.notifications.sound} ariaLabel={t('notificationSound')} onChange={(value) => { if (value === 'custom' && !settings.notifications.customSoundPath) void chooseSound(); else nested('notifications', { sound: value as NotificationSound }) }} options={soundOptions} /></label>
        <div className="sound-actions">
          <button className="secondary-button" onClick={previewSound}><Play size={14} fill="currentColor" />{t('previewSound')}</button>
          <button className="secondary-button" onClick={chooseSound}><FolderOpen size={14} />{t('chooseSound')}</button>
        </div>
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
          <div><span>{settings.lunch.mode === 'clock' ? t('atTime') : t('after')}</span>{settings.lunch.mode === 'clock' ? <TimeInput className="time-input block" ariaLabel={t('atTime')} value={settings.lunch.time} onChange={(value) => nested('lunch', { time: value })} /> : <NumberField value={settings.lunch.afterMinutes} onChange={(value) => nested('lunch', { afterMinutes: value })} suffix={t('minutes')} />}</div>
          <div><span>{t('lunchDuration')}</span><NumberField value={settings.lunch.durationMinutes} onChange={(value) => nested('lunch', { durationMinutes: value })} suffix={t('minutes')} /></div>
        </div>
        <div className="setting-line lunch-counting"><div><strong>{t('lunchIncluded')}</strong><p>{t('lunchIncludedBody')}</p></div><Toggle checked={settings.lunch.includedInWorkHours} onChange={setLunchCounting} /></div>
      </section>

      <section className="settings-section">
        <div className="settings-title"><Palette size={17} /><div><h3>{t('projectPalette')}</h3><p>{t('projectPaletteBody')}</p></div></div>
        <div className="palette-editor">
          {settings.projectColors.map((color) => (
            <button key={color} className="palette-chip" style={{ '--chip-color': color } as React.CSSProperties} title={t('removeColor')} disabled={settings.projectColors.length <= 1} onClick={() => patch('projectColors', settings.projectColors.filter((item) => item !== color))}><span /><Trash2 size={12} /></button>
          ))}
          <div className="color-adder"><input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} /><button className="icon-button icon-button--accent" onClick={addColor} title={t('addColor')}><Plus size={15} /></button></div>
        </div>
      </section>

      <section className="settings-section projects-settings">
        <div className="settings-title"><BriefcaseBusiness size={17} /><div><h3>{t('projects')}</h3><p>{t('projectsBody')}</p></div><button className="icon-button icon-button--quiet" onClick={() => setProjectsExpanded((expanded) => !expanded)} title={projectsExpanded ? t('collapseProjects') : t('expandProjects')}>{projectsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></div>
        {projectsExpanded && <>
          {snapshot.projects.some((project) => project.archived) && <button className={`archived-projects-toggle ${showArchivedProjects ? 'archived-projects-toggle--active' : ''}`} onClick={() => setShowArchivedProjects((show) => !show)}>{showArchivedProjects ? <EyeOff size={13} /> : <Eye size={13} />}{showArchivedProjects ? t('hideArchivedProjects') : t('showArchivedProjects')}</button>}
          {snapshot.projects.length === 0 ? <p className="empty-copy">{t('noProjectsYet')}</p> : <div className="project-manager-list">
          {snapshot.projects.filter((project) => showArchivedProjects || !project.archived).map((project) => editingProjectId === project.id ? (
            <div className="project-editor" key={project.id}>
              <input autoFocus value={editingProjectName} onChange={(event) => setEditingProjectName(event.target.value)} aria-label={t('projectName')} />
              <div className="color-dots">
                {settings.projectColors.map((color) => <button key={color} aria-label={color} className={editingProjectColor === color ? 'selected' : ''} style={{ background: color }} onClick={() => setEditingProjectColor(color)} />)}
              </div>
              <button className="icon-button icon-button--accent" disabled={projectBusy || !editingProjectName.trim()} onClick={saveProject} title={t('save')}><Check size={15} /></button>
              <button className="icon-button icon-button--quiet" disabled={projectBusy} onClick={() => setEditingProjectId(null)} title={t('cancel')}><X size={15} /></button>
            </div>
          ) : (
            <div className={`project-manager-row ${project.archived ? 'project-manager-row--archived' : ''}`} key={project.id}>
              <span style={{ background: project.color }} /><strong>{project.name}</strong><button className="icon-button icon-button--quiet" disabled={projectBusy} onClick={() => beginProjectEdit(project)} title={t('editProject')}><Pencil size={14} /></button><button className="icon-button icon-button--quiet project-archive-button" disabled={projectBusy} onClick={() => void toggleProjectArchive(project)} title={project.archived ? t('restoreProject') : t('archiveProject')}>{project.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
            </div>
          ))}
          {snapshot.projects.length > 0 && snapshot.projects.filter((project) => showArchivedProjects || !project.archived).length === 0 && <p className="empty-copy">{t('noActiveProjects')}</p>}
          </div>}
          {projectError && <p className="form-error">{projectError}</p>}
        </>}
      </section>

      <section className="settings-section settings-section--ai">
        <div className="settings-title"><Sparkles size={17} /><div><h3>{t('aiAssistant')}</h3><p>{t('aiAssistantBody')}</p></div><Toggle checked={settings.ai.enabled} onChange={(value) => nested('ai', { enabled: value })} /></div>
        <label className="field"><span>{t('aiModel')}</span><CustomSelect value={settings.ai.model} ariaLabel={t('aiModel')} onChange={(value) => nested('ai', { model: value as GeminiModel })} options={modelOptions} /></label>
        <label className="field"><span><KeyRound size={13} /> Gemini API key {settings.ai.hasApiKey && <em>{t('configured')}</em>}</span><div className="api-key-row"><input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={settings.ai.hasApiKey ? '••••••••••••••••' : 'AIza…'} /><button className="secondary-button" disabled={!aiKey.trim()} onClick={saveKey}>{t('saveKey')}</button>{settings.ai.hasApiKey && <button className="icon-button icon-button--quiet" title={t('removeKey')} onClick={removeKey}><Trash2 size={14} /></button>}</div></label>
        {aiKeyStatus && <p className="settings-status">{aiKeyStatus}</p>}
        <p className="security-note">{t('aiSecurity')}</p>
      </section>

      <section className="settings-section settings-section--backup">
        <div className="settings-title"><Archive size={17} /><div><h3>{t('backup')}</h3><p>{t('backupBody')}</p></div></div>
        <div className="sound-actions">
          <button className="secondary-button" disabled={backupBusy} onClick={exportBackup}><Download size={14} />{t('backupExport')}</button>
          <button className="secondary-button" disabled={backupBusy} onClick={chooseBackup}><Upload size={14} />{t('backupImport')}</button>
        </div>
        {backupPreview && <div className="backup-preview">
          <p>{t('backupContents')}</p>
          <strong>{backupPreview.projectCount} {t('backupProjects')} · {backupPreview.plannedTaskCount} {t('backupPlanned')} · {backupPreview.taskCount} {t('backupTasks')} · {backupPreview.intervalCount} {t('backupIntervals')}</strong>
          <small>{backupPreview.workdayCount} {t('backupDays')} · {backupPreview.restCount} {t('backupRests')}</small>
          <div className="sound-actions">
            <button className="primary-button" disabled={backupBusy} onClick={() => void importBackup('merge')}>{t('backupMerge')}</button>
            <button className="secondary-button" disabled={backupBusy} onClick={() => void importBackup('replace')}>{t('backupReplace')}</button>
          </div>
        </div>}
        {backupStatus && <p className="settings-status">{backupStatus}</p>}
        <p className="security-note">{t('backupSecurity')}</p>
      </section>

      <section className="settings-section">
        <div className="settings-title"><Dumbbell size={17} /><div><h3>{t('wellness')}</h3><p>{t('wellnessBody')}</p></div><Toggle checked={settings.wellnessEnabled} onChange={(value) => patch('wellnessEnabled', value)} /></div>
        <div className="wellness-list">
          {settings.wellnessActions.map((action) => (
            <div className="wellness-item" key={action.id}>
              <Toggle checked={action.enabled} onChange={(enabled) => patch('wellnessActions', settings.wellnessActions.map((item) => item.id === action.id ? { ...item, enabled } : item))} />
              <span>{settings.locale === 'uk' ? action.labelUk : action.labelEn}</span>
              <button className="icon-button icon-button--quiet" onClick={() => patch('wellnessActions', settings.wellnessActions.filter((item) => item.id !== action.id))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="action-inputs"><input value={actionUk} onChange={(event) => setActionUk(event.target.value)} placeholder={t('actionUk')} /><input value={actionEn} onChange={(event) => setActionEn(event.target.value)} placeholder={t('actionEn')} /><button className="icon-button icon-button--accent" onClick={addAction}><Plus size={16} /></button></div>
      </section>

      <section className="settings-section compact-settings">
        <div className="setting-line"><div><strong>{t('idle')}</strong><p>{t('idleAfter')}</p></div><div className="setting-inline"><NumberField value={settings.idle.thresholdMinutes} onChange={(value) => nested('idle', { thresholdMinutes: value })} suffix={t('minutes')} /><Toggle checked={settings.idle.enabled} onChange={(value) => nested('idle', { enabled: value })} /></div></div>
      </section>

      <section className="app-version"><Info size={14} /><span>{t('appVersion')}</span><strong>{appVersion ? `v${appVersion}` : '…'}</strong></section>

      <div className={`autosave-indicator autosave-indicator--${saveState}`}><span />{saveState === 'saving' ? t('saving') : saveState === 'error' ? t('saveFailed') : t('autosaved')}</div>
    </motion.div>
  )
}
