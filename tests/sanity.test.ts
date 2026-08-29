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

test('sync merges cloud-only history into an existing local workspace before publishing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  database.createProject({ name: 'Local project', color: '#ffffff' })
  const remote = emptyBackup()
  remote.projects.push({ id: 'remote-project', name: 'Remote project', color: '#000000', archived: false, createdAt: Date.now() - 1 })
  const originalFetch = globalThis.fetch
  let published: BackupData | undefined
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('data/query')) return Response.json({ result: { payload: remote, _rev: 'remote-revision' } })
    if (url.includes('data/mutate')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ patch?: { set?: { payload?: BackupData } } }> }
      published = body.mutations?.[0]?.patch?.set?.payload
      return Response.json({ results: [] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    const sanity = new SanityService(database, () => 'token')
    const result = await sanity.sync()
    assert.equal(result.merged, true)
    assert.deepEqual(database.exportBackup().projects.map((project) => project.name).sort(), ['Local project', 'Remote project'])
    assert.deepEqual(published?.projects.map((project) => project.name).sort(), ['Local project', 'Remote project'])
  } finally {
    globalThis.fetch = originalFetch
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('sync retries after a cloud revision conflict without losing either desktop addition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  database.createProject({ name: 'Local project', color: '#ffffff' })
  const firstRemote = emptyBackup()
  firstRemote.projects.push({ id: 'first-remote-project', name: 'First remote project', color: '#000000', archived: false, createdAt: Date.now() - 2 })
  const secondRemote = structuredClone(firstRemote)
  secondRemote.projects.push({ id: 'second-remote-project', name: 'Second remote project', color: '#123456', archived: false, createdAt: Date.now() - 1 })
  const originalFetch = globalThis.fetch
  let reads = 0
  let writes = 0
  let published: BackupData | undefined
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('data/query')) {
      reads += 1
      return Response.json({ result: { payload: reads === 1 ? firstRemote : secondRemote, _rev: reads === 1 ? 'first-revision' : 'second-revision' } })
    }
    if (url.includes('data/mutate')) {
      writes += 1
      if (writes === 1) return Response.json({ error: { message: 'Revision mismatch' } }, { status: 409 })
      const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ patch?: { set?: { payload?: BackupData } } }> }
      published = body.mutations?.[0]?.patch?.set?.payload
      return Response.json({ results: [] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    const sanity = new SanityService(database, () => 'token')
    await sanity.sync()
    assert.equal(reads, 2)
    assert.equal(writes, 2)
    assert.deepEqual(published?.projects.map((project) => project.name).sort(), ['First remote project', 'Local project', 'Second remote project'])
  } finally {
    globalThis.fetch = originalFetch
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
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

test('rejects a remote command dated implausibly far in the future', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  const originalFetch = globalThis.fetch
  const mutationBodies: Array<{ mutations?: Array<{ patch?: { set?: { status?: string; error?: string } } }> }> = []
  const command = { _id: 'future-start-task', createdAt: new Date(Date.now() + 3 * 60_000).toISOString(), command: 'start-task', mode: 'parallel' }
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

test('does not let a delayed remote resume restart a stopped task or pause other work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  const stopped = database.startTask({ mode: 'parallel', notes: 'Finished task' }).tasks[0]
  database.stopTask(stopped.id)
  const running = database.startTask({ mode: 'parallel', notes: 'Current task' }).tasks.find((task) => task.id !== stopped.id)
  assert.ok(running)
  const originalFetch = globalThis.fetch
  const command = { _id: 'stale-resume', createdAt: new Date().toISOString(), command: 'resume-task', taskId: stopped.id, mode: 'switch' }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('data/query')) return Response.json({ result: [command] })
    if (url.includes('data/mutate')) return Response.json({ results: [] })
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    const sanity = new SanityService(database, () => 'token')
    assert.equal(await sanity.processPendingCommands(), false)
    assert.equal(database.getSnapshot().tasks.find((task) => task.id === running.id)?.status, 'running')
    assert.equal(database.getSnapshot().tasks.find((task) => task.id === stopped.id)?.status, 'stopped')
  } finally {
    globalThis.fetch = originalFetch
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not mark a delayed remote pause as applied when the task already changed state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'work-buddy-sanity-test-'))
  const database = new WorkBuddyDatabase(join(directory, 'work-buddy.sqlite'))
  const settings = database.getSettings()
  database.updateSettings({ ...settings, sanity: { ...settings.sanity, projectId: 'project', dataset: 'dataset' } })
  const paused = database.startTask({ mode: 'parallel', notes: 'Already paused' }).tasks[0]
  database.pauseTask(paused.id)
  const running = database.startTask({ mode: 'parallel', notes: 'Current task' }).tasks.find((task) => task.id !== paused.id)
  assert.ok(running)
  const originalFetch = globalThis.fetch
  const statuses: string[] = []
  const command = { _id: 'stale-pause', createdAt: new Date().toISOString(), command: 'pause-task', taskId: paused.id }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('data/query')) return Response.json({ result: [command] })
    if (url.includes('data/mutate')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ patch?: { set?: { status?: string } } }> }
      const status = body.mutations?.[0]?.patch?.set?.status
      if (status) statuses.push(status)
      return Response.json({ results: [] })
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  try {
    const sanity = new SanityService(database, () => 'token')
    assert.equal(await sanity.processPendingCommands(), false)
    assert.equal(database.getSnapshot().tasks.find((task) => task.id === paused.id)?.status, 'paused')
    assert.equal(database.getSnapshot().tasks.find((task) => task.id === running.id)?.status, 'running')
    assert.ok(statuses.includes('failed'))
  } finally {
    globalThis.fetch = originalFetch
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})
