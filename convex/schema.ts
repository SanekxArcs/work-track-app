import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  workBuddyActivityDays: defineTable({ sourceId:v.string(), deviceId:v.string(), day:v.string(), kind:v.string(), storageId:v.id('_storage'), capturedAt:v.number(), expiresAt:v.number(), syncedAt:v.number() }).index('by_source_day',['sourceId','day']).index('by_device_day',['deviceId','day']).index('by_expiry',['expiresAt']),
  workBuddySnapshots: defineTable({
    sourceId: v.string(), storageId: v.id('_storage'), exportedAt: v.number(), syncedAt: v.number()
  }).index('by_source', ['sourceId'])
})
