import { createHash } from 'node:crypto'
import {
  activitySuggestions,
  normalizeActivityRanges,
  validateActivityDrafts,
  type ActivityDraft
} from '../shared/activity-drafts'
import type { ActivityService } from './activity'
import type { WorkBuddyDatabase } from './database'
import { validActivityDay } from '../shared/activity'

export function acceptActivityDrafts(
  activity: ActivityService,
  database: WorkBuddyDatabase,
  input: { day: string; drafts: ActivityDraft[] }
) {
  if (
    !input ||
    !validActivityDay(input.day) ||
    !Array.isArray(input.drafts) ||
    !input.drafts.length ||
    input.drafts.length > 50
  )
    throw new Error('Invalid reviewed activity request')
  const data = activity.day(input.day),
    snapshot = database.getDaySnapshot(input.day)
  const suggestions = activitySuggestions(data, snapshot, 0)
  const entries = input.drafts.map((draft) => {
    if (
      !draft ||
      !Array.isArray(draft.suggestionIds) ||
      draft.suggestionIds.length > 200 ||
      draft.suggestionIds.some((id) => typeof id !== 'string' || id.length > 30000) ||
      !Array.isArray(draft.intervals) ||
      draft.intervals.length > 2000
    )
      throw new Error('Invalid reviewed activity draft')
    const key = createHash('sha256')
      .update(
        JSON.stringify([input.day, [...new Set(draft.suggestionIds)].sort(), normalizeActivityRanges(draft.intervals)])
      )
      .digest('hex')
    return { key, projectId: draft.projectId, notes: draft.notes, intervals: draft.intervals }
  })
  const pending = input.drafts.filter((_, index) => !database.hasActivityImport(entries[index].key))
  if (pending.length) validateActivityDrafts(input.day, pending, suggestions, snapshot.projects)
  const result = database.recordActivityTasks(input.day, entries)
  if (result.created) activity.invalidateReview(input.day)
  return result
}
