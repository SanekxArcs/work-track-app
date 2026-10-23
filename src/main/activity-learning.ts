import { createHash, randomUUID } from 'node:crypto'
import { activitySuggestions } from '../shared/activity-drafts'
import { activityReview } from '../shared/activity-review'
import { validActivityDay, type ActivityDay } from '../shared/activity'
import {
  validateActivityMatchProposals,
  type ActivityMatchingInput,
  type ActivityMatchingResult,
  type ActivityMatchDecision
} from '../shared/activity-matching'
import type {
  ActivityRule,
  ProjectLinkChange
} from '../shared/activity-learning'
import type { ActivityService } from './activity'
import type { WorkBuddyDatabase } from './database'
import type { GeminiService } from './gemini'
export class ActivityLearningService {
  private previews = new Map<
    string,
    { input: ActivityMatchingInput; epoch: number; expires: number }
  >()
  constructor(
    private activity: ActivityService,
    private db: WorkBuddyDatabase,
    private ai: GeminiService
  ) {}
  private fingerprint(day: string): string {
    const data = this.activity.day(day),
      snapshot = this.db.getDaySnapshot(day)
    return createHash('sha256')
      .update(
        JSON.stringify({
          records: [...data.records].sort((a, b) => a.id.localeCompare(b.id)),
          assignments: data.assignments,
          rules: data.rules,
          links: data.projectLinks,
          decisions: data.matchDecisions,
          note: data.dailyNote,
          tasks: snapshot.tasks,
          rests: snapshot.rests,
          projects: snapshot.projects
        })
      )
      .digest('hex')
  }
  day(day: string): ActivityDay {
    const data = this.activity.day(day),
      saved = this.activity.store.get<{ at: number; hash: string }>(
        'review:' + day
      )
    return {
      ...data,
      reviewStatus: {
        reviewedAt: saved?.at ?? null,
        current: !!saved && saved.hash === this.fingerprint(day)
      }
    }
  }
  private input(day: string): ActivityMatchingInput {
    const data = this.activity.day(day),
      snapshot = this.db.getDaySnapshot(day),
      review = activityReview(data, snapshot, data.assignments, data.rules)
    const candidates = activitySuggestions(data, snapshot).filter(
      (s) =>
        ['name', 'unassigned', 'conflict'].includes(s.match) &&
        s.intervals.at(-1)!.end < Date.now() - 30000
    )
    return {
      day,
      through: review.through,
      dailyNote: data.dailyNote ?? '',
      projects: snapshot.projects
        .filter((p) => !p.archived)
        .map(({ id, name }) => ({ id, name })),
      periods: candidates.slice(0, 60).map((s, i) => ({
        id: s.id,
        intervals: s.intervals,
        recordIds: s.recordIds,
        context: s.context,
        currentProjectId: s.projectId,
        evidence: data.records
          .filter((r) => s.recordIds.includes(r.id))
          .slice(0, 10)
          .map((r, j) => ({
            ref: `P${i + 1}E${j + 1}`,
            recordId: r.id,
            app: r.app,
            title: r.title,
            url: r.url,
            sourceId: r.sourceId,
            browserProjectId: r.browserProjectId,
            domain: r.domain,
            note: data.assignments.find((a) => a.recordId === r.id)?.note ?? ''
          }))
      })),
      omittedPeriods: Math.max(0, candidates.length - 60),
      manualTasks: review.tasks.map((t) => ({
        id: t.id,
        projectId: snapshot.tasks.find((v) => v.id === t.id)?.projectId ?? null,
        description: t.title,
        intervals: t.intervals
      }))
    }
  }
  async run(
    action: string,
    raw: unknown
  ): Promise<import('../shared/activity-learning').ActivityLearningResponse> {
    const value = (raw && typeof raw === 'object' ? raw : {}) as Record<
      string,
      unknown
    >
    if (action === 'projects')
      return { registry: await this.activity.refreshProjects() }
    if (action === 'link') {
      return {
        registry: await this.activity.linkProject(raw as ProjectLinkChange)
      }
    }
    if (action === 'saveRule') {
      if (
        !this.db
          .getSnapshot()
          .projects.some((p) => p.id === value?.projectId && !p.archived)
      )
        throw new Error('Choose an active project')
      this.activity.saveRule(raw as ActivityRule)
      return {}
    }
    if (action === 'deleteRule') {
      if (typeof value?.id !== 'string') throw new Error('Invalid rule')
      this.activity.deleteRule(value.id)
      return {}
    }
    const day = value?.day
    if (!validActivityDay(day)) throw new Error('Invalid review day')
    if (action === 'note') {
      if (typeof value.note !== 'string' || value.note.length > 4000)
        throw new Error('Keep the daily note under 4000 characters')
      this.activity.store.set('note:' + day, value.note.trim())
      this.activity.store.clearMatching(day)
      this.activity.invalidateReview(day)
      return { data: this.day(day) }
    }
    if (action === 'complete') {
      this.activity.store.set('review:' + day, {
        at: Date.now(),
        hash: this.fingerprint(day)
      })
      return { data: this.day(day) }
    }
    if (action === 'preview') {
      const input = this.input(day)
      if (!input.periods.length)
        throw new Error(
          'No settled ambiguous periods to match. Recent active activity becomes available after 30 seconds.'
        )
      const id = randomUUID()
      this.previews.clear()
      this.previews.set(id, {
        input,
        epoch: this.activity.privacyEpoch,
        expires: Date.now() + 300000
      })
      return { preview: { id, input } }
    }
    if (action === 'generate') {
      if (typeof value.id !== 'string') throw new Error('Invalid preview')
      const preview = this.previews.get(value.id)
      this.previews.delete(value.id)
      if (
        !preview ||
        preview.expires < Date.now() ||
        preview.epoch !== this.activity.privacyEpoch ||
        preview.input.day !== day
      )
        throw new Error('Preview expired. Review the input again.')
      const rawResult = await this.ai.matchActivity(preview.input)
      if (preview.epoch !== this.activity.privacyEpoch)
        throw new Error('Activity settings changed. Preview again.')
      const matching: ActivityMatchingResult = {
        id: randomUUID(),
        input: preview.input,
        generatedAt: Date.now(),
        proposals: validateActivityMatchProposals(rawResult, preview.input)
      }
      this.activity.store.set('matching:' + day, matching)
      return { matching }
    }
    if (action === 'confirm') {
      const result = this.activity.day(day).matching,
        proposal = result?.proposals.find((p) => p.periodId === value.periodId)
      const original = result?.input.periods.find(
        (p) => p.id === value.periodId
      )
      if (!result || result.id !== value.resultId || !proposal || !original)
        throw new Error('Suggestion is no longer available')
      const current = this.input(day).periods.find(
        (p) => p.id === value.periodId
      )
      const comparable = (p: typeof original) =>
        p &&
        JSON.stringify({ ...p, evidence: p.evidence.map(({ ref, ...e }) => e) })
      if (!current || comparable(current) !== comparable(original))
        throw new Error(
          'This period changed. Generate a fresh matching review.'
        )
      const project = this.db
        .getSnapshot()
        .projects.find((p) => p.id === value.projectId && !p.archived)
      if (!project) throw new Error('Choose an active project')
      const decisions =
        this.activity.store.get<ActivityMatchDecision[]>('decisions:' + day) ??
        []
      this.activity.store.set('decisions:' + day, [
        ...decisions.filter((d) => d.periodId !== current.id),
        {
          periodId: current.id,
          projectId: project.id,
          intervals: current.intervals,
          acceptedAt: Date.now(),
          recordChecks: this.activity
            .day(day)
            .records.filter((r) => current.recordIds.includes(r.id))
            .map(({ id, start, end }) => ({ id, start, end }))
        }
      ])
      this.activity.invalidateReview(day)
      return { data: this.day(day) }
    }
    throw new Error('Unknown review action')
  }
}
