import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  ActivityRecap,
  ActivityAssignment,
  ActivityConfig,
  ActivityEnvelope,
  ActivityRecord
} from '../shared/activity'
import { localDateKey, localDaysBefore } from '../shared/local-date'
import { validAutoEntry, type AutoEntry } from '../shared/activity-auto'

export class ActivityStore {
  private db: DatabaseSync
  readonly sourceId: string
  constructor(file: string, deviceId: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS intervals(id TEXT PRIMARY KEY,day TEXT NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS intervals_day ON intervals(day);
      CREATE TABLE IF NOT EXISTS dirty(day TEXT PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote(source TEXT NOT NULL,day TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(source,day));
      CREATE TABLE IF NOT EXISTS assignments(recordId TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recaps(day TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auto_entries(id TEXT PRIMARY KEY,day TEXT NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS auto_entries_day ON auto_entries(day);`)
    this.sourceId = this.get<string>('sourceId') ?? randomUUID()
    this.set('sourceId', this.sourceId)
    if (!this.get('config'))
      this.set('config', {
        enabled: false,
        captureTitles: false,
        idleSeconds: 60,
        excludedApps: [],
        excludedTitlePatterns: [],
        retentionDays: 30,
        cloudEnabled: false,
        cloudReads: false,
        uploadMinutes: 60,
        siteUrl: '',
        deviceId
      } satisfies ActivityConfig)
  }
  get<T>(key: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key=?')
      .get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }
  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO meta VALUES (?,?)')
      .run(key, JSON.stringify(value))
  }
  config(): ActivityConfig {
    const stored = this.get<Partial<ActivityConfig>>('config') ?? {}
    // Installations from before local delivery default to backups only: no cloud reads, hourly uploads.
    return {
      cloudReads: false,
      uploadMinutes: 60,
      ...stored
    } as ActivityConfig
  }
  /** Replaces one source's cached envelope for a day, leaving other sources untouched. */
  cacheOne(day: string, env: ActivityEnvelope, receivedAt = Date.now()): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO remote VALUES (?,?,?)')
        .run(env.sourceId, day, JSON.stringify(env))
      this.set('local:' + day, receivedAt)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  mark(day: string): void {
    this.db
      .prepare(
        'INSERT INTO dirty VALUES (?,1) ON CONFLICT(day) DO UPDATE SET revision=revision+1'
      )
      .run(day)
  }
  put(day: string, record: ActivityRecord): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO intervals VALUES (?,?,?)')
        .run(record.id, day, JSON.stringify(record))
      this.mark(day)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  local(day: string): ActivityRecord[] {
    return (
      this.db
        .prepare('SELECT body FROM intervals WHERE day=?')
        .all(day) as Array<{ body: string }>
    ).map((r) => JSON.parse(r.body) as ActivityRecord)
  }
  days(): string[] {
    return (
      this.db
        .prepare('SELECT DISTINCT day FROM intervals ORDER BY day')
        .all() as Array<{ day: string }>
    ).map((r) => r.day)
  }
  dirty(): Array<{ day: string; revision: number }> {
    return this.db.prepare('SELECT * FROM dirty ORDER BY day').all() as Array<{
      day: string
      revision: number
    }>
  }
  ack(day: string, revision: number): void {
    this.db
      .prepare('DELETE FROM dirty WHERE day=? AND revision=?')
      .run(day, revision)
  }
  remote(day: string, deviceId: string): ActivityRecord[] {
    return (
      this.db.prepare('SELECT body FROM remote WHERE day=?').all(day) as Array<{
        body: string
      }>
    ).flatMap((r) => {
      const env = JSON.parse(r.body) as ActivityEnvelope
      return env.deviceId === deviceId && env.sourceId !== this.sourceId
        ? env.records
        : []
    })
  }
  cache(day: string, envelopes: ActivityEnvelope[]): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM remote WHERE day=?').run(day)
      for (const env of envelopes)
        this.db
          .prepare('INSERT OR REPLACE INTO remote VALUES (?,?,?)')
          .run(env.sourceId, day, JSON.stringify(env))
      this.set('fetched:' + day, Date.now())
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  recap(day: string): ActivityRecap | undefined {
    const row = this.db
      .prepare('SELECT body FROM recaps WHERE day=?')
      .get(day) as { body: string } | undefined
    return row ? JSON.parse(row.body) : undefined
  }
  saveRecap(day: string, recap: ActivityRecap): void {
    this.db
      .prepare('INSERT OR REPLACE INTO recaps VALUES (?,?)')
      .run(day, JSON.stringify(recap))
  }
  clearMatching(day?: string): void {
    if (day)
      this.db.prepare('DELETE FROM meta WHERE key=?').run('matching:' + day)
    else this.db.prepare("DELETE FROM meta WHERE key LIKE 'matching:%'").run()
  }
  clearRecaps(day?: string): void {
    if (day) this.db.prepare('DELETE FROM recaps WHERE day=?').run(day)
    else this.db.exec('DELETE FROM recaps')
  }
  assign(value: ActivityAssignment): void {
    this.db
      .prepare('INSERT OR REPLACE INTO assignments VALUES (?,?)')
      .run(value.recordId, JSON.stringify(value))
  }
  assignments(): ActivityAssignment[] {
    return (
      this.db.prepare('SELECT body FROM assignments').all() as Array<{
        body: string
      }>
    ).map((r) => JSON.parse(r.body))
  }
  autoEntries(day: string): AutoEntry[] {
    return (
      this.db
        .prepare('SELECT body FROM auto_entries WHERE day=? ORDER BY id')
        .all(day) as Array<{ body: string }>
    )
      .map((r) => JSON.parse(r.body) as unknown)
      .filter(validAutoEntry)
      .sort(
        (a, b) =>
          a.intervals[0].start - b.intervals[0].start || a.id.localeCompare(b.id)
      )
  }
  saveAutoEntries(day: string, entries: AutoEntry[]): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM auto_entries WHERE day=?').run(day)
      const insert = this.db.prepare('INSERT INTO auto_entries VALUES (?,?,?)')
      for (const entry of entries)
        if (entry.day === day) insert.run(entry.id, day, JSON.stringify(entry))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  deleteDay(day: string): void {
    for (const prefix of ['matching:', 'decisions:', 'note:', 'review:'])
      this.db.prepare('DELETE FROM meta WHERE key=?').run(prefix + day)
    this.db.prepare('DELETE FROM auto_entries WHERE day=?').run(day)
    for (const record of this.local(day))
      this.db.prepare('DELETE FROM assignments WHERE recordId=?').run(record.id)
    this.db.prepare('DELETE FROM recaps WHERE day=?').run(day)
    this.db.prepare('DELETE FROM intervals WHERE day=?').run(day)
    this.mark(day)
  }
  prune(now = Date.now()): void {
    const cutoff = localDateKey(
      localDaysBefore(now, this.config().retentionDays - 1)
    )
    for (const day of this.days()) if (day < cutoff) this.deleteDay(day)
    for (const prefix of ['matching:', 'decisions:', 'note:', 'review:', 'local:', 'fetched:'])
      this.db
        .prepare('DELETE FROM meta WHERE key LIKE ? AND substr(key,?)<?')
        .run(prefix + '%', prefix.length + 1, cutoff)
    this.db.prepare('DELETE FROM remote WHERE day<?').run(cutoff)
    this.db.prepare('DELETE FROM recaps WHERE day<?').run(cutoff)
    this.db.prepare('DELETE FROM auto_entries WHERE day<?').run(cutoff)
    // No need to upload expired tombstones: the server applies the same retention window.
    this.db.prepare('DELETE FROM dirty WHERE day<?').run(cutoff)
  }
  close(): void {
    this.db.close()
  }
}
