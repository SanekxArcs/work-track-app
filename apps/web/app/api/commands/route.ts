import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions, googleLoginEnabled } from '../../../auth-options'
import { queueCommand } from '../../../lib/sanity'
import type { WorkBuddyCommand } from '../../../lib/workspace'

function isCommand(value: unknown): value is WorkBuddyCommand {
  if (!value || typeof value !== 'object' || !('command' in value)) return false
  const command = value as Record<string, unknown>
  if (command.command === 'pause-task' || command.command === 'resume-task') return typeof command.taskId === 'string'
  if (command.command === 'complete-rest') return typeof command.restId === 'string'
  if (command.command === 'start-rest') return command.restType === 'lunch' || command.restType === 'break'
  return command.command === 'end-workday'
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (googleLoginEnabled && !session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await request.json().catch(() => null)
  if (!isCommand(body)) return NextResponse.json({ error: 'Invalid command' }, { status: 400 })
  try {
    await queueCommand(body)
    return NextResponse.json({ queued: true }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not queue command' }, { status: 500 })
  }
}
