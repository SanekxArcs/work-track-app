import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  workBuddyProjectCatalogs: defineTable({
    deviceId: v.string(),
    sourceId: v.string(),
    kind: v.string(),
    projects: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        archived: v.boolean(),
        color: v.optional(v.string())
      })
    ),
    capturedAt: v.number()
  })
    .index('by_device', ['deviceId'])
    .index('by_device_source', ['deviceId', 'sourceId']),
  workBuddyProjectLinks: defineTable({
    deviceId: v.string(),
    browserSourceId: v.string(),
    browserProjectId: v.string(),
    projectId: v.union(v.string(), v.null()),
    revision: v.number()
  })
    .index('by_device', ['deviceId'])
    .index('by_identity', ['deviceId', 'browserSourceId', 'browserProjectId']),
  workBuddyActivityDays: defineTable({
    sourceId: v.string(),
    deviceId: v.string(),
    day: v.string(),
    kind: v.string(),
    storageId: v.id('_storage'),
    capturedAt: v.number(),
    expiresAt: v.number(),
    syncedAt: v.number()
  })
    .index('by_source_day', ['sourceId', 'day'])
    .index('by_device_day', ['deviceId', 'day'])
    .index('by_expiry', ['expiresAt']),
  workBuddySnapshots: defineTable({
    sourceId: v.string(),
    storageId: v.id('_storage'),
    exportedAt: v.number(),
    syncedAt: v.number()
  }).index('by_source', ['sourceId'])
})
