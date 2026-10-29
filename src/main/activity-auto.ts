import { randomUUID } from 'node:crypto'
import { validActivityDay } from '../shared/activity'
import {
  autoEntryDescription,
  autoEntryProject,
  DEFAULT_AUTO_CONFIG,
  intersectActivityRanges,
  normalizeAutoConfig,
  rangesOverlap,
  reconcileAutoEntries,
  type AutoEntry,
  type AutoTrackingConfig,
  type AutoTrackingState
} from '../shared/activity-auto'
import { activitySuggestions, type ActivityDraft } from '../shared/activity-drafts'
import { localDateKey, localDayBounds, localDaysBefore } from '../shared/local-date'
import type { AppSnapshot } from '../shared/types'
import type { ActivityService } from './activity'
import { acceptActivityDrafts } from './activity-import'
import type { WorkBuddyDatabase } from './database'

const CONFIG_KEY = 'auto:config',
  LAST_RUN_KEY = 'auto:lastRunAt'
/** Yesterday keeps receiving late browser checkpoints for a while after midnight. */
const FINALIZE_WINDOW_MS = 2 * 3600000
/**
 * Unattended tracking loop: periodically re-reads desktop and browser
 * observations, folds settled periods outside manual timers into a per-day
 * journal, and lets the user promote journal entries into ordinary tasks.
 * It never starts, pauses or edits a timer by itself.
 */
