import type { BackupData, SanitySyncResult } from '../shared/types'
import { WorkBuddyDatabase } from './database'

const DOCUMENT_ID = 'workBuddySync.v1'
const DOCUMENT_TYPE = 'workBuddySync'

type SanityDocument = {
  payload?: unknown
}

function readError(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { description?: string; message?: string } | string }).error
    if (typeof error === 'string') return error
    if (error?.description || error?.message) return error.description || error.message || 'Sanity request failed'
  }
  return 'Sanity request failed'
}

export class SanityService {
  constructor(private readonly database: WorkBuddyDatabase, private readonly token: () => string) {}

  private config(): { projectId: string; dataset: string; apiVersion: string; token: string } {
    const settings = this.database.getSettings().sanity
    const token = this.token()
    if (!settings.projectId || !settings.dataset || !token) throw new Error('Sanity is not configured on this device')
    return { ...settings, token }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const config = this.config()
    const response = await fetch(`https://${config.projectId}.api.sanity.io/v${config.apiVersion}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        ...init?.headers
      }
    })
    const body = await response.json().catch(() => ({})) as T
    if (!response.ok) throw new Error(readError(body))
    return body
  }

  private async readCloudBackup(): Promise<BackupData | null> {
    const config = this.config()
    const query = encodeURIComponent(`*[_id == "${DOCUMENT_ID}"][0]{payload}`)
    const response = await this.request<{ result?: SanityDocument }>(`data/query/${encodeURIComponent(config.dataset)}?query=${query}`)
    if (!response.result?.payload) return null
    return this.database.parseBackup(JSON.stringify(response.result.payload))
  }

  private async writeCloudBackup(backup: BackupData): Promise<void> {
    const config = this.config()
    await this.request(`data/mutate/${encodeURIComponent(config.dataset)}?returnIds=true`, {
      method: 'POST',
      body: JSON.stringify({
        mutations: [{
          createOrReplace: {
            _id: DOCUMENT_ID,
            _type: DOCUMENT_TYPE,
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            payload: backup
          }
        }]
      })
    })
  }

  async sync(): Promise<SanitySyncResult> {
    const remote = await this.readCloudBackup()
    const merged = Boolean(remote)
    if (remote) this.database.importBackup(remote, 'merge')
    const backup = this.database.exportBackup()
    await this.writeCloudBackup(backup)
    const syncedAt = Date.now()
    const settings = this.database.getSettings()
    this.database.updateSettings({ ...settings, sanity: { ...settings.sanity, lastSyncedAt: syncedAt } })
    return { merged, projectId: settings.sanity.projectId, dataset: settings.sanity.dataset, syncedAt }
  }
}
