import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'
const entry = v.object({
  id: v.string(),
  name: v.string(),
  archived: v.boolean(),
  color: v.optional(v.string())
})
export const publish = internalMutation({
  args: {
    deviceId: v.string(),
    sourceId: v.string(),
    kind: v.string(),
    projects: v.array(entry),
    capturedAt: v.number()
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query('workBuddyProjectCatalogs')
      .withIndex('by_device_source', (q) =>
        q.eq('deviceId', args.deviceId).eq('sourceId', args.sourceId)
      )
      .unique()
    if (old) {
      if (args.capturedAt >= old.capturedAt) await ctx.db.replace(old._id, args)
    } else await ctx.db.insert('workBuddyProjectCatalogs', args)
    return { ok: true }
  }
})
export const registry = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const catalogs = await ctx.db
      .query('workBuddyProjectCatalogs')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .collect()
    const links = await ctx.db
      .query('workBuddyProjectLinks')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .collect()
    return {
      deviceId,
      workProjects: catalogs
        .filter((c) => c.kind === 'desktop')
        .flatMap((c) => c.projects),
      browserProjects: catalogs
        .filter((c) => c.kind === 'browser')
        .flatMap((c) =>
          c.projects.map((p) => ({ ...p, sourceId: c.sourceId }))
        ),
      links: links.map(
        ({ browserSourceId, browserProjectId, projectId, revision }) => ({
          browserSourceId,
          browserProjectId,
          projectId,
          revision
        })
      ),
      updatedAt: Math.max(0, ...catalogs.map((c) => c.capturedAt)) || null
    }
  }
})
export const link = internalMutation({
  args: {
    deviceId: v.string(),
    browserSourceId: v.string(),
    browserProjectId: v.string(),
    projectId: v.union(v.string(), v.null()),
    expectedRevision: v.number()
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query('workBuddyProjectLinks')
      .withIndex('by_identity', (q) =>
        q
          .eq('deviceId', args.deviceId)
          .eq('browserSourceId', args.browserSourceId)
          .eq('browserProjectId', args.browserProjectId)
      )
      .unique()
    if ((old?.revision ?? 0) !== args.expectedRevision)
      return { conflict: true }
    const catalogs = await ctx.db
      .query('workBuddyProjectCatalogs')
      .withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
      .collect()
    if (
      !catalogs.some(
        (c) =>
          c.kind === 'browser' &&
          c.sourceId === args.browserSourceId &&
          c.projects.some((p) => p.id === args.browserProjectId)
      )
    )
      throw new Error('Browser project no longer exists')
    if (
      args.projectId !== null &&
      !catalogs.some(
        (c) =>
          c.kind === 'desktop' &&
          c.projects.some((p) => p.id === args.projectId && !p.archived)
      )
    )
      throw new Error('Work project no longer exists')
    const { expectedRevision, ...data } = args
    const value = { ...data, revision: expectedRevision + 1 }
    if (old) await ctx.db.replace(old._id, value)
    else await ctx.db.insert('workBuddyProjectLinks', value)
    return { conflict: false }
  }
})
