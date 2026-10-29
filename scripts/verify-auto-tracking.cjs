// Isolated-profile check of the automatic tracking journal in the built Electron app.
// Run: env -u ELECTRON_RUN_AS_NODE node scripts/verify-auto-tracking.cjs
const { _electron } = require('../../tabs-manager/node_modules/playwright')
const { DatabaseSync } = require('node:sqlite')
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'),
  profile = mkdtempSync(path.join(tmpdir(), 'work-buddy-auto-ui-')),
  output = path.join(root, '.artifacts', 'activity')
mkdirSync(output, { recursive: true })
const now = Date.now(),
  day = new Date(now).toLocaleDateString('en-CA'),
  base = now - 3 * 3600000
const db = new DatabaseSync(path.join(profile, 'activity.sqlite'))
db.exec(
  'CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE intervals(id TEXT PRIMARY KEY,day TEXT NOT NULL,body TEXT NOT NULL);CREATE TABLE remote(source TEXT NOT NULL,day TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(source,day));'
)
const config = {
  enabled: false,
  captureTitles: true,
  idleSeconds: 60,
  excludedApps: [],
  excludedTitlePatterns: [],
  retentionDays: 30,
  cloudEnabled: false,
  siteUrl: '',
  deviceId: 'test-pc'
}
db.prepare('INSERT INTO meta VALUES (?,?)').run('config', JSON.stringify(config))
db.prepare('INSERT INTO meta VALUES (?,?)').run('sourceId', JSON.stringify('test-desktop'))
const record = (id, start, end, extra = {}) => ({
  id,
  sourceId: 'test-desktop',
  deviceId: 'test-pc',
  kind: 'desktop',
  state: 'active',
  app: 'Code.exe',
  title: 'activity-auto.ts · work-track-app',
  start: base + start,
  end: base + end,
  ...extra
})
for (const row of [
  record('code', 0, 3600000),
  record('chrome', 3600000, 5400000, { app: 'chrome.exe', title: '' }),
  record('idle', 5400000, 6000000, { app: '', title: '', state: 'idle' })
])
  db.prepare('INSERT INTO intervals VALUES (?,?,?)').run(row.id, day, JSON.stringify(row))
