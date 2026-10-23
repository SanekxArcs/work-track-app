import assert from 'node:assert/strict'
import test from 'node:test'
import { ActivityStore } from '../src/main/activity-store.ts'
import { ActivityService } from '../src/main/activity.ts'
import { ActivityLearningService } from '../src/main/activity-learning.ts'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import type { GeminiService } from '../src/main/gemini.ts'
import { resolveActivityProject } from '../src/shared/activity-learning.ts'
import { activityReview } from '../src/shared/activity-review.ts'
import { activitySuggestions } from '../src/shared/activity-drafts.ts'
import {
  validateActivityMatchProposals,
  type ActivityMatchingInput
} from '../src/shared/activity-matching.ts'
import { localDateKey } from '../src/shared/local-date.ts'
const base = Date.now() - 7200000,
  day = localDateKey(base)
const record = {
  id: 'row',
  sourceId: 'browser',
  deviceId: 'pc',
  kind: 'browser' as const,
  state: 'active' as const,
  start: base,
  end: base + 600000,
  app: 'chrome.exe',
  title: 'Client docs',
  domain: 'docs.example.com',
  browserProjectId: 'folder'
}
test('stable links are profile scoped, override names, and survive renames; conflicting rules remain ambiguous', () => {
  const projects = [
    { id: 'p', name: 'Renamed', color: '#fff', archived: false, createdAt: 0 },
    { id: 'q', name: 'Other', color: '#000', archived: false, createdAt: 0 }
  ]
  const link = {
    browserSourceId: 'browser',
    browserProjectId: 'folder',
    projectId: 'p',
    revision: 1
  }
  assert.deepEqual(resolveActivityProject(record, [], [], projects, [link]), {
    projectId: 'p',
    match: 'link'
  })
  assert.equal(
    resolveActivityProject(
      { ...record, sourceId: 'other-profile' },
      [],
      [],
      projects,
      [link]
    ).projectId,
    null
  )
  const rules = [
    { kind: 'domain' as const, pattern: 'example.com', projectId: 'p' },
    { kind: 'domain' as const, pattern: 'example.com', projectId: 'q' }
  ]
  assert.equal(
    resolveActivityProject(record, [], rules, projects).match,
    'conflict'
  )
  rules[1] = { ...rules[1], enabled: false } as (typeof rules)[1]
  assert.equal(
    resolveActivityProject(record, [], rules, projects).projectId,
    'p'
  )
  assert.equal(
    resolveActivityProject(
      record,
      [],
      [
        {
          kind: 'windowTitle',
          pattern: 'client',
          app: 'code.exe',
          projectId: 'q'
        }
      ],
      projects
    ).projectId,
    null
  )
  assert.equal(
    resolveActivityProject(
      record,
      [],
      [
        {
          kind: 'windowTitle',
          pattern: 'CLIENT',
          app: 'chrome.exe',
          projectId: 'q'
        }
      ],
      projects
    ).projectId,
    'q'
  )
})
test('AI matching is previewed, evidence validated, confirmed per period, and invalidated when observations change', async () => {
  const store = new ActivityStore(':memory:', 'desktop'),
    db = new WorkBuddyDatabase(':memory:')
  const activity = new ActivityService(
    store,
    { encrypt: (s) => s, decrypt: (s) => s },
    () => 0,
    fetch,
    { start() {}, stop() {} }
  )
  db.createProject({ name: 'Client', color: '#ffffff' })
  const project = db.getSnapshot().projects[0]
  assert.ok(project)
  store.set('config', { ...store.config(), deviceId: 'pc' })
  store.put(day, record)
  store.put(day, {
    ...record,
    id: 'second',
    start: base + 1200000,
    end: base + 1800000,
    app: 'Other.exe',
    domain: undefined,
    browserProjectId: undefined
  })
  let calls = 0
  const ai = {
    matchActivity: async (input: ActivityMatchingInput) => {
      calls++
      return {
        suggestions: input.periods.map((p) => ({
          periodId: p.id,
          projectId: project.id,
          reason: 'Observed evidence',
          evidenceRefs: [p.evidence[0].ref],
          confidence: 'medium'
        }))
      }
    }
  } as unknown as GeminiService
  const learning = new ActivityLearningService(activity, db, ai)
  try {
    const preview = (await learning.run('preview', { day })).preview!
    assert.equal(calls, 0)
    const matching = (await learning.run('generate', { day, id: preview.id }))
      .matching!
    assert.equal(calls, 1)
    assert.equal(db.getDaySnapshot(day).tasks.length, 0)
    assert.throws(() =>
      validateActivityMatchProposals(
        { suggestions: [{ ...matching.proposals[0], evidenceRefs: ['fake'] }] },
        matching.input
      )
    )
    for (const p of matching.proposals)
      await learning.run('confirm', {
        day,
        resultId: matching.id,
        periodId: p.periodId,
        projectId: project.id
      })
    assert.ok(
      activitySuggestions(activity.day(day), db.getDaySnapshot(day)).every(
        (s) => s.match === 'confirmed'
      )
    )
    assert.equal(
      db.getDaySnapshot(day).tasks.length,
      0,
      'Confirming a project must not record work'
    )
    assert.equal(
      activityReview(
        activity.day(day),
        db.getDaySnapshot(day),
        [],
        []
      ).report.projects.find((p) => p.label === 'Client')?.ms,
      1200000
    )
    store.put(day, { ...record, end: record.end + 60000 })
    assert.equal(
      activitySuggestions(activity.day(day), db.getDaySnapshot(day))[0].match,
      'unassigned',
      'Growing records cannot silently expand a confirmed scope'
    )
    await learning.run('note', { day, note: 'A manual outcome' })
    await learning.run('complete', { day })
    assert.equal(learning.day(day).reviewStatus?.current, true)
    assert.equal(
      learning.day(day).reviewStatus?.current,
      true,
      'A repeated read must not make a review stale'
    )
    store.put(day, { ...record, end: record.end + 120000 })
    assert.equal(learning.day(day).reviewStatus?.current, false)
    const next = (await learning.run('preview', { day })).preview!
    activity.configure({ ...store.config(), captureTitles: true })
    await assert.rejects(
      () => learning.run('generate', { day, id: next.id }),
      /expired/
    )
    assert.equal(calls, 1)
  } finally {
    activity.stop()
    store.close()
    db.close()
  }
})
test('rules support individual update, disable and deletion while preserving legacy rules', () => {
  const store = new ActivityStore(':memory:', 'desktop'),
    activity = new ActivityService(
      store,
      { encrypt: (s) => s, decrypt: (s) => s },
      () => 0,
      fetch,
      { start() {}, stop() {} }
    )
  try {
    store.set('rules', [{ kind: 'app', pattern: 'code.exe', projectId: 'p' }])
    const legacy = activity.rules()[0]
    assert.ok(legacy.id)
    activity.saveRule({ ...legacy, enabled: false })
    assert.equal(activity.rules().length, 1)
    assert.equal(activity.rules()[0].enabled, false)
    activity.saveRule({
      kind: 'windowTitle',
      pattern: 'Client',
      projectId: 'q',
      app: 'code.exe'
    })
    activity.deleteRule(legacy.id!)
    assert.equal(activity.rules()[0].kind, 'windowTitle')
    assert.throws(() =>
      activity.saveRule({
        kind: 'domain',
        pattern: 'https://example.com/path',
        projectId: 'p'
      })
    )
  } finally {
    store.close()
  }
})