export class AutoTrackingService {
  private timer?: ReturnType<typeof setInterval>
  private kickoff?: ReturnType<typeof setTimeout>
  private pending?: Promise<void>
  private lastError: string | null = null
  private started = false
  constructor(
    private activity: ActivityService,
    private db: WorkBuddyDatabase,
    private onChanged: () => void = () => {},
    private clock: () => number = Date.now
  ) {}
  config(): AutoTrackingConfig {
    try {
      return normalizeAutoConfig(
        this.activity.store.get<AutoTrackingConfig>(CONFIG_KEY) ?? DEFAULT_AUTO_CONFIG
      )
    } catch {
      return { ...DEFAULT_AUTO_CONFIG }
    }
  }
  state(day: string): AutoTrackingState {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    return {
      config: this.config(),
      lastRunAt: this.activity.store.get<number>(LAST_RUN_KEY) ?? null,
      lastError: this.lastError,
      running: !!this.pending,
      entries: this.activity.store.autoEntries(day)
    }
  }
  configure(raw: unknown): AutoTrackingConfig {
    const previous = this.config(),
      config = normalizeAutoConfig(raw)
    this.activity.store.set(CONFIG_KEY, config)
    if (config.enabled && (!previous.enabled || config.minimumMs !== previous.minimumMs))
      this.soon()
    return config
  }
  start(): void {
    this.started = true
    this.timer = setInterval(() => this.tick(), 60000)
    this.kickoff = setTimeout(() => this.tick(true), 15000)
  }
  stop(): void {
    this.started = false
    clearInterval(this.timer)
    clearTimeout(this.kickoff)
  }
  /** Re-run shortly after a settings change or wake-up without waiting for the interval. */
  soon(): void {
    if (!this.started) return
    clearTimeout(this.kickoff)
    this.kickoff = setTimeout(() => this.tick(true), 2000)
  }
  private tick(force = false): void {
    if (!this.started) return
    const config = this.config()
    if (!config.enabled) return
    const last = this.activity.store.get<number>(LAST_RUN_KEY) ?? 0
    if (force || this.clock() - last >= config.intervalMinutes * 60000) void this.run()
  }
  /** Days whose observations are still changing: today, plus yesterday shortly after midnight. */
  private defaultDays(): string[] {
    const now = this.clock(),
      today = localDateKey(now)
    return now - localDayBounds(now)[0] < FINALIZE_WINDOW_MS
      ? [localDateKey(localDaysBefore(now, 1)), today]
      : [today]
  }
  run(days?: string[], refresh = true): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.execute(days ?? this.defaultDays(), refresh).finally(() => {
      this.pending = undefined
    })
    return this.pending
  }
  private async execute(days: string[], refresh: boolean): Promise<void> {
    let failure: string | null = null
    for (const day of days) {
      if (!validActivityDay(day)) throw new Error('Invalid activity date')
      if (refresh && this.activity.store.config().cloudEnabled) {
        try {
          await this.activity.refresh(day)
        } catch (error) {
          // Local observations still get reconciled; the cloud copy is retried next round.
          failure = error instanceof Error ? error.message : 'Browser activity refresh failed'
        }
      }
      this.reconcile(day)
    }
    this.lastError = failure
    this.activity.store.set(LAST_RUN_KEY, this.clock())
  }
  /** Folds the day's current suggestions into its journal and returns the saved entries. */
  reconcile(day: string): AutoEntry[] {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    const now = this.clock(),
      config = this.config(),
      data = this.activity.day(day),
      snapshot = this.db.getDaySnapshot(day)
    const suggestions = activitySuggestions(data, snapshot, config.minimumMs, now)
    // A promoted entry whose task was deleted since must not block the period forever.
    const existing = this.activity.store
      .autoEntries(day)
      .filter((e) => e.status !== 'promoted' || snapshot.tasks.some((t) => t.id === e.taskId))
    const next = reconcileAutoEntries(existing, suggestions, day, config.minimumMs, now, randomUUID)
    if (JSON.stringify(next) !== JSON.stringify(this.activity.store.autoEntries(day)))
      this.activity.store.saveAutoEntries(day, next)
    return next
  }
  private entry(day: string, id: unknown): AutoEntry {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    if (typeof id !== 'string') throw new Error('Invalid automatic entry')
    const entry = this.activity.store.autoEntries(day).find((e) => e.id === id)
    if (!entry) throw new Error('This automatic entry no longer exists')
    return entry
  }
  private save(day: string, entry: AutoEntry): void {
    this.activity.store.saveAutoEntries(day, [
      ...this.activity.store.autoEntries(day).filter((e) => e.id !== entry.id),
      entry
    ])
  }
  dismiss(day: string, id: unknown): void {
    const entry = this.entry(day, id)
    if (entry.status === 'promoted') throw new Error('Recorded entries are managed as tasks')
    this.save(day, { ...entry, status: 'dismissed', updatedAt: this.clock() })
  }
  restore(day: string, id: unknown): void {
    const entry = this.entry(day, id)
    if (entry.status !== 'dismissed') throw new Error('Only dismissed entries can be restored')
    this.save(day, { ...entry, status: 'open', updatedAt: this.clock() })
    this.reconcile(day)
  }
  /** `project: 'auto'` follows the matcher again; `null` records without a project. */
  update(
    day: string,
    id: unknown,
    patch: { project?: 'auto' | string | null; notes?: string }
  ): void {
    const entry = this.entry(day, id)
    if (entry.status === 'promoted') throw new Error('Recorded entries are managed as tasks')
    if (!patch || typeof patch !== 'object') throw new Error('Invalid automatic entry change')
    const next = { ...entry, updatedAt: this.clock() }
    if ('project' in patch) {
      const choice = patch.project
      if (choice === 'auto') delete next.chosenProjectId
      else if (choice === null) next.chosenProjectId = null
      else if (
        typeof choice === 'string' &&
        this.db.getSnapshot().projects.some((p) => p.id === choice && !p.archived)
      )
        next.chosenProjectId = choice
      else throw new Error('Choose an existing active project')
    }
    if ('notes' in patch) {
      if (typeof patch.notes !== 'string' || patch.notes.length > 2000)
        throw new Error('Keep the description under 2000 characters')
      if (patch.notes.trim()) next.notes = patch.notes.trim()
      else delete next.notes
    }
    this.save(day, next)
  }
  /** Turns open journal entries into stopped tasks through the reviewed-work path. */
  promote(
    day: string,
    ids: unknown
  ): { snapshot: AppSnapshot; taskIds: string[]; created: number } {
    if (!validActivityDay(day)) throw new Error('Invalid activity date')
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some((id) => typeof id !== 'string'))
      throw new Error('Choose between 1 and 50 automatic entries to record')
    const entries = this.reconcile(day).filter((e) => e.status === 'open' && ids.includes(e.id))
    if (entries.length !== ids.length)
      throw new Error('Some automatic entries changed. Refresh and choose them again.')
    const data = this.activity.day(day),
      snapshot = this.db.getDaySnapshot(day),
      suggestions = activitySuggestions(data, snapshot, 0, this.clock())
    const drafts: ActivityDraft[] = entries.map((entry) => {
      const sources = suggestions.filter((s) => rangesOverlap(s.intervals, entry.intervals))
      const intervals = intersectActivityRanges(
        entry.intervals,
        sources.flatMap((s) => s.intervals)
      )
      if (!sources.length || !intervals.length)
        throw new Error('Observed activity changed. Run automatic tracking again.')
      const projectId = autoEntryProject(entry)
      return {
        suggestionIds: sources.map((s) => s.id),
        intervals,
        projectId: snapshot.projects.some((p) => p.id === projectId && !p.archived)
          ? projectId
          : null,
        notes: autoEntryDescription(entry)
      }
    })
    const result = acceptActivityDrafts(this.activity, this.db, { day, drafts })
    const now = this.clock(),
      promoted = new Map(entries.map((e, i) => [e.id, result.taskIds[i]]))
    this.activity.store.saveAutoEntries(
      day,
      this.activity.store.autoEntries(day).map((e) =>
        promoted.has(e.id)
          ? { ...e, status: 'promoted', taskId: promoted.get(e.id), promotedAt: now, updatedAt: now }
          : e
      )
    )
    this.onChanged()
    return result
  }
}
