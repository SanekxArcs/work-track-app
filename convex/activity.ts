import { makeFunctionReference } from 'convex/server'
import { internalMutation as internalMutationGeneric, internalQuery as internalQueryGeneric } from './_generated/server'
import { v } from 'convex/values'

export const publish = internalMutationGeneric({
  args: {
    sourceId: v.string(),
    deviceId: v.string(),
    day: v.string(),
    kind: v.string(),
    storageId: v.id('_storage'),
    capturedAt: v.number(),
    expiresAt: v.number(),
    cutoffDay: v.string()
  },
  handler: async (ctx, args) => {
    const { cutoffDay, ...record } = args
    const previous = await ctx.db
      .query('workBuddyActivityDays')
      .withIndex('by_source_day', (q) => q.eq('sourceId', args.sourceId).eq('day', args.day))
      .unique()
    if (previous && previous.capturedAt > args.capturedAt) {
      await ctx.storage.delete(args.storageId)
      return { sourceId: args.sourceId, day: args.day, syncedAt: previous.syncedAt }
    }
    const syncedAt = Date.now()
    if (previous) {
      await ctx.db.patch(previous._id, { ...record, syncedAt })
      await ctx.storage.delete(previous.storageId)
    } else await ctx.db.insert('workBuddyActivityDays', { ...record, syncedAt })
    const expired = await ctx.db
      .query('workBuddyActivityDays')
      .withIndex('by_source_day', (q) => q.eq('sourceId', args.sourceId).lt('day', cutoffDay))
      .take(100)
    for (const row of expired) {
      await ctx.storage.delete(row.storageId)
      await ctx.db.delete(row._id)
    }
    return { sourceId: args.sourceId, day: args.day, syncedAt }
  }
})
export const day = internalQueryGeneric({
  args: { deviceId: v.string(), day: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query('workBuddyActivityDays')
      .withIndex('by_device_day', (q) => q.eq('deviceId', args.deviceId).eq('day', args.day))
      .take(30)
})

export const purge = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('workBuddyActivityDays')
      .withIndex('by_expiry', (q) => q.lt('expiresAt', Date.now()))
      .take(100)
    for (const row of expired) {
      await ctx.storage.delete(row.storageId)
      await ctx.db.delete(row._id)
    }
    if (expired.length === 100) await ctx.scheduler.runAfter(0, makeFunctionReference<'mutation'>('activity:purge'), {})
  }
})
