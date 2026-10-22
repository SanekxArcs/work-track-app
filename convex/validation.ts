const collections = ['projects', 'plannedTasks', 'tasks', 'workdays', 'rests', 'projectStatuses', 'projectTypes'] as const
export const MAX_SYNC_BYTES = 10 * 1024 * 1024

/** Whitelist the public data shape; never persist arbitrary client settings or credentials. */
export function validateSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid snapshot')
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1 || typeof data.sourceId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(data.sourceId) || typeof data.exportedAt !== 'number' || !Number.isFinite(data.exportedAt) || data.exportedAt < 0 || data.exportedAt > Date.now() + 300000) throw new Error('Invalid snapshot metadata')
  const result: Record<string, unknown> = { schemaVersion: 1, sourceId: data.sourceId, exportedAt: data.exportedAt }
  for (const name of collections) {
    const rows = data[name]
    if (!Array.isArray(rows)) throw new Error(`Missing ${name}`)
    const ids = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error(`Invalid ${name} IDs`)
      ids.add(row.id)
    }
    result[name] = rows
  }
  if (!Array.isArray(data.overtimeRedeemedDates) || !data.overtimeRedeemedDates.every((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error('Invalid overtime dates')
  result.overtimeRedeemedDates = data.overtimeRedeemedDates
  return result
}

export function validKeys(write: string | undefined, read: string | undefined): boolean {
  return Boolean(write && read && write.length >= 32 && read.length >= 32 && write !== read)
}
