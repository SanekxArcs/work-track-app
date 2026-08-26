import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions, googleLoginEnabled } from '../../../auth-options'
import { readWorkspace } from '../../../lib/sanity'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions)
  if (googleLoginEnabled && !session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ workspace: await readWorkspace() }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load workspace' }, { status: 500 })
  }
}
