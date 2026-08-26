import { createClient } from '@sanity/client'
import type { WebWorkspace, WorkBuddyCommand } from './workspace'

const WORKSPACE_ID = 'workBuddySync.v1'

function config(): { projectId: string; dataset: string; apiVersion: string; token: string } {
  const projectId = process.env.SANITY_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET
  const apiVersion = process.env.SANITY_API_VERSION || process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2026-08-21'
  const token = process.env.SANITY_API_WRITE_TOKEN
  if (!projectId || !dataset || !token) throw new Error('Sanity environment is not configured on the host.')
  return { projectId, dataset, apiVersion, token }
}

function client() {
  const settings = config()
  return createClient({ ...settings, useCdn: false })
}

export async function readWorkspace(): Promise<WebWorkspace | null> {
  const document = await client().fetch<{ payload?: WebWorkspace } | null>('*[_id == $id][0]{payload}', { id: WORKSPACE_ID })
  return document?.payload ?? null
}

export async function queueCommand(command: WorkBuddyCommand): Promise<void> {
  const document: { _type: 'workBuddyCommand'; status: 'pending'; createdAt: string; command: WorkBuddyCommand['command']; taskId?: string; restId?: string; restType?: 'lunch' | 'break' } = {
    _type: 'workBuddyCommand',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...command
  }
  await client().create(document)
}
