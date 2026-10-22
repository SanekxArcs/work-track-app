import { httpActionGeneric, httpRouter, makeFunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'
import { validateActivityEnvelope, validActivityId, validActivityDay } from '../src/shared/activity'
import { MAX_SYNC_BYTES, validateSnapshot, validKeys } from './validation'

const http = httpRouter()
const publish = makeFunctionReference<'mutation', { sourceId: string; storageId: GenericId<'_storage'>; exportedAt: number }, { sourceId: string; syncedAt: number }>('snapshots:publish')
const latest = makeFunctionReference<'query', { sourceId: string }, { storageId: GenericId<'_storage'>; syncedAt: number } | null>('snapshots:latest')
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
function reply(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers }) }
function authorize(request: Request, mode: 'read' | 'write'): Response | null {
  const write = process.env.WORK_BUDDY_WRITE_KEY
  const read = process.env.WORK_BUDDY_READ_KEY
  if (!validKeys(write, read)) return reply({ error: 'Configure distinct read and write keys of at least 32 characters' }, 503)
  if (request.headers.get('Authorization') !== `Bearer ${mode === 'write' ? write : read}`) return reply({ error: 'Unauthorized' }, 401)
  return null
}
http.route({ path: '/work-buddy/snapshot', method: 'PUT', handler: httpActionGeneric(async (ctx, request) => {
  const denied = authorize(request, 'write')
  if (denied) return denied
  if (!request.headers.get('Content-Type')?.includes('application/json')) return reply({ error: 'Expected application/json' }, 415)
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > MAX_SYNC_BYTES) return reply({ error: 'Snapshot exceeds 10 MB' }, 413)
  let snapshot: Record<string, unknown>
  try { snapshot = validateSnapshot(JSON.parse(raw)) } catch { return reply({ error: 'Invalid Work Buddy snapshot' }, 400) }
  const storageId = await ctx.storage.store(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
  try {
    const receipt = await ctx.runMutation(publish, { sourceId: snapshot.sourceId as string, exportedAt: snapshot.exportedAt as number, storageId })
    return reply(receipt)
  } catch (error) {
    await ctx.storage.delete(storageId)
    throw error
  }
}) })
http.route({ path: '/work-buddy/snapshot', method: 'GET', handler: httpActionGeneric(async (ctx, request) => {
  const denied = authorize(request, 'read')
  if (denied) return denied
  const sourceId = new URL(request.url).searchParams.get('sourceId')
  if (!sourceId || !/^[a-zA-Z0-9-]{1,80}$/.test(sourceId)) return reply({ error: 'A valid sourceId is required' }, 400)
  const record = await ctx.runQuery(latest, { sourceId })
  if (!record) return reply({ error: 'No upload for this source yet' }, 404)
  const blob = await ctx.storage.get(record.storageId)
  if (!blob) return reply({ error: 'Snapshot changed; retry the request' }, 409)
  return reply({ syncedAt: record.syncedAt, data: JSON.parse(await blob.text()) })
}) })
const activityPublish = makeFunctionReference<'mutation', {sourceId:string;deviceId:string;day:string;kind:string;storageId:GenericId<'_storage'>;capturedAt:number;expiresAt:number;cutoffDay:string}, {sourceId:string;day:string;syncedAt:number}>('activity:publish')
const activityDay = makeFunctionReference<'query', {deviceId:string;day:string}, Array<{storageId:GenericId<'_storage'>;syncedAt:number}>>('activity:day')
http.route({path:'/work-buddy/activity',method:'PUT',handler:httpActionGeneric(async(ctx,request)=>{
  const denied=authorize(request,'write'); if(denied) return denied
  if (!request.headers.get('Content-Type')?.includes('application/json')) return reply({error:'Expected application/json'},415)
  const raw=await request.text()
  if(new TextEncoder().encode(raw).length>5*1024*1024) return reply({error:'Activity day exceeds 5 MB'},413)
  let data
  try { data=validateActivityEnvelope(JSON.parse(raw)) } catch {return reply({error:'Invalid activity day'},400)}
  const cutoffDay=new Date(Date.now()-data.retentionDays*86400000).toISOString().slice(0,10)
  if(data.day<cutoffDay) return reply({error:'Activity is outside retention'},400)
  const storageId=await ctx.storage.store(new Blob([JSON.stringify(data)],{type:'application/json'}))
  try { return reply(await ctx.runMutation(activityPublish,{sourceId:data.sourceId,deviceId:data.deviceId,day:data.day,kind:data.kind,storageId,capturedAt:data.capturedAt,expiresAt:Date.parse(data.day+'T00:00:00Z')+(data.retentionDays+1)*86400000,cutoffDay})) }
  catch(error) {await ctx.storage.delete(storageId);throw error}
})})
http.route({path:'/work-buddy/activity',method:'GET',handler:httpActionGeneric(async(ctx,request)=>{
  const denied=authorize(request,'read');if(denied) return denied
  const params=new URL(request.url).searchParams, deviceId=params.get('deviceId'), day=params.get('day')
  if(!validActivityId(deviceId)||!validActivityDay(day)) return reply({error:'A valid deviceId and day are required'},400)
  const records=await ctx.runQuery(activityDay,{deviceId,day})
  const sources=[]
  for(const record of records) {
    const blob=await ctx.storage.get(record.storageId)
    if(!blob) return reply({error:'Activity changed; retry'},409)
    const data=JSON.parse(await blob.text())
    if(data.day>=new Date(Date.now()-data.retentionDays*86400000).toISOString().slice(0,10)) sources.push({syncedAt:record.syncedAt,data})
  }
  return reply({sources,fetchedAt:Date.now()})
})})
export default http
