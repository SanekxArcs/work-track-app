import type { BackupData, RestType, SanitySyncResult, StartMode } from '../shared/types'
import { WorkBuddyDatabase } from './database'

const DOCUMENT_ID = 'workBuddySync.v1'
const DOCUMENT_TYPE = 'workBuddySync'
const COMMAND_MAX_AGE_MS = 10 * 60_000
const COMMAND_MAX_FUTURE_SKEW_MS = 2 * 60_000

type SanityDocument = {
  payload?: unknown
  _rev?: string
}

type CloudBackup = {
  backup: BackupData
  revision: string
}

class SanityRevisionConflict extends Error {
  constructor() {
    super('The cloud workspace changed during sync')
  }
}

type WorkBuddyCommand = {
  _id: string
  createdAt?: string
  command?: string
  taskId?: string
  restId?: string
  workdayId?: string
  restType?: RestType
  mode?: StartMode
}

/** A fresh desktop can restore its cloud workspace without overwriting local work. */
export function shouldRestoreCloudBackup(backup: BackupData): boolean {
  return backup.projects.length === 0
    && backup.plannedTasks.length === 0
    && backup.tasks.length === 0
    && backup.workdays.length === 0
    && backup.rests.length === 0
    && (backup.overtimeRedeemedDates?.length ?? 0) === 0
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
  private syncInFlight: Promise<SanitySyncResult> | null = null

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
    if (!response.ok) {
      if (response.status === 409) throw new SanityRevisionConflict()
      throw new Error(readError(body))
    }
    return body
  }

  private async readCloudBackup(): Promise<CloudBackup | null> {
    const config = this.config()
    const query = encodeURIComponent(`*[_id == "${DOCUMENT_ID}"][0]{payload, _rev}`)
    const response = await this.request<{ result?: SanityDocument }>(`data/query/${encodeURIComponent(config.dataset)}?query=${query}`)
    if (!response.result?.payload) return null
    if (!response.result._rev) throw new Error('Cloud workspace revision is missing')
    return { backup: this.database.parseBackup(JSON.stringify(response.result.payload)), revision: response.result._rev }
  }

  private async writeCloudBackup(backup: BackupData, revision?: string): Promise<void> {
    const config = this.config()
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      payload: backup
    }
    await this.request(`data/mutate/${encodeURIComponent(config.dataset)}?returnIds=true`, {
      method: 'POST',
      body: JSON.stringify({
        mutations: revision
          ? [{ patch: { id: DOCUMENT_ID, ifRevisionID: revision, set: payload } }]
          : [{ create: { _id: DOCUMENT_ID, _type: DOCUMENT_TYPE, ...payload } }]
      })
    })
  }

  private async writeCommandStatus(id: string, status: 'applied' | 'failed', error?: string): Promise<void> {
    const config = this.config()
    await this.request(`data/mutate/${encodeURIComponent(config.dataset)}?returnIds=true`, {
      method: 'POST',
      body: JSON.stringify({
        mutations: [{ patch: { id, set: { status, processedAt: new Date().toISOString(), ...(error ? { error } : {}) } } }]
      })
    })
  }

  private applyCommand(command: WorkBuddyCommand): void {
    switch (command.command) {
      case 'pause-task':
        if (!command.taskId) throw new Error('Task id is required')
        if (this.database.getSnapshot().tasks.find((task) => task.id === command.taskId)?.status !== 'running') {
          throw new Error('Task is no longer running')
        }
        this.database.pauseTask(command.taskId)
        return
      case 'resume-task':
        if (!command.taskId) throw new Error('Task id is required')
        if (this.database.getSnapshot().tasks.find((task) => task.id === command.taskId)?.status !== 'paused') {
          throw new Error('Task is no longer paused')
        }
        this.database.resumeTask(command.taskId, command.mode ?? 'parallel')
        return
      case 'start-task':
        if (command.mode !== 'parallel' && command.mode !== 'switch') throw new Error('Task mode is required')
        this.database.startTask({ mode: command.mode })
        return
      case 'start-rest':
        if (command.restType !== 'break' && command.restType !== 'lunch') throw new Error('Rest type is required')
        this.database.startRest(command.restType)
        return
      case 'complete-rest':
        if (!command.restId) throw new Error('Rest id is required')
        this.database.completeRest(command.restId)
        return
      case 'end-workday':
        if (!command.workdayId) throw new Error('Workday id is required')
        this.database.endWorkday(command.workdayId)
        return
      default:
        throw new Error('Unsupported Work Buddy command')
    }
  }

  private assertCommandIsFresh(command: WorkBuddyCommand): void {
    const createdAt = typeof command.createdAt === 'string' ? Date.parse(command.createdAt) : Number.NaN
    const age = Date.now() - createdAt
    if (!Number.isFinite(createdAt) || age > COMMAND_MAX_AGE_MS || age < -COMMAND_MAX_FUTURE_SKEW_MS) {
      throw new Error('This remote command expired before the desktop received it')
    }
  }

  async push(): Promise<void> {
    try {
      await this.sync()
    } catch (error) {
      if (error instanceof Error && error.message === 'Sanity is not configured on this device') return
      throw error
    }
  }

  async processPendingCommands(): Promise<boolean> {
    let config: { projectId: string; dataset: string; apiVersion: string; token: string }
    try {
      config = this.config()
    } catch (error) {
      if (error instanceof Error && error.message === 'Sanity is not configured on this device') return false
      throw error
    }
    const query = encodeURIComponent('*[_type == "workBuddyCommand" && status == "pending"] | order(createdAt asc)[0...20]{_id, createdAt, command, taskId, restId, restType, workdayId, mode}')
    const response = await this.request<{ result?: WorkBuddyCommand[] }>(`data/query/${encodeURIComponent(config.dataset)}?query=${query}`)
    const commands = response.result ?? []
    let changed = false
    for (const command of commands) {
      try {
        // A command can remain pending if the status write times out after the
        // local action succeeds. Do not run it again on the next poll.
        if (!this.database.hasProcessedRemoteCommand(command._id)) {
          this.assertCommandIsFresh(command)
          this.applyCommand(command)
          this.database.markRemoteCommandProcessed(command._id)
          changed = true
        }
      } catch (error) {
        await this.writeCommandStatus(command._id, 'failed', error instanceof Error ? error.message : 'Could not apply command')
        continue
      }
      try {
        await this.writeCommandStatus(command._id, 'applied')
      } catch {
        // The action is safely recorded locally. Leave the command pending so
        // a later poll can confirm it as applied instead of reporting a false failure.
      }
    }
    // The UI still needs to refresh when an action succeeded locally but the
    // immediate cloud push is temporarily unavailable.
    if (changed) await this.push().catch(() => undefined)
    return changed
  }

  async sync(): Promise<SanitySyncResult> {
    if (this.syncInFlight) return this.syncInFlight
    this.syncInFlight = this.syncWorkspace()
    try {
      return await this.syncInFlight
    } finally {
      this.syncInFlight = null
    }
  }

  private async syncWorkspace(): Promise<SanitySyncResult> {
    // A conditional patch turns the cloud document revision into an optimistic
    // lock. If another desktop writes in between, read again, merge again, and
    // retry rather than letting the last writer silently erase its data.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const local = this.database.exportBackup()
      const remote = await this.readCloudBackup()
      const merged = Boolean(remote)
      if (remote) {
        this.database.importBackup(remote.backup, shouldRestoreCloudBackup(local) ? 'replace' : 'merge')
      }
      try {
        await this.writeCloudBackup(this.database.exportBackup(), remote?.revision)
      } catch (error) {
        if (error instanceof SanityRevisionConflict && attempt < 2) continue
        throw error
      }
      const settings = this.database.getSettings()
      const syncedAt = Date.now()
      this.database.updateSettings({ ...settings, sanity: { ...settings.sanity, lastSyncedAt: syncedAt } })
      return { merged, projectId: settings.sanity.projectId, dataset: settings.sanity.dataset, syncedAt }
    }
    throw new Error('Could not synchronize the cloud workspace')
  }
}
