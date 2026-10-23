import type { ActivityRange } from './activity-drafts'
export interface MatchingPeriod {
  id: string
  intervals: ActivityRange[]
  recordIds: string[]
  context: string[]
  currentProjectId: string | null
  evidence: Array<{
    ref: string
    recordId: string
    app: string
    title: string
    url?: string
    sourceId: string
    browserProjectId?: string
    note?: string
    domain?: string
  }>
}
export interface ActivityMatchingInput {
  day: string
  through: number
  dailyNote: string
  projects: Array<{ id: string; name: string }>
  periods: MatchingPeriod[]
  omittedPeriods: number
  manualTasks: Array<{
    id: string
    projectId: string | null
    description: string
    intervals: ActivityRange[]
  }>
}
export interface ActivityMatchProposal {
  periodId: string
  projectId: string | null
  reason: string
  evidenceRefs: string[]
  confidence: 'low' | 'medium' | 'high'
}
export interface ActivityMatchingResult {
  id: string
  generatedAt: number
  input: ActivityMatchingInput
  proposals: ActivityMatchProposal[]
}
export interface ActivityMatchDecision {
  periodId: string
  projectId: string
  intervals: ActivityRange[]
  acceptedAt: number
  recordChecks?: Array<{ id: string; start: number; end: number }>
}
export function validateActivityMatchProposals(
  raw: unknown,
  input: ActivityMatchingInput
): ActivityMatchProposal[] {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as { suggestions?: unknown }).suggestions)
  )
    throw new Error('AI returned an invalid matching response')
  const rows = (raw as { suggestions: ActivityMatchProposal[] }).suggestions
  if (rows.length > input.periods.length)
    throw new Error('AI returned too many project suggestions')
  const seen = new Set<string>()
  return rows.map((row) => {
    const period = input.periods.find((p) => p.id === row?.periodId)
    if (
      !period ||
      seen.has(row.periodId) ||
      !(
        row.projectId === null ||
        input.projects.some((p) => p.id === row.projectId)
      ) ||
      typeof row.reason !== 'string' ||
      !row.reason.trim() ||
      row.reason.length > 1000 ||
      !['low', 'medium', 'high'].includes(row.confidence) ||
      !Array.isArray(row.evidenceRefs) ||
      row.evidenceRefs.length > 10 ||
      row.evidenceRefs.some(
        (ref) =>
          typeof ref !== 'string' || !period.evidence.some((e) => e.ref === ref)
      ) ||
      (row.projectId !== null && !row.evidenceRefs.length)
    )
      throw new Error(
        'AI returned a project or evidence reference outside the reviewed data'
      )
    seen.add(row.periodId)
    return {
      periodId: row.periodId,
      projectId: row.projectId,
      reason: row.reason.trim(),
      confidence: row.confidence,
      evidenceRefs: [...new Set(row.evidenceRefs)]
    }
  })
}
