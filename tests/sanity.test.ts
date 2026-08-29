import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkBuddyDatabase } from '../src/main/database.ts'
import { SanityService, shouldRestoreCloudBackup } from '../src/main/sanity.ts'
import type { BackupData } from '../src/shared/types.ts'

function emptyBackup(): BackupData {
  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    settings: {
      locale: 'uk', theme: 'dark', alwaysOnTop: true, autoStart: true,
      workday: { startReminder: true, startTime: '09:00', endReminder: true, endTime: '18:00' },
      breaks: { enabled: true, everyMinutes: 55, durationMinutes: 5 },
      lunch: { enabled: true, mode: 'worked', time: '13:00', afterMinutes: 240, durationMinutes: 30, includedInWorkHours: false },
      idle: { enabled: true, thresholdMinutes: 10 },
      notifications: { sound: 'soft', volume: 0.7, customSoundPath: '', customSoundName: '' },
      wellnessEnabled: true, wellnessActions: [], projectColors: []
    },
    projects: [], plannedTasks: [], tasks: [], workdays: [], rests: [], overtimeRedeemedDates: []
  }
}

test('restores cloud history only into a genuinely fresh local workspace', () => {
  const backup = emptyBackup()
  assert.equal(shouldRestoreCloudBackup(backup), true)
  backup.projects.push({ id: 'project', name: 'Local project', color: '#ffffff', archived: false, createdAt: Date.now() })
  assert.equal(shouldRestoreCloudBackup(backup), false)
})

test('does not run a pending web command twice when its first status update fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  const originalFetch = globalThis.fetch
  let statusCalls = 0
  const mutationBodies: Array<{ mutations?: Array<{ patch?: { set?: { status?: string } } }> }> = []
  const command = { _id: 'command-start-task', createdAt: new Date().toISOString(), command: 'start-task', mode: 'parallel' }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('data/query')) return Response.json({ result: [command] })
    if (url.includes('data/mutate')) {
      mutationBodies.push(JSON.parse(String(init?.body ?? '{}')))
      statusCalls += 1
      if (statusCalls === 1) return Response.json({ error: { message: 'Temporary failure' } }, { status: 500 })
      return Response.json({ results: [] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    const sanity = new SanityService(database, () => 'token')
    await sanity.processPendingCommands()
    assert.equal(database.getSnapshot().tasks.length, 1)
    assert.equal(mutationBodies.some((body) => body.mutations?.some((mutation) => mutation.patch?.set?.status === 'failed')), false)

    await sanity.processPendingCommands()
    assert.equal(database.getSnapshot().tasks.length, 1)
    assert.equal(database.hasProcessedRemoteCommand(command._id), true)
  } finally {
    globalThis.fetch = originalFetch
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('rejects a stale remote command instead of starting a new timer later', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  const originalFetch = globalThis.fetch
  const mutationBodies: Array<{ mutations?: Array<{ patch?: { set?: { status?: string; error?: string } } }> }> = []
  const command = { _id: 'stale-start-task', createdAt: new Date(Date.now() - 11 * 60_000).toISOString(), command: 'start-task', mode: 'parallel' }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('data/query')) return Response.json({ result: [command] })
    if (url.includes('data/mutate')) {
      mutationBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return Response.json({ results: [] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    const sanity = new SanityService(database, () => 'token')
    assert.equal(await sanity.processPendingCommands(), false)
    assert.equal(database.getSnapshot().tasks.length, 0)
    assert.equal(mutationBodies.some((body) => body.mutations?.some((mutation) => mutation.patch?.set?.status === 'failed' && /expired/i.test(mutation.patch?.set?.error ?? ''))), true)
  } finally {
    globalThis.fetch = originalFetch
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})
