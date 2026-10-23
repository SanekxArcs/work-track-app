import { randomUUID } from 'node:crypto'
import type {
  ActivityAssignment,
  ActivityConfig,
  ActivityDay,
  ActivityEnvelope,
  ActivityRecord,
  ActivityStatus
} from '../shared/activity'
import {
  activitySite,
  splitActivityRecord,
  validActivityDay,
  validActivityId,
  validActivityRecordId,
  validateActivityEnvelope
} from '../shared/activity'
import {
  normalizeActivityRule,
  type ActivityRule,
  type ActivityProjectRegistry,
  type ProjectCatalogEntry,
  type ProjectLinkChange
} from '../shared/activity-learning'
import { localDateKey } from '../shared/local-date'
import { ActivityStore } from './activity-store'
import {
  WindowsActivityCollector,
  type ForegroundSample
} from './windows-activity'

interface Vault {
  encrypt(value: string): string
  decrypt(value: string): string
}
export class ActivityService {
  private collector: Pick<WindowsActivityCollector, 'start' | 'stop'>
  private previous?: { at: number; record: ActivityRecord }
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private suspended = false
  private locked = false
  private error: string | null = null
  private syncError: string | null = null
  private pending?: Promise<void>
  private controllers = new Set<AbortController>()
  private state = 'Paused'
  private nextAttempt = 0
  private epoch = 0
  constructor(
    readonly store: ActivityStore,
    private vault: Vault,
    private idleSeconds: () => number,
    private request: typeof fetch = fetch,
    collector?: Pick<WindowsActivityCollector, 'start' | 'stop'>
  ) {
    this.collector =
      collector ??
      new WindowsActivityCollector(
        (value) => this.observe(value),
        (message) => {
          this.error = message
          if (message) this.previous = undefined
        }
      )
  }
  private projectProvider?: () => ProjectCatalogEntry[]
  setProjectProvider(provider: () => ProjectCatalogEntry[]): void {
    this.projectProvider = provider
  }
  projects(): ActivityProjectRegistry {
    return (
      this.store.get<ActivityProjectRegistry>(
        'projects:' +
          this.store.config().siteUrl +
          ':' +
          this.store.config().deviceId
      ) ?? {
        deviceId: this.store.config().deviceId,
        workProjects: [],
        browserProjects: [],
        links: [],
        updatedAt: null
      }
    )
  }
  async refreshProjects(): Promise<ActivityProjectRegistry> {
    if (!this.store.config().cloudEnabled) return this.projects()
    const deviceId = this.store.config().deviceId,
      previous = this.projects()
    try {
      if (this.projectProvider)
        await this.call('/work-buddy/projects', 'PUT', {
          deviceId,
          sourceId: this.store.sourceId,
          kind: 'desktop',
          capturedAt: Date.now(),
          projects: this.projectProvider()
        })
      const result = (await this.call(
        '/work-buddy/projects?deviceId=' + encodeURIComponent(deviceId),
        'GET'
      )) as ActivityProjectRegistry
      if (
        result.deviceId !== deviceId ||
        !Array.isArray(result.links) ||
        !Array.isArray(result.browserProjects) ||
        !Array.isArray(result.workProjects)
      )
        throw new Error('Invalid project catalog')
      if (!this.running) return previous
      if (this.store.config().deviceId !== deviceId) return this.projects()
      if (
        JSON.stringify(result.links) !== JSON.stringify(this.projects().links)
      ) {
        this.store.clearRecaps()
        this.store.clearMatching()
        this.epoch++
      }
      this.store.set(
        'projects:' + this.store.config().siteUrl + ':' + deviceId,
        result
      )
      return result
    } catch (error) {
      return {
        ...previous,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
  async linkProject(
    change: ProjectLinkChange
  ): Promise<ActivityProjectRegistry> {
    if (!this.store.config().cloudEnabled)
      throw new Error('Enable cloud sync before sharing a project link')
    await this.call('/work-buddy/project-link', 'PUT', {
      ...change,
      deviceId: this.store.config().deviceId
    })
    return this.refreshProjects()
  }
  saveRule(input: ActivityRule): void {
    const rule = normalizeActivityRule(input),
      rules = this.rules()
    rule.id = rule.id || randomUUID()
    if (input.id && !rules.some((r) => r.id === input.id))
      throw new Error('Rule no longer exists')
    this.store.set('rules', [...rules.filter((r) => r.id !== rule.id), rule])
    this.store.clearRecaps()
    this.store.clearMatching()
    this.epoch++
  }
  deleteRule(id: string): void {
    this.store.set(
      'rules',
      this.rules().filter((r) => r.id !== id)
    )
    this.store.clearRecaps()
    this.store.clearMatching()
    this.epoch++
  }
  rules(): ActivityRule[] {
    const rules = this.store.get<ActivityRule[]>('rules') ?? []
    if (rules.some((r) => !r.id)) {
      const next = rules.map((r) => ({ ...r, id: r.id || randomUUID() }))
      this.store.set('rules', next)
      return next
    }
    return rules
  }
  start(): void {
    this.running = true
    this.store.prune()
    if (this.store.config().enabled) {
      this.state = 'Starting'
      this.collector.start()
    }
    this.timer = setInterval(() => {
      if (Date.now() >= this.nextAttempt) void this.sync()
    }, 60000)
    void this.sync()
  }
  stop(): void {
    this.running = false
    clearInterval(this.timer)
    this.collector.stop()
    for (const c of this.controllers) c.abort()
    this.previous = undefined
  }
  system(event: 'suspend' | 'resume' | 'lock' | 'unlock'): void {
    this.previous = undefined
    if (event === 'suspend') {
      this.suspended = true
      this.state = 'Sleeping'
    }
    if (event === 'resume') {
      this.suspended = false
      this.nextAttempt = 0
    }
    if (event === 'lock') this.locked = true
    if (event === 'unlock') this.locked = false
  }
  status(): ActivityStatus {
    return {
      config: this.store.config(),
      sourceId: this.store.sourceId,
      state: this.state,
      error: this.error,
      syncError: this.syncError,
      lastSyncedAt: this.store.get<number>('lastSyncedAt') ?? null,
      pendingDays: this.store.dirty().length,
      hasReadKey: !!this.store.get('readKey'),
      hasWriteKey: !!this.store.get('writeKey'),
      syncing: !!this.pending
    }
  }
  configure(
    input: ActivityConfig,
    writeKey?: string,
    readKey?: string
  ): ActivityStatus {
    if (this.pending) throw new Error('Wait for activity sync to finish')
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      typeof input.captureTitles !== 'boolean' ||
      typeof input.cloudEnabled !== 'boolean' ||
      ![7, 30, 90].includes(input.retentionDays) ||
      !Number.isInteger(input.idleSeconds) ||
      input.idleSeconds < 15 ||
      input.idleSeconds > 3600 ||
      !validActivityId(input.deviceId)
    )
      throw new Error('Invalid activity settings')
    for (const list of [input.excludedApps, input.excludedTitlePatterns])
      if (
        !Array.isArray(list) ||
        list.length > 200 ||
        list.some((v) => typeof v !== 'string' || v.length > 200)
      )
        throw new Error('Invalid exclusions')
    const siteUrl = activitySite(input.siteUrl)
    if (input.cloudEnabled && !siteUrl)
      throw new Error('Enter a Convex site URL')
    const previous = this.store.config()
    if (
      previous.siteUrl &&
      siteUrl !== previous.siteUrl &&
      (!writeKey?.trim() || !readKey?.trim())
    )
      throw new Error('Enter both keys for the new deployment')
    const encryptedKeys: Array<[string, string]> = []
    for (const [name, key] of [
      ['writeKey', writeKey],
      ['readKey', readKey]
    ] as const) {
      if (key !== undefined && typeof key !== 'string')
        throw new Error('Invalid connection key')
      if (key?.trim()) {
        if (key.trim().length < 32)
          throw new Error('Connection keys need at least 32 characters')
        encryptedKeys.push([name, this.vault.encrypt(key.trim())])
      }
    }
    if (
      input.cloudEnabled &&
      ((!encryptedKeys.some(([name]) => name === 'writeKey') &&
        !this.store.get('writeKey')) ||
        (!encryptedKeys.some(([name]) => name === 'readKey') &&
          !this.store.get('readKey')))
    )
      throw new Error(
        'Import the Work Buddy connection file or enter both connection keys'
      )
    for (const [name, value] of encryptedKeys) this.store.set(name, value)
    const privacyChanged =
      previous.captureTitles !== input.captureTitles ||
      previous.deviceId !== input.deviceId ||
      input.retentionDays < previous.retentionDays ||
      JSON.stringify(previous.excludedApps) !==
        JSON.stringify(input.excludedApps) ||
      JSON.stringify(previous.excludedTitlePatterns) !==
        JSON.stringify(input.excludedTitlePatterns)
    this.store.set('config', {
      enabled: input.enabled,
      captureTitles: input.captureTitles,
      idleSeconds: input.idleSeconds,
      retentionDays: input.retentionDays,
      cloudEnabled: input.cloudEnabled,
      deviceId: input.deviceId,
      siteUrl,
      excludedApps: input.excludedApps
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
      excludedTitlePatterns: input.excludedTitlePatterns
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    })
    this.epoch++
    if (privacyChanged) {
      this.store.clearRecaps()
      this.store.clearMatching()
    }
    this.previous = undefined
    this.nextAttempt = 0
    if (input.enabled && this.running) {
      this.state = 'Starting'
      this.collector.start()
    } else {
      this.collector.stop()
      this.state = 'Paused'
    }
    this.store.prune()
    for (const day of this.store.days()) this.store.mark(day)
    this.store.mark(localDateKey(Date.now()))
    return this.status()
  }
  importConnection(text: string): ActivityStatus {
    const env: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
    if (
      !env.WORK_BUDDY_SITE_URL ||
      !env.WORK_BUDDY_WRITE_KEY ||
      !env.WORK_BUDDY_READ_KEY ||
      !env.WORK_BUDDY_SOURCE_ID
    )
      throw new Error(
        'The connection file is missing required Work Buddy settings'
      )
    return this.configure(
      {
        ...this.store.config(),
        cloudEnabled: true,
        siteUrl: env.WORK_BUDDY_SITE_URL,
        deviceId: env.WORK_BUDDY_SOURCE_ID
      },
      env.WORK_BUDDY_WRITE_KEY,
      env.WORK_BUDDY_READ_KEY
    )
  }
  private excluded(app: string, title: string): boolean {
    const config = this.store.config()
    return (
      config.excludedApps.some(
        (v) =>
          v === app.toLowerCase() ||
          v.replace(/\.exe$/, '') === app.toLowerCase().replace(/\.exe$/, '')
      ) ||
      config.excludedTitlePatterns.some((v) => title.toLowerCase().includes(v))
    )
  }
  observe(sample: ForegroundSample, now = Date.now()): void {
    if (!this.running) return
    const config = this.store.config()
    if (
      !config.enabled ||
      this.suspended ||
      Math.abs(now - sample.at) > 10000
    ) {
      this.previous = undefined
      return
    }
    const state = this.locked
      ? 'locked'
      : this.idleSeconds() >= config.idleSeconds
        ? 'idle'
        : 'active'
    if (
      state === 'active' &&
      (!sample.app || this.excluded(sample.app, sample.title))
    ) {
      this.previous = undefined
      this.state = sample.app ? 'Excluded' : 'No foreground window'
      return
    }
    const record: ActivityRecord = {
      id: randomUUID(),
      sourceId: this.store.sourceId,
      deviceId: config.deviceId,
      kind: 'desktop',
      state,
      start: now,
      end: now,
      app: state === 'active' ? sample.app.slice(0, 200) : '',
      title:
        state === 'active' && config.captureTitles
          ? sample.title.slice(0, 500)
          : ''
    }
    const previous = this.previous
    if (previous && now > previous.at && now - previous.at <= 10000) {
      // The prior observation owns the elapsed interval; a focus change never re-labels it.
      const end =
        state === 'idle' && previous.record.state === 'active'
          ? Math.max(
              previous.at,
              now - Math.max(0, this.idleSeconds() - config.idleSeconds) * 1000
            )
          : now
      for (const part of splitActivityRecord({ ...previous.record, end }))
        this.store.put(part.day, part.record)
      if (
        previous.record.state === record.state &&
        previous.record.app === record.app &&
        previous.record.title === record.title &&
        localDateKey(previous.record.start) === localDateKey(now)
      ) {
        record.id = previous.record.id
        record.start = previous.record.start
      }
    }
    this.previous = { at: now, record }
    this.state =
      state === 'active' ? 'Recording' : state === 'locked' ? 'Locked' : 'Idle'
  }
  day(day: string): ActivityDay {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    const config = this.store.config()
    this.store.prune()
    const records = [
      ...this.store.local(day).filter((r) => !this.excluded(r.app, r.title)),
      ...this.store.remote(day, config.deviceId)
    ]
    return {
      day,
      recap: this.store.recap(day),
      assignments: this.store.assignments(),
      rules: this.rules(),
      projectLinks: this.projects().links,
      matching: this.store.get('matching:' + day),
      matchDecisions: this.store.get('decisions:' + day) ?? [],
      dailyNote: this.store.get<string>('note:' + day) ?? '',
      records: records.filter((r) => r.deviceId === config.deviceId),
      status: this.status(),
      cloudFetchedAt: this.store.get<number>('fetched:' + day) ?? null
    }
  }
  assignments(): ActivityAssignment[] {
    return this.store.assignments()
  }
  assign(value: ActivityAssignment): void {
    if (
      !value ||
      !validActivityRecordId(value.recordId) ||
      !(value.projectId === null || typeof value.projectId === 'string') ||
      typeof value.excluded !== 'boolean' ||
      typeof value.note !== 'string' ||
      value.note.length > 2000
    )
      throw new Error('Invalid activity correction')
    this.store.assign(value)
    this.store.clearRecaps()
    this.store.clearMatching()
    this.epoch++
  }
  remember(rule: ActivityRule): void {
    const old = this.rules().find(
      (r) =>
        r.kind === rule.kind &&
        r.pattern === rule.pattern &&
        r.sourceId === rule.sourceId &&
        r.app === rule.app
    )
    this.saveRule({ ...rule, id: old?.id })
  }
  forgetRules(): void {
    this.store.set('rules', [])
    this.store.clearRecaps()
    this.store.clearMatching()
    this.epoch++
  }
  invalidateReview(day: string): void {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    this.store.clearRecaps(day)
    this.epoch++
  }
  get privacyEpoch(): number {
    return this.epoch
  }
  deleteDay(day: string): void {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    this.previous = undefined
    this.store.deleteDay(day)
    for (const prefix of ['matching:', 'decisions:', 'note:', 'review:'])
      this.store.set(prefix + day, null)
    this.epoch++
  }
  private key(name: string): string {
    const encrypted = this.store.get<string>(name)
    if (!encrypted)
      throw new Error('Import the Work Buddy connection file first')
    return this.vault.decrypt(encrypted)
  }
  private async call(
    path: string,
    method: 'GET' | 'PUT',
    body?: unknown
  ): Promise<unknown> {
    const config = this.store.config(),
      controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await this.request(config.siteUrl + path, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.key(method === 'GET' ? 'readKey' : 'writeKey')}`,
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Activity connection key was rejected'
            : `Activity sync returned HTTP ${response.status}`
        )
      return await response.json()
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
    }
  }
  sync(): Promise<void> {
    if (this.pending) return this.pending
    if (!this.running || !this.store.config().cloudEnabled)
      return Promise.resolve()
    this.pending = this.upload().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }
  private async upload(): Promise<void> {
    try {
      this.store.prune()
      const config = this.store.config()
      for (const item of this.store.dirty()) {
        if (!this.running) break
        const envelope: ActivityEnvelope = {
          schemaVersion: 1,
          sourceId: this.store.sourceId,
          deviceId: config.deviceId,
          kind: 'desktop',
          day: item.day,
          capturedAt: Date.now(),
          retentionDays: config.retentionDays,
          records: this.store
            .local(item.day)
            .filter((r) => !this.excluded(r.app, r.title))
            .map((r) => ({
              ...r,
              deviceId: config.deviceId,
              title: config.captureTitles ? r.title : ''
            }))
        }
        const receipt = (await this.call(
          '/work-buddy/activity',
          'PUT',
          envelope
        )) as {
          sourceId?: string
          day?: string
          syncedAt?: number
        }
        if (
          receipt.sourceId !== envelope.sourceId ||
          receipt.day !== item.day ||
          !Number.isFinite(receipt.syncedAt)
        )
          throw new Error('Invalid activity sync confirmation')
        if (!this.running) return
        this.store.ack(item.day, item.revision)
      }
      if (this.running) {
        if (this.projectProvider) await this.refreshProjects()
        if (!this.running) return
        this.store.set('lastSyncedAt', Date.now())
        this.syncError = null
        this.nextAttempt = Date.now() + 60000
      }
    } catch (error) {
      this.syncError =
        error instanceof Error ? error.message : 'Activity sync failed'
      this.nextAttempt = Date.now() + 60000
    }
  }
  async refresh(day: string): Promise<ActivityDay> {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    if (this.store.config().cloudEnabled) {
      await this.sync()
      const payload = (await this.call(
        `/work-buddy/activity?deviceId=${encodeURIComponent(this.store.config().deviceId)}&day=${day}`,
        'GET'
      )) as { sources?: Array<{ data: unknown }> }
      if (!Array.isArray(payload.sources))
        throw new Error('Invalid activity response')
      const sources = payload.sources.map((source) =>
        validateActivityEnvelope(source.data)
      )
      if (
        sources.some(
          (env) =>
            env.day !== day || env.deviceId !== this.store.config().deviceId
        )
      )
        throw new Error('Activity source does not match this device and date')
      if (this.running) {
        const next = new Map(
          sources.flatMap((s) => s.records).map((r) => [r.id, r])
        )
        const removed = this.store
          .remote(day, this.store.config().deviceId)
          .some((old) => {
            const current = next.get(old.id)
            return (
              !current || current.title !== old.title || current.url !== old.url
            )
          })
        if (removed) {
          this.store.clearRecaps(day)
          this.store.clearMatching(day)
          this.epoch++
        }
        this.store.cache(day, sources)
      }
    }
    return this.day(day)
  }
}
