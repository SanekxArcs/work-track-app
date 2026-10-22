import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  workBuddySnapshots: defineTable({
    sourceId: v.string(), storageId: v.id('_storage'), exportedAt: v.number(), syncedAt: v.number()
  }).index('by_source', ['sourceId'])
})
