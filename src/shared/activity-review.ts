import type {
  ActivityAssignment,
  ActivityDay,
  ActivityRecord
} from './activity'
import { activityReport } from './activity'
import { localDateTimestamp, localDayBounds } from './local-date'
import type { AppSnapshot } from './types'
export type { ActivityRule } from './activity-learning'
import {
  resolveActivityProject,
  type ActivityRule,
  type ActivityProjectLink
} from './activity-learning'
export function correctedActivity(
  records: ActivityRecord[],
  assignments: ActivityAssignment[],
  rules: ActivityRule[],
  projects: AppSnapshot['projects'],
  links: ActivityProjectLink[] = []
): ActivityRecord[] {
  const changes = new Map(assignments.map((a) => [a.recordId, a]))
  return records.flatMap((r) => {
    const change = changes.get(r.id)
    if (change?.excluded) return []
    const { projectId } = resolveActivityProject(
      r,
      assignments,
      rules,
      projects,
      links
    )
    const project = projects.find((p) => p.id === projectId)
    return [{ ...r, ...(project ? { projectName: project.name } : {}) }]
  })
}
export function activityReview(
  day: ActivityDay,
  snapshot: AppSnapshot,
  assignments: ActivityAssignment[],
  rules: ActivityRule[],
  now = Date.now(),
  includeDecisions = true
) {
  const [start, end] = localDayBounds(localDateTimestamp(day.day))
  const records = correctedActivity(
    day.records,
    assignments,
    rules,
    snapshot.projects,
    day.projectLinks ?? []
  )
  const tasks = snapshot.tasks.flatMap((task) => {
    const intervals = task.intervals
      .map((i) => ({
        start: Math.max(start, i.startedAt),
        end: Math.min(end, i.endedAt ?? now, now)
      }))
      .filter((i) => i.end > i.start)
    return intervals.length
      ? [
          {
            id: task.id,
            title: task.notes || task.title,
            project:
              snapshot.projects.find((p) => p.id === task.projectId)?.name ??
              '',
            intervals
          }
        ]
      : []
  })
  const report = activityReport(
    records,
    tasks.flatMap((t) => t.intervals)
  )
  if (includeDecisions && day.matchDecisions?.length) {
    const decisions = day.matchDecisions.filter(
      (d) =>
        d.recordChecks?.length &&
        d.recordChecks.every((c) =>
          day.records.some(
            (r) => r.id === c.id && r.start === c.start && r.end === c.end
          )
        ) &&
        snapshot.projects.some((p) => p.id === d.projectId && !p.archived)
    )
    report.segments = report.segments.flatMap((segment) => {
      if (
        segment.state !== 'active' ||
        ['correction', 'link', 'rule'].includes(
          resolveActivityProject(
            segment.record,
            assignments,
            rules,
            snapshot.projects,
            day.projectLinks
          ).match
        )
      )
        return [segment]
      const relevant = decisions.filter((d) =>
        d.recordChecks!.some((c) => segment.evidenceIds.includes(c.id))
      )
      const boundaries = [
        ...new Set([
          segment.start,
          segment.end,
          ...relevant
            .flatMap((d) => d.intervals.flatMap((i) => [i.start, i.end]))
            .filter((t) => t > segment.start && t < segment.end)
        ])
      ].sort((a, b) => a - b)
      return boundaries.slice(0, -1).map((start, i) => {
        const end = boundaries[i + 1],
          decision = relevant.find((d) =>
            d.intervals.some((r) => r.start <= start && r.end >= end)
          )
        return {
          ...segment,
          start,
          end,
          ...(decision
            ? {
                record: {
                  ...segment.record,
                  projectName: snapshot.projects.find(
                    (p) => p.id === decision.projectId
                  )!.name
                }
              }
            : {})
        }
      })
    })
    const totals = new Map<string, number>()
    for (const s of report.segments.filter((s) => s.state === 'active'))
      totals.set(
        s.record.projectName ?? '',
        (totals.get(s.record.projectName ?? '') ?? 0) + s.end - s.start
      )
    report.projects = [...totals]
      .map(([label, ms]) => ({ label, ms }))
      .sort((a, b) => b.ms - a.ms)
  }
  const evidence = report.segments.slice(0, 1500).map((s, index) => ({
    ref: `E${index + 1}`,
    recordIds: s.evidenceIds,
    start: s.start,
    end: s.end,
    state: s.state,
    app: s.record.app,
    title: s.record.title,
    url: s.record.url,
    project: s.record.projectName ?? '',
    note: assignments.find((a) => a.recordId === s.record.id)?.note ?? ''
  }))
  return {
    day: day.day,
    through: Math.min(
      now,
      Math.max(
        start,
        ...report.segments.map((s) => s.end),
        ...tasks.flatMap((t) => t.intervals.map((i) => i.end))
      )
    ),
    dailyNote: day.dailyNote ?? '',
    report,
    tasks,
    evidence,
    omittedSegments: Math.max(0, report.segments.length - evidence.length)
  }
}
