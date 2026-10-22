import assert from 'node:assert/strict'
import test from 'node:test'
import { ConvexSyncService, normalizeSyncConfig, syncPayload } from '../src/main/convex-sync.ts'
import { defaultSettings } from '../src/main/database.ts'
import type { BackupData } from '../src/shared/types.ts'
import { validKeys, validateSnapshot } from '../convex/validation.ts'

const backup: BackupData = { schemaVersion: 1, exportedAt: 1000, settings: defaultSettings, projects: [], plannedTasks: [], tasks: [], workdays: [], rests: [] }
function fixture() {
  const values = new Map<string, string>()
  let closed = false
  let now = 1000000
  let calls = 0
  let fail = false
  const store = { getSecret: (key: string) => { assert.equal(closed, false); return values.get(key) }, setSecret: (key: string, value: string) => { assert.equal(closed, false); values.set(key, value) }, exportBackup: () => backup }
  const vault = { encrypt: (key: string) => `encrypted:${key}`, decrypt: (key: string) => key.slice(10) }
  const request = (async (_url, init) => {
    calls++
    if (fail) return new Response('', { status: 503 })
    const payload = JSON.parse(String(init?.body))
    assert.equal(init?.redirect, 'error')
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${'w'.repeat(32)}`)
    return Response.json({ sourceId: payload.sourceId, syncedAt: now })
  }) as typeof fetch
  const make = () => new ConvexSyncService(store, vault, request, () => now)
  const service = make()
  const config = { enabled: true, siteUrl: 'https://test.convex.site', intervalHours: 12 as const }
  return { service, make, config, values, calls: () => calls, advance: (ms: number) => { now += ms }, fail: () => { fail = true }, close: () => { closed = true } }
}

test('sync accepts only Convex HTTPS origins and supported intervals', () => {
  for (const siteUrl of ['http://test.convex.site', 'https://evil.com', 'https://test.convex.site/path', 'https://test.convex.site?key=x', 'https://user@test.convex.site']) {
    assert.throws(() => normalizeSyncConfig({ enabled: true, siteUrl, intervalHours: 12 }))
  }
  assert.equal(normalizeSyncConfig({ enabled: true, siteUrl: 'https://test.convex.site/', intervalHours: 12 }).siteUrl, 'https://test.convex.site')
  assert.equal(normalizeSyncConfig({ enabled: true, siteUrl: 'https://clear-parrot-65.eu-west-1.convex.site', intervalHours: 12 }).siteUrl, 'https://clear-parrot-65.eu-west-1.convex.site')
  assert.throws(() => normalizeSyncConfig({ enabled: true, siteUrl: 'https://test.convex.site.evil.com', intervalHours: 12 }))
})
test('scheduled sync respects 12 hours across restart and preserves encrypted credentials', async () => {
  const f = fixture()
  f.service.configure(f.config, 'w'.repeat(32))
  await f.service.tick()
  assert.equal(f.calls(), 1)
  assert.equal(f.values.get('convex_sync_token'), `encrypted:${'w'.repeat(32)}`)
  f.advance(11 * 3600000)
  const restarted = f.make()
  await restarted.tick()
  assert.equal(f.calls(), 1)
  f.advance(3600000)
  await restarted.tick()
  assert.equal(f.calls(), 2)
  assert.equal(restarted.status().sourceId, f.service.status().sourceId)
})
test('failed upload leaves last success unchanged and waits 30 minutes before retry', async () => {
  const f = fixture()
  f.service.configure(f.config, 'w'.repeat(32))
  f.fail()
  await f.service.tick()
  assert.equal(f.service.status().lastSyncedAt, null)
  assert.match(f.service.status().error!, /503/)
  f.advance(29 * 60000)
  await f.service.tick()
  assert.equal(f.calls(), 1)
  f.advance(60000)
  await f.service.tick()
  assert.equal(f.calls(), 2)
})
test('concurrent sync requests share one upload and disabled sync does not upload', async () => {
  const f = fixture()
  await f.service.tick()
  assert.equal(f.calls(), 0)
  f.service.configure(f.config, 'w'.repeat(32))
  await Promise.all([f.service.sync(), f.service.sync()])
  assert.equal(f.calls(), 1)
  f.service.configure({ ...f.config, enabled: false })
  f.advance(24 * 3600000)
  await f.service.tick()
  assert.equal(f.calls(), 1)
})
test('sync excludes device settings, tokens, and AI configuration', () => {
  const data = syncPayload(backup, 'source-1')
  assert.equal('settings' in data, false)
  assert.equal('ai' in data, false)
  assert.equal('notifications' in data, false)
  const validated = validateSnapshot({ ...data, secret: 'must not be stored' })
  assert.equal('secret' in validated, false)
  assert.throws(() => validateSnapshot({ ...data, tasks: [{ id: 'a' }, { id: 'a' }] }))
  assert.throws(() => validateSnapshot({ ...data, schemaVersion: 2 }))
  assert.equal(validKeys('w'.repeat(32), 'w'.repeat(32)), false)
  assert.equal(validKeys('w'.repeat(32), 'r'.repeat(32)), true)
})
test('stopping an in-flight upload never accesses a closed database', async () => {
  const f = fixture()
  f.service.configure(f.config, 'w'.repeat(32))
  const pending = f.service.sync()
  f.service.stop()
  f.close()
  await pending
})

test('an unreadable saved key requests replacement without uploading or repeated automatic attempts', async () => {
  const values = new Map<string, string>()
  let calls = 0
  let decryptions = 0
  const store = { getSecret: (key: string) => values.get(key), setSecret: (key: string, value: string) => { values.set(key, value) }, exportBackup: () => backup }
  const vault = { encrypt: (key: string) => `new:${key}`, decrypt: (value: string) => {
    decryptions++
    if (value === 'unreadable-ciphertext') throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    return value.slice(4)
  } }
  const request = (async (_url, init) => { calls++; const payload = JSON.parse(String(init?.body)); return Response.json({ sourceId: payload.sourceId, syncedAt: Date.now() }) }) as typeof fetch
  const service = new ConvexSyncService(store, vault, request)
  const config = { enabled: true, siteUrl: 'https://test.convex.site', intervalHours: 12 as const }
  service.configure(config, 'w'.repeat(32))
  values.set('convex_sync_token', 'unreadable-ciphertext')
  await service.sync()
  assert.equal(service.status().hasKey, false)
  assert.equal(service.status().nextSyncAt, null)
  assert.match(service.status().error!, /Re-enter your write key/)
  assert.equal(calls, 0)
  await service.tick()
  assert.equal(decryptions, 1)
  assert.throws(() => service.configure(config), /Enter a write key/)
  service.configure(config, 'w'.repeat(32))
  await service.sync()
  assert.equal(service.status().error, null)
  assert.equal(service.status().hasKey, true)
  assert.equal(calls, 1)
})
