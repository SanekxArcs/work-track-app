import type { ActivityAssignment, ActivityDay, ActivityRecord } from './activity'
import { activityReport } from './activity'
import { localDateTimestamp, localDayBounds } from './local-date'
import type { AppSnapshot } from './types'
export interface ActivityRule {
  kind: 'app' | 'domain' | 'browserProject'
  pattern: string
  projectId: string
}
export function correctedActivity(
  records: ActivityRecord[],
  assignments: ActivityAssignment[],
  rules: ActivityRule[],
  projects: AppSnapshot['projects']
): ActivityRecord[] {
  const changes = new Map(assignments.map((a) => [a.recordId, a]))
  return records.flatMap((r) => {
    const change = changes.get(r.id)
    if (change?.excluded) return []
    const rule = rules.find((rule) =>
      rule.kind === 'browserProject'
        ? r.browserProjectId === rule.pattern
        : rule.kind === 'domain'
          ? r.domain === rule.pattern
          : r.kind === 'desktop' && r.app.toLowerCase() === rule.pattern
    )
    const projectId = change?.projectId ?? rule?.projectId
    const project = projects.find((p) => p.id === projectId)
    return [{ ...r, ...(project ? { projectName: project.name } : {}) }]
  })
}
export function activityReview(
  day: ActivityDay,
  snapshot: AppSnapshot,
  assignments: ActivityAssignment[],
  rules: ActivityRule[],
  now = Date.now()
) {
  const [start, end] = localDayBounds(localDateTimestamp(day.day))
  const records = correctedActivity(day.records, assignments, rules, snapshot.projects)
  const tasks = snapshot.tasks.flatMap((task) => {
    const intervals = task.intervals
      .map((i) => ({ start: Math.max(start, i.startedAt), end: Math.min(end, i.endedAt ?? now, now) }))
      .filter((i) => i.end > i.start)
    return intervals.length
      ? [
          {
            id: task.id,
            title: task.notes || task.title,
            project: snapshot.projects.find((p) => p.id === task.projectId)?.name ?? '',
            intervals
          }
        ]
      : []
  })
  const report = activityReport(
    records,
    tasks.flatMap((t) => t.intervals)
  )
  const evidence = report.segments
    .slice(0, 1500)
    .map((s, index) => ({
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
    through: now,
    report,
    tasks,
    evidence,
    omittedSegments: Math.max(0, report.segments.length - evidence.length)
  }
}
