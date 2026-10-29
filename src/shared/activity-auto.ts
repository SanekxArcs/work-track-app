import type { ActivityRange, ActivitySuggestion } from './activity-drafts'
import { normalizeActivityRanges, subtractActivityRanges } from './activity-drafts'
import type { ActivityMatchKind } from './activity-learning'

export const AUTO_MINIMUMS = [60000, 300000, 900000] as const
export const AUTO_INTERVALS = [5, 10, 15, 30] as const
/** An entry whose last observation ended this recently is still being extended. */
export const AUTO_LIVE_MS = 180000

export interface AutoTrackingConfig {
  enabled: boolean
  /** Shortest observed period that becomes an automatic entry. */
  minimumMs: (typeof AUTO_MINIMUMS)[number]
  /** How often observations are re-read while the app runs. */
  intervalMinutes: (typeof AUTO_INTERVALS)[number]
}
/**
 * One automatically recorded period of work. Entries are a monitoring journal
 * kept beside the manual tracker: nothing becomes a task until it is promoted.
 */
export interface AutoEntry {
  id: string
  day: string
  intervals: ActivityRange[]
  recordIds: string[]
  /** Project resolved from corrections, links, rules or a unique name match. */
  projectId: string | null
  projectLabel: string
  match: ActivityMatchKind
  context: string[]
  firstSeenAt: number
  updatedAt: number
  status: 'open' | 'promoted' | 'dismissed'
  /** Explicit project choice; `undefined` keeps following the matcher. */
  chosenProjectId?: string | null
  notes?: string
  taskId?: string
  promotedAt?: number
}
export interface AutoTrackingState {
  config: AutoTrackingConfig
  lastRunAt: number | null
  lastError: string | null
  running: boolean
  entries: AutoEntry[]
}
export type AutoTrackingAction =
  | 'configure'
  | 'run'
  | 'dismiss'
  | 'restore'
  | 'update'
  | 'promote'
export interface AutoTrackingResponse {
  data: import('./activity').ActivityDay
  snapshot?: import('./types').AppSnapshot
  created?: number
}
export const DEFAULT_AUTO_CONFIG: AutoTrackingConfig = {
  enabled: false,
  minimumMs: 300000,
  intervalMinutes: 5
}
export function normalizeAutoConfig(raw: unknown): AutoTrackingConfig {
  const value = raw as AutoTrackingConfig
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.enabled !== 'boolean' ||
    !AUTO_MINIMUMS.includes(value.minimumMs) ||
    !AUTO_INTERVALS.includes(value.intervalMinutes)
  )
    throw new Error('Invalid automatic tracking settings')
  return {
    enabled: value.enabled,
    minimumMs: value.minimumMs,
    intervalMinutes: value.intervalMinutes
  }
}
export function rangesMs(ranges: ActivityRange[]): number {
  return ranges.reduce((sum, r) => sum + r.end - r.start, 0)
}
export function rangesOverlap(a: ActivityRange[], b: ActivityRange[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end))
}
export function intersectActivityRanges(
  a: ActivityRange[],
  b: ActivityRange[]
): ActivityRange[] {
  return subtractActivityRanges(a, subtractActivityRanges(a, b))
}
export function autoEntryMs(entry: Pick<AutoEntry, 'intervals'>): number {
  return rangesMs(entry.intervals)
}
export function autoEntryProject(entry: AutoEntry): string | null {
  return entry.chosenProjectId !== undefined
    ? entry.chosenProjectId
    : entry.projectId
}
export function autoEntryDescription(entry: AutoEntry): string {
  const note = entry.notes?.trim()
  if (note) return note.slice(0, 2000)
  return ('Auto · ' + (entry.context.join(' · ') || 'observed activity')).slice(
    0,
    2000
  )
}
export function autoEntryLive(entry: AutoEntry, now = Date.now()): boolean {
  return (
    entry.status === 'open' &&
    now - entry.intervals[entry.intervals.length - 1].end < AUTO_LIVE_MS
  )
}
function sameEntryEvidence(entry: AutoEntry, suggestion: ActivitySuggestion): boolean {
  return (
    JSON.stringify(entry.intervals) === JSON.stringify(suggestion.intervals) &&
    JSON.stringify(entry.recordIds) === JSON.stringify(suggestion.recordIds) &&
    entry.projectId === suggestion.projectId &&
    entry.projectLabel === suggestion.projectLabel &&
    entry.match === suggestion.match &&
    JSON.stringify(entry.context) === JSON.stringify(suggestion.context)
  )
}
/**
 * Folds the current suggestions into the saved journal. Open entries grow with
 * their observations, vanish once a manual timer covers them, and dismissed or
 * promoted entries are never recreated for the same observed time.
 */
export function reconcileAutoEntries(
  existing: AutoEntry[],
  suggestions: ActivitySuggestion[],
  day: string,
  minimumMs: number,
  now: number,
  id: () => string
): AutoEntry[] {
  const kept = existing.filter((e) => e.status !== 'open' && e.day === day)
  const open = existing.filter((e) => e.status === 'open' && e.day === day)
  const settled = normalizeActivityRanges(kept.flatMap((e) => e.intervals))
  const used = new Set<string>()
  const result: AutoEntry[] = [...kept]
  for (const suggestion of suggestions) {
    if (suggestion.day !== day) continue
    const intervals = settled.length
      ? subtractActivityRanges(suggestion.intervals, settled)
      : normalizeActivityRanges(suggestion.intervals)
    if (!intervals.length || rangesMs(intervals) < minimumMs) continue
    const current = { ...suggestion, intervals }
    const match = open.find(
      (e) => !used.has(e.id) && rangesOverlap(e.intervals, current.intervals)
    )
    if (match) {
      used.add(match.id)
      result.push(
        sameEntryEvidence(match, current)
          ? match
          : {
              ...match,
              intervals: current.intervals,
              recordIds: [...current.recordIds],
              projectId: current.projectId,
              projectLabel: current.projectLabel,
              match: current.match,
              context: [...current.context],
              updatedAt: now
            }
      )
    } else
      result.push({
        id: id(),
        day,
        intervals: current.intervals,
        recordIds: [...current.recordIds],
        projectId: current.projectId,
        projectLabel: current.projectLabel,
        match: current.match,
        context: [...current.context],
        firstSeenAt: now,
        updatedAt: now,
        status: 'open'
      })
  }
  return result.sort(
    (a, b) =>
      a.intervals[0].start - b.intervals[0].start || a.id.localeCompare(b.id)
  )
}
export function validAutoEntry(raw: unknown): raw is AutoEntry {
  const e = raw as AutoEntry
  return (
    !!e &&
    typeof e === 'object' &&
    typeof e.id === 'string' &&
    typeof e.day === 'string' &&
    Array.isArray(e.intervals) &&
    e.intervals.length > 0 &&
    ['open', 'promoted', 'dismissed'].includes(e.status)
  )
}