const browser = record('browser', 3600000, 5400000, {
  sourceId: 'test-browser',
  kind: 'browser',
  app: 'chrome.exe',
  title: 'Convex documentation',
  domain: 'docs.convex.dev',
  url: 'https://docs.convex.dev/functions/http-actions',
  projectName: 'Work Buddy',
  browserProjectId: 'browser-project'
})
db.prepare('INSERT INTO remote VALUES (?,?,?)').run(
  'test-browser',
  day,
  JSON.stringify({
    schemaVersion: 1,
    sourceId: 'test-browser',
    deviceId: 'test-pc',
    kind: 'browser',
    day,
    capturedAt: now,
    retentionDays: 30,
    records: [browser]
  })
)
db.close()
const bootstrap = path.join(profile, 'bootstrap.cjs')
writeFileSync(
  bootstrap,
  `const {app}=require('electron');app.setLoginItemSettings=()=>{};app.setPath('userData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`
)
;(async () => {
  const electron = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [bootstrap],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
  })
  const errors = []
  try {
    const page = await electron.firstWindow()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForLoadState('domcontentloaded')
    const today = () => new Date().toLocaleDateString('en-CA')
    await page.evaluate(async () => {
      await window.workBuddy.createProject({ name: 'Work Buddy', color: '#55aaff' })
    })
    await page.getByRole('button', { name: 'Активність ПК', exact: true }).click()
    await page.getByText('Автоматичний облік', { exact: true }).first().waitFor()
    const handle = await electron.browserWindow(page)
    await handle.evaluate((window) => window.setSize(380, 900))
    // Starts paused with an empty journal.
    await page.getByText('Автоматичний облік призупинено', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Увімкнути автоматичний облік', exact: true }).click()
    await page.waitForFunction(
      async (d) => {
        const data = await window.workBuddy.getActivityDay(d)
        return data.auto?.config.enabled && data.auto.entries.length === 2
      },
      today(),
      { timeout: 20000 }
    )
    await page.locator('.activity-auto-entry').nth(1).waitFor()
    assert.equal(await page.locator('.activity-auto-entry').count(), 2)
    const overflow = await page.locator('.activity-page').evaluate((el) => el.scrollWidth > el.clientWidth)
    assert.equal(overflow, false, 'Automatic tracking card must fit the narrow tracker window')
    await page.locator('.activity-auto').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'auto-tracking-journal-380.png') })
    const entries = await page.evaluate(async (d) => (await window.workBuddy.getActivityDay(d)).auto.entries, today())
    const browserEntry = entries.find((e) => e.context.includes('docs.convex.dev'))
    assert.ok(browserEntry, 'browser detail enriches the chrome period')
    assert.equal(browserEntry.match, 'name', 'a unique project name is matched automatically')
    assert.equal(entries.reduce((sum, e) => sum + e.intervals.reduce((s, r) => s + r.end - r.start, 0), 0), 5400000)
    // Describe and record the first entry as a task.
    await page.getByLabel('Опис автоматичного запису 1').fill('Automatic tracking work')
    await page.getByLabel('Опис автоматичного запису 1').blur()
    await page.waitForFunction(
      async (d) => (await window.workBuddy.getActivityDay(d)).auto.entries.some((e) => e.notes === 'Automatic tracking work'),
      today()
    )
    assert.equal(await page.evaluate(async (d) => (await window.workBuddy.getDaySnapshot(d)).tasks.length, today()), 0)
    await page.getByRole('button', { name: 'Записати як завдання', exact: true }).first().click()
    await page.getByRole('button', { name: 'Записати завдання', exact: true }).click()
    await page.getByText('Записано завдань: 1', { exact: true }).waitFor()
    const tasks = await page.evaluate(async (d) => (await window.workBuddy.getDaySnapshot(d)).tasks, today())
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].status, 'stopped')
    assert.equal(tasks[0].notes, 'Automatic tracking work')
    assert.equal(tasks[0].intervals.reduce((s, i) => s + i.endedAt - i.startedAt, 0), 3600000)
    assert.equal(await page.locator('.activity-auto-entry').count(), 1, 'the recorded entry leaves the open list')
    await page.getByText('Записано як завдання (1)', { exact: true }).waitFor()
    // Mark the remaining entry as not work; it must not come back on the next pass.
    await page.getByRole('button', { name: 'Не робота', exact: true }).click()
    await page.getByText('Позначено як не робота (1)', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Запустити автоматичний облік зараз', exact: true }).click()
    await page.waitForFunction(async (d) => (await window.workBuddy.getActivityDay(d)).auto.lastRunAt > 0, today())
    assert.equal(await page.locator('.activity-auto-entry').count(), 0)
    await page.screenshot({ path: path.join(output, 'auto-tracking-recorded-380.png') })
    // Settings: cloud reads off and hourly backups by default; the new controls must fit the window.
    await page.getByRole('button', { name: 'Налаштування активності', exact: true }).click()
    await page.getByText('Резервувати активність у Convex', { exact: true }).waitFor()
    const settings = await page.evaluate(async (d) => (await window.workBuddy.getActivityDay(d)).status.config, today())
    assert.equal(settings.cloudReads, false)
    assert.equal(settings.uploadMinutes, 60)
    assert.equal(
      await page.locator('.activity-page').evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      'Settings must fit the narrow tracker window'
    )
    await page.locator('.activity-preferences').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'activity-settings-local-380.png') })
    assert.deepEqual(errors, [])
    console.log('Automatic tracking UI verified. Screenshots in', output)
  } finally {
    await electron.close().catch(() => {})
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
