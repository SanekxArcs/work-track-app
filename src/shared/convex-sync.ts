export interface ConvexSyncConfig {
  enabled: boolean
  siteUrl: string
  intervalHours: 6 | 12 | 24
}

export interface ConvexSyncStatus extends ConvexSyncConfig {
  sourceId: string
  hasKey: boolean
  syncing: boolean
  lastSyncedAt: number | null
  nextSyncAt: number | null
  error: string | null
}
