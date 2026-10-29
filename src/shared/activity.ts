import { localDateKey, localDateTimestamp, localDayBounds } from './local-date'

export interface ActivityRecord {
  id: string
  sourceId: string
  deviceId: string
  kind: 'desktop' | 'browser'
  state: 'active' | 'idle' | 'locked'
  start: number
  end: number
  app: string
  title: string
  url?: string
  domain?: string
  projectName?: string
  browserProjectId?: string
}
export interface ActivityEnvelope {
  schemaVersion: 1
  sourceId: string
  deviceId: string
  day: string
  kind: 'desktop' | 'browser'
  capturedAt: number
  retentionDays: number
  records: ActivityRecord[]
  /** Local UTC offset of the capturing device in minutes, as reported by the client. */
  tzOffsetMinutes?: number
  /** IANA zone name of the capturing device, when known. */
  timezone?: string
}
export interface ActivityConfig {
  enabled: boolean
  captureTitles: boolean
  idleSeconds: number
  excludedApps: string[]
  excludedTitlePatterns: string[]
  retentionDays: 7 | 30 | 90
  cloudEnabled: boolean
  /** Fetch browser activity from Convex. Off when tabs-manager delivers it locally on this PC. */
  cloudReads: boolean
  /** Backup upload cadence; the live data path is local. */
  uploadMinutes: 5 | 15 | 60 | 180
  siteUrl: string
  deviceId: string
}
export const ACTIVITY_UPLOAD_MINUTES = [5, 15, 60, 180] as const
export interface ActivityStatus {
  config: ActivityConfig
  sourceId: string
  state: string
  error: string | null
  syncError: string | null
  lastSyncedAt: number | null
  pendingDays: number
  hasWriteKey: boolean
  hasReadKey: boolean
  syncing: boolean
}
export interface ActivityDay {
  day: string
  records: ActivityRecord[]
  status: ActivityStatus
  assignments: ActivityAssignment[]
  rules: import('./activity-review').ActivityRule[]
  projectLinks?: import('./activity-learning').ActivityProjectLink[]
  matching?: import('./activity-matching').ActivityMatchingResult
  matchDecisions?: import('./activity-matching').ActivityMatchDecision[]
  dailyNote?: string
  reviewStatus?: {reviewedAt:number|null;current:boolean}
  recap?: ActivityRecap
  /** Automatic tracking journal for this day; absent until the main process attaches it. */
  auto?: import('./activity-auto').AutoTrackingState
  cloudFetchedAt: number | null
  /** When tabs-manager last delivered this day's browser activity over the local bridge. */
  localReceivedAt?: number | null
}
export interface ActivityRecap {
  summary: string
  generatedAt: number
  through: number
  evidence: Array<{
    ref: string
    recordIds: string[]
    start: number
    end: number
    state: string
    app: string
    title: string
    url?: string
    project: string
    note?: string
  }>
}
export interface ActivityAssignment {
  recordId: string
  projectId: string | null
  excluded: boolean
  note: string
}
export interface ActivitySegment {
  start: number
  end: number
  state: ActivityRecord['state']
  record: ActivityRecord
  evidenceIds: string[]
}
export interface ActivityReport {
  segments: ActivitySegment[]
  activeMs: number
  idleMs: number
  browserMs: number
  manualMs: number
  untrackedMs: number
  projects: Array<{ label: string; ms: number }>
  groups: Array<{ label: string; ms: number }>
}
export function validActivityId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
}
// Browser tracker IDs include a colon before their calendar-day suffix.
export function validActivityRecordId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(value)
}
export function validActivityDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    localDateTimestamp(value)
    return true
  } catch {
    return false
  }
}
export function activitySite(input: string): string {
  const value = input.trim().replace(/\/+$/, '')
  if (!value) return ''
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.site$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Use your https://deployment.convex.site URL')
  return value
}
export function cleanActivityUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web addresses are supported')
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href.slice(0, 2048)
}
export function validateActivityEnvelope(raw: unknown, now = Date.now()): ActivityEnvelope {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid activity')
  const data = raw as ActivityEnvelope
  if (
    data.schemaVersion !== 1 ||
    !validActivityId(data.sourceId) ||
    !validActivityId(data.deviceId) ||
    !validActivityDay(data.day) ||
    !['desktop', 'browser'].includes(data.kind) ||
    !Number.isFinite(data.capturedAt) ||
    data.capturedAt > now + 300000 ||
    ![7, 30, 90].includes(data.retentionDays) ||
    !Array.isArray(data.records) ||
    data.records.length > 20000 ||
    (data.tzOffsetMinutes !== undefined &&
      (!Number.isSafeInteger(data.tzOffsetMinutes) || Math.abs(data.tzOffsetMinutes) > 840)) ||
    (data.timezone !== undefined && (typeof data.timezone !== 'string' || data.timezone.length > 64))
  )
    throw new Error('Invalid activity envelope')
  const ids = new Set<string>()
  const records = data.records.map((r): ActivityRecord => {
    if (
      !r ||
      !validActivityRecordId(r.id) ||
      ids.has(r.id) ||
      r.sourceId !== data.sourceId ||
      r.deviceId !== data.deviceId ||
      r.kind !== data.kind ||
      !['active', 'idle', 'locked'].includes(r.state) ||
      !Number.isFinite(r.start) ||
      !Number.isFinite(r.end) ||
      r.start < 0 ||
      r.end <= r.start ||
      r.end > data.capturedAt + 5000 ||
      r.end - r.start > 26 * 3600000 ||
      typeof r.app !== 'string' ||
      r.app.length > 200 ||
      typeof r.title !== 'string' ||
      r.title.length > 500
    )
      throw new Error('Invalid activity record')
    // Day boundaries vary with timezone; permit only plausible offsets from the labelled day.
    const midday = Date.parse(data.day + 'T12:00:00Z')
    if (r.start < midday - 26 * 3600000 || r.end > midday + 26 * 3600000)
      throw new Error('Activity outside labelled day')
    ids.add(r.id)
    const result: ActivityRecord = {
      id: r.id,
      sourceId: r.sourceId,
      deviceId: r.deviceId,
      kind: r.kind,
      state: r.state,
      start: r.start,
      end: r.end,
      app: r.app,
      title: r.title
    }
    for (const key of ['domain', 'projectName', 'browserProjectId'] as const) {
      if (r[key] !== undefined) {
        if (typeof r[key] !== 'string' || r[key]!.length > 500) throw new Error('Invalid activity context')
        result[key] = r[key]
      }
    }
    if (r.url !== undefined) result.url = cleanActivityUrl(r.url)
    return result
  })
  return {
    schemaVersion: 1,
    sourceId: data.sourceId,
    deviceId: data.deviceId,
    day: data.day,
    kind: data.kind,
    capturedAt: data.capturedAt,
    retentionDays: data.retentionDays,
    records,
    ...(data.tzOffsetMinutes !== undefined ? { tzOffsetMinutes: data.tzOffsetMinutes } : {}),
    ...(data.timezone !== undefined ? { timezone: data.timezone } : {})
  }
}
export function splitActivityRecord(record: ActivityRecord): Array<{ day: string; record: ActivityRecord }> {
  const result: Array<{ day: string; record: ActivityRecord }> = []
  let start = record.start
  while (start < record.end) {
    const end = Math.min(record.end, localDayBounds(start)[1])
    const day = localDateKey(start)
    result.push({ day, record: { ...record, id: `${record.id}_${day}`, start, end } })
    start = end
  }
  return result
}
export function isBrowserApp(app: string): boolean {
  return /^(chrome|msedge|firefox|brave|vivaldi|opera)(\.exe)?$/i.test(app)
}
export function unionMs(ranges: Array<{ start: number; end: number }>): number {
  let total = 0,
    end = -Infinity
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.end > range.start) {
      total += Math.max(0, range.end - Math.max(end, range.start))
      end = Math.max(end, range.end)
    }
  }
  return total
}
/** Browser observations enrich desktop browser time; they never add a second duration. */
export function activityReport(
  records: ActivityRecord[],
  manual: Array<{ start: number; end: number }> = []
): ActivityReport {
  const events = records
    .flatMap((r) => [
      { at: r.start, add: true, r },
      { at: r.end, add: false, r }
    ])
    .sort((a, b) => a.at - b.at || Number(a.add) - Number(b.add))
  const active = new Map<string, ActivityRecord>(),
    segments: ActivitySegment[] = []
  let previous: number | undefined
  for (const event of events) {
    if (previous !== undefined && event.at > previous && active.size) {
      const candidates = [...active.values()]
      const desktop = candidates
        .filter((r) => r.kind === 'desktop')
        .sort((a, b) => b.start - a.start || a.id.localeCompare(b.id))[0]
      const browser = candidates
        .filter((r) => r.kind === 'browser')
        .sort((a, b) => b.start - a.start || a.id.localeCompare(b.id))[0]
      // A desktop non-browser/idle observation takes precedence over a delayed browser checkpoint.
      const selected =
        desktop && (desktop.state !== 'active' || !isBrowserApp(desktop.app)) ? desktop : (browser ?? desktop)
      if (selected) {
        const evidenceIds = [...new Set([selected.id, ...(desktop && selected.kind === 'browser' ? [desktop.id] : [])])]
        const prior = segments.at(-1)
        if (
          prior &&
          prior.end === previous &&
          prior.record.id === selected.id &&
          prior.evidenceIds.join() === evidenceIds.join()
        )
          prior.end = event.at
        else segments.push({ start: previous, end: event.at, state: selected.state, record: selected, evidenceIds })
      }
    }
    if (event.add) active.set(event.r.id, event.r)
    else active.delete(event.r.id)
    previous = event.at
  }
  const ranges = segments.filter((s) => s.state === 'active')
  const activeMs = unionMs(ranges),
    manualMs = unionMs(manual)
  const groups = new Map<string, number>(),
    projects = new Map<string, number>()
  for (const s of ranges) {
    const label = s.record.kind === 'browser' ? (s.record.domain ?? s.record.app) : s.record.app
    groups.set(label, (groups.get(label) ?? 0) + s.end - s.start)
    const project = s.record.projectName ?? ''
    projects.set(project, (projects.get(project) ?? 0) + s.end - s.start)
  }
  const overlaps = ranges
    .flatMap((s) => manual.map((m) => ({ start: Math.max(s.start, m.start), end: Math.min(s.end, m.end) })))
    .filter((r) => r.end > r.start)
  return {
    segments,
    activeMs,
    idleMs: unionMs(segments.filter((s) => s.state !== 'active')),
    browserMs: unionMs(ranges.filter((s) => s.record.kind === 'browser')),
    manualMs,
    untrackedMs: Math.max(0, activeMs - unionMs(overlaps)),
    projects: [...projects].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms),
    groups: [...groups].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms)
  }
}
