// Envelope contract shared with the activity collector and Nested Tab Manager. Work Buddy itself no longer collects activity; the backend keeps accepting it for those producers.
import { localDateTimestamp } from '../src/shared/local-date'

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
