import { internalMutationGeneric, internalQueryGeneric } from 'convex/server'
import { v } from 'convex/values'

export const publish = internalMutationGeneric({
  args: { sourceId: v.string(), storageId: v.id('_storage'), exportedAt: v.number() },
  handler: async (ctx, args) => {
    const previous = await ctx.db.query('workBuddySnapshots').withIndex('by_source', (q) => q.eq('sourceId', args.sourceId)).unique()
    // A delayed retry must not replace a newer upload.
    if (previous && previous.exportedAt > args.exportedAt) {
      await ctx.storage.delete(args.storageId)
      return { sourceId: args.sourceId, syncedAt: previous.syncedAt }
    }
    const syncedAt = Date.now()
    if (previous) {
      await ctx.db.patch(previous._id, { ...args, syncedAt })
      await ctx.storage.delete(previous.storageId)
    } else await ctx.db.insert('workBuddySnapshots', { ...args, syncedAt })
    return { sourceId: args.sourceId, syncedAt }
  }
})

export const latest = internalQueryGeneric({
  args: { sourceId: v.string() },
  handler: (ctx, args) => ctx.db.query('workBuddySnapshots').withIndex('by_source', (q) => q.eq('sourceId', args.sourceId)).unique()
})
