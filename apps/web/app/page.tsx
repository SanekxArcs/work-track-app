import { getServerSession } from 'next-auth'
import { authOptions } from '../auth-options'
import { Dashboard } from '../components/Dashboard'
import { readWorkspace } from '../lib/sanity'

export const dynamic = 'force-dynamic'

export default async function Home(): Promise<React.JSX.Element> {
  const session = await getServerSession(authOptions)
  let workspace = null
  try { workspace = await readWorkspace() } catch { /* Dashboard shows a useful empty state until the host variables are configured. */ }
  return <Dashboard initialWorkspace={workspace} email={session?.user?.email ?? 'Work Buddy companion'} />
}
