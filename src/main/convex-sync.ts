import { randomUUID } from 'node:crypto'
import type { BackupData } from '../shared/types'
import type { ConvexSyncConfig, ConvexSyncStatus } from '../shared/convex-sync'

interface Store {
  getSecret(key: string): string | undefined
  setSecret(key: string, value: string): void
  exportBackup(): BackupData
}
interface Vault { encrypt(value: string): string; decrypt(value: string): string }
const STATE_KEY = 'convex_sync_state'
const TOKEN_KEY = 'convex_sync_token'
const MAX_BYTES = 10 * 1024 * 1024

export function normalizeSyncConfig(input: ConvexSyncConfig): ConvexSyncConfig {
  if (!input || typeof input.enabled !== 'boolean' || ![6, 12, 24].includes(input.intervalHours)) throw new Error('Invalid sync settings')
  const siteUrl = input.siteUrl.trim().replace(/\/+$/, '')
  if (siteUrl) {
    const url = new URL(siteUrl)
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.site$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Use your https://deployment.convex.site URL')
    }
  }
  if (input.enabled && !siteUrl) throw new Error('Enter a Convex site URL first')
  return { enabled: input.enabled, siteUrl, intervalHours: input.intervalHours }
}

/** Only work records and project labels leave the device. Device settings and secrets stay local. */
export function syncPayload(backup: BackupData, sourceId: string) {
  return {
    schemaVersion: 1, sourceId, exportedAt: backup.exportedAt,
    projects: backup.projects, plannedTasks: backup.plannedTasks, tasks: backup.tasks,
    workdays: backup.workdays, rests: backup.rests,
    overtimeRedeemedDates: backup.overtimeRedeemedDates ?? [],
    projectStatuses: backup.settings.projectStatuses, projectTypes: backup.settings.projectTypes
  }
}

export class ConvexSyncService {
  private state: ConvexSyncConfig & { sourceId: string; lastSyncedAt: number | null; lastAttemptAt: number | null }
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<ConvexSyncStatus>
  private error: string | null = null
  private hasKey = false
  private stopped = false
  private controller?: AbortController

  constructor(private store: Store, private vault: Vault, private request: typeof fetch = fetch, private now = Date.now) {
    this.hasKey = Boolean(store.getSecret(TOKEN_KEY))
    const stored = store.getSecret(STATE_KEY)
    const parsed = stored ? JSON.parse(stored) : null
    this.state = parsed ? { ...parsed, ...normalizeSyncConfig(parsed) } : {
      enabled: false, siteUrl: '', intervalHours: 12, sourceId: randomUUID(), lastSyncedAt: null, lastAttemptAt: null
    }
    this.persist()
  }
  private persist(): void { this.store.setSecret(STATE_KEY, JSON.stringify(this.state)) }
  status(): ConvexSyncStatus {
    const hasKey = this.hasKey
    const due = this.state.lastSyncedAt === null ? 0 : this.state.lastSyncedAt + this.state.intervalHours * 3600000
    const retry = this.state.lastAttemptAt === null ? 0 : this.state.lastAttemptAt + 30 * 60000
    return { enabled: this.state.enabled, siteUrl: this.state.siteUrl, intervalHours: this.state.intervalHours,
      sourceId: this.state.sourceId, lastSyncedAt: this.state.lastSyncedAt, hasKey,
      syncing: Boolean(this.pending), nextSyncAt: this.state.enabled && hasKey ? Math.max(due, retry, this.now()) : null, error: this.error }
  }
  configure(config: ConvexSyncConfig, key?: string): ConvexSyncStatus {
    if (this.pending) throw new Error('Wait for the current sync to finish')
    const clean = normalizeSyncConfig(config)
    const changedSite = clean.siteUrl !== this.state.siteUrl
    if (changedSite && this.state.siteUrl && !key?.trim()) throw new Error('Enter the write key for the new deployment')
    if (key !== undefined && typeof key !== 'string') throw new Error('Invalid write key')
    const token = key?.trim()
    if (token && token.length < 32) throw new Error('Use a write key of at least 32 characters')
    if (clean.enabled && !token && !this.hasKey) throw new Error('Enter a write key first')
    if (token) { this.store.setSecret(TOKEN_KEY, this.vault.encrypt(token)); this.hasKey = true }
    this.state = { ...this.state, ...clean, ...(changedSite ? { lastSyncedAt: null, lastAttemptAt: null } : {}) }
    this.error = null
    this.persist()
    return this.status()
  }
  start(): void {
    this.stopped = false
    this.timer = setInterval(() => { void this.tick() }, 60000)
    void this.tick()
  }
  stop(): void { this.stopped = true; clearInterval(this.timer); this.controller?.abort() }
  async tick(): Promise<void> {
    const status = this.status()
    if (!this.stopped && status.enabled && status.nextSyncAt !== null && status.nextSyncAt <= this.now() && !this.pending) await this.sync()
  }
  sync(): Promise<ConvexSyncStatus> {
    if (this.pending) return this.pending
    this.pending = this.upload().finally(() => { this.pending = undefined })
    return this.pending.then(() => this.status())
  }
  private async upload(): Promise<ConvexSyncStatus> {
    try {
      if (!this.state.enabled || !this.state.siteUrl) throw new Error('Enable and save sync first')
      const encrypted = this.store.getSecret(TOKEN_KEY)
      if (!encrypted) throw new Error('Enter a write key first')
      let key: string
      try {
        key = this.vault.decrypt(encrypted)
      } catch {
        this.hasKey = false
        throw new Error('The saved sync key cannot be unlocked. Re-enter your write key in Settings > Convex sync.')
      }
      const body = JSON.stringify(syncPayload(this.store.exportBackup(), this.state.sourceId))
      if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Sync data exceeds the 10 MB limit')
      this.state.lastAttemptAt = this.now()
      this.persist()
      this.controller = new AbortController()
      const timeout = setTimeout(() => this.controller?.abort(), 60000)
      try {
        const response = await this.request(`${this.state.siteUrl}/work-buddy/snapshot`, {
          method: 'PUT', redirect: 'error', signal: this.controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body
        })
        if (!response.ok) throw new Error(response.status === 401 ? 'Write key was rejected' : `Convex returned HTTP ${response.status}`)
        const receipt = await response.json() as { sourceId?: string; syncedAt?: number }
        if (receipt.sourceId !== this.state.sourceId || !Number.isFinite(receipt.syncedAt)) throw new Error('Invalid sync confirmation')
        this.state.lastSyncedAt = this.now()
        this.error = null
      } finally { clearTimeout(timeout); this.controller = undefined }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Sync failed'
    }
    if (!this.stopped) this.persist()
    return this.status()
  }
}
