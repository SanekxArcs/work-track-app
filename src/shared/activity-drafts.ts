import {
  resolveActivityProject,
  type ActivityMatchKind
} from './activity-learning'
import type { ActivityDay, ActivityRecord } from './activity'
import { activityReview, type ActivityRule } from './activity-review'
import { localDayBounds, localDateTimestamp } from './local-date'
import type { AppSnapshot } from './types'

export interface ActivityRange {
  start: number
  end: number
}
export interface ActivitySuggestion {
  id: string
  day: string
  intervals: ActivityRange[]
  recordIds: string[]
  projectId: string | null
  projectLabel: string
  match: ActivityMatchKind
  context: string[]
}
export interface ActivityDraft {
  suggestionIds: string[]
  intervals: ActivityRange[]
  projectId: string | null
  notes: string
}
export interface ActivityTaskImport {
  key: string
  intervals: ActivityRange[]
  projectId: string | null
  notes: string
}
export function normalizeActivityRanges(
  ranges: ActivityRange[]
): ActivityRange[] {
  const result: ActivityRange[] = []
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.end <= range.start
    )
      throw new Error('Invalid activity range')
    const prior = result.at(-1)
    if (prior && prior.end >= range.start)
      prior.end = Math.max(prior.end, range.end)
    else result.push({ ...range })
  }
  return result
}
export function subtractActivityRanges(
  source: ActivityRange[],
  covered: ActivityRange[]
): ActivityRange[] {
  const cover = normalizeActivityRanges(covered),
    result: ActivityRange[] = []
  for (const range of normalizeActivityRanges(source)) {
    let start = range.start
    for (const block of cover) {
      if (block.end <= start) continue
      if (block.start >= range.end) break
      if (block.start > start)
        result.push({ start, end: Math.min(block.start, range.end) })
      start = Math.max(start, block.end)
      if (start >= range.end) break
    }
    if (start < range.end) result.push({ start, end: range.end })
  }
  return result
}
export function activityProjectMatch(
  record: ActivityRecord,
  day: ActivityDay,
  projects: AppSnapshot['projects']
): { projectId: string | null; match: ActivitySuggestion['match'] } {
  return resolveActivityProject(
    record,
    day.assignments,
    day.rules,
    projects,
    day.projectLinks ?? []
  )
}
export function activitySuggestions(
  day: ActivityDay,
  snapshot: AppSnapshot,
  minimumMs = 60000,
  now = Date.now()
): ActivitySuggestion[] {
  const review = activityReview(
    day,
    snapshot,
    day.assignments,
    day.rules,
    now,
    false
  )
  const [dayStart, dayEnd] = localDayBounds(localDateTimestamp(day.day))
  const rest = snapshot.rests
    .flatMap((r) =>
      r.intervals.map((i) => ({
        start: Math.max(dayStart, i.startedAt),
        end: Math.min(dayEnd, i.endedAt ?? now, now)
      }))
    )
    .filter((i) => i.end > i.start)
  const covered = [...review.tasks.flatMap((t) => t.intervals), ...rest]
  const result: Array<ActivitySuggestion & { group: string }> = []
  for (const segment of review.report.segments) {
    if (segment.state !== 'active') continue
    const intervals = subtractActivityRanges(
      [
        {
          start: Math.max(dayStart, segment.start),
          end: Math.min(segment.end, dayEnd, now)
        }
      ].filter((r) => r.end > r.start),
      covered
    )
    if (!intervals.length) continue
    const match = activityProjectMatch(segment.record, day, snapshot.projects),
      project = snapshot.projects.find((p) => p.id === match.projectId)
    const label = segment.record.domain || segment.record.app,
      group =
        match.projectId ??
        JSON.stringify([
          segment.record.browserProjectId ?? '',
          segment.record.projectName ?? '',
          label.toLowerCase()
        ])
    const prior = result.at(-1),
      gap = prior ? intervals[0].start - prior.intervals.at(-1)!.end : Infinity
    if (prior && prior.group === group && gap >= 0 && gap <= 60000) {
      prior.intervals = normalizeActivityRanges([
        ...prior.intervals,
        ...intervals
      ])
      prior.recordIds = [
        ...new Set([...prior.recordIds, ...segment.evidenceIds])
      ]
      if (!prior.context.includes(label)) prior.context.push(label)
      const strength = {
        correction: 0,
        confirmed: 0,
        link: 0,
        rule: 1,
        name: 2,
        unassigned: 3,
        conflict: 4
      }
      if (strength[match.match] > strength[prior.match])
        prior.match = match.match
    } else
      result.push({
        id: '',
        day: day.day,
        intervals,
        recordIds: [...segment.evidenceIds],
        projectId: match.projectId,
        projectLabel: project?.name ?? segment.record.projectName ?? '',
        match: match.match,
        context: [label],
        group
      })
  }
  return result
    .filter(
      (s) =>
        s.intervals.reduce((sum, r) => sum + r.end - r.start, 0) >= minimumMs
    )
    .map(({ group, ...s }) => {
      const id = JSON.stringify([
        s.day,
        s.projectId,
        s.recordIds,
        s.intervals[0].start
      ])
      const decision = day.matchDecisions?.find(
        (d) =>
          d.periodId === id &&
          JSON.stringify(d.intervals) === JSON.stringify(s.intervals) &&
          snapshot.projects.some((p) => p.id === d.projectId && !p.archived)
      )
      return {
        ...s,
        id,
        ...(decision
          ? {
              projectId: decision.projectId,
              projectLabel: snapshot.projects.find(
                (p) => p.id === decision.projectId
              )!.name,
              match: 'confirmed' as const
            }
          : {})
      }
    })
}
export function draftFromSuggestions(
  suggestions: ActivitySuggestion[]
): ActivityDraft {
  if (!suggestions.length) throw new Error('Select activity to review')
  if (new Set(suggestions.map((s) => s.day)).size !== 1)
    throw new Error('Choose activity from one day')
  const projects = new Set(suggestions.map((s) => s.projectId))
  return {
    suggestionIds: suggestions.map((s) => s.id),
    intervals: normalizeActivityRanges(suggestions.flatMap((s) => s.intervals)),
    projectId: projects.size === 1 ? suggestions[0].projectId : null,
    notes: ''
  }
}
export function splitActivityDraft(
  draft: ActivityDraft,
  at: number
): [ActivityDraft, ActivityDraft] {
  if (!Number.isSafeInteger(at)) throw new Error('Choose a split time')
  const first = draft.intervals.flatMap((r) =>
    r.start < at ? [{ start: r.start, end: Math.min(r.end, at) }] : []
  )
  const second = draft.intervals.flatMap((r) =>
    r.end > at ? [{ start: Math.max(r.start, at), end: r.end }] : []
  )
  if (!first.length || !second.length)
    throw new Error('Both parts must contain observed activity')
  return [
    { ...draft, intervals: first },
    { ...draft, intervals: second }
  ]
}
export function trimActivityDraft(
  draft: ActivityDraft,
  start: number,
  end: number
): ActivityDraft {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= end ||
    start < draft.intervals[0].start ||
    end > draft.intervals.at(-1)!.end
  )
    throw new Error('Trim within the observed period')
  const intervals = draft.intervals
    .map((r) => ({
      start: Math.max(r.start, start),
      end: Math.min(r.end, end)
    }))
    .filter((r) => r.end > r.start)
  if (!intervals.length)
    throw new Error('The draft must contain observed activity')
  return { ...draft, intervals }
}
export function mergeActivityDrafts(drafts: ActivityDraft[]): ActivityDraft {
  if (!drafts.length) throw new Error('Choose drafts to merge')
  const projects = new Set(drafts.map((d) => d.projectId))
  return {
    suggestionIds: [...new Set(drafts.flatMap((d) => d.suggestionIds))],
    intervals: normalizeActivityRanges(drafts.flatMap((d) => d.intervals)),
    projectId: projects.size === 1 ? drafts[0].projectId : null,
    notes: [...new Set(drafts.map((d) => d.notes.trim()).filter(Boolean))].join(
      '\n\n'
    )
  }
}
export function validateActivityDrafts(
  day: string,
  drafts: ActivityDraft[],
  suggestions: ActivitySuggestion[],
  projects: AppSnapshot['projects'],
  now = Date.now()
): void {
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > 50)
    throw new Error('Review between 1 and 50 work entries')
  const [start, end] = localDayBounds(localDateTimestamp(day)),
    all: ActivityRange[] = []
  for (const draft of drafts) {
    if (
      !draft ||
      !Array.isArray(draft.suggestionIds) ||
      !draft.suggestionIds.length ||
      draft.suggestionIds.length > 200 ||
      !Array.isArray(draft.intervals) ||
      !draft.intervals.length ||
      draft.intervals.length > 2000 ||
      typeof draft.notes !== 'string' ||
      !draft.notes.trim() ||
      draft.notes.length > 2000 ||
      !(
        draft.projectId === null ||
        projects.some((p) => p.id === draft.projectId && !p.archived)
      )
    )
      throw new Error('Choose a project and enter a work description')
    const sources = draft.suggestionIds.map((id) =>
      suggestions.find((s) => s.id === id)
    )
    if (sources.some((s) => !s))
      throw new Error(
        'Activity or tracked time changed. Refresh and review the suggestions again.'
      )
    const ranges = normalizeActivityRanges(draft.intervals)
    if (
      ranges.some((r) => r.start < start || r.end > end || r.end > now) ||
      subtractActivityRanges(
        ranges,
        sources.flatMap((s) => s!.intervals)
      ).length
    )
      throw new Error('Work time must stay within the reviewed observations')
    all.push(...ranges)
  }
  const total = all.reduce((sum, r) => sum + r.end - r.start, 0),
    union = normalizeActivityRanges(all).reduce(
      (sum, r) => sum + r.end - r.start,
      0
    )
  if (total !== union)
    throw new Error('Reviewed work entries overlap each other')
}
