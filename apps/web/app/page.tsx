import { getServerSession } from 'next-auth'
import { authOptions, googleLoginEnabled } from '../auth-options'
import { Dashboard } from '../components/Dashboard'
import { SignInButton } from '../components/SignInButton'
import { readWorkspace } from '../lib/sanity'

export const dynamic = 'force-dynamic'

export default async function Home(): Promise<React.JSX.Element> {
  const session = await getServerSession(authOptions)
  if (googleLoginEnabled && !session?.user?.email) return <main className="setup-card"><p className="eyebrow">Work Buddy Web</p><h1>Твій мобільний Work Buddy</h1><p>Увійди через свій Google-акаунт, щоб бачити й керувати власним робочим днем.</p><SignInButton /></main>
  let workspace = null
  try { workspace = await readWorkspace() } catch { /* Dashboard shows a useful empty state until the host variables are configured. */ }
  return <Dashboard initialWorkspace={workspace} email={session?.user?.email ?? 'Work Buddy companion'} />
}
