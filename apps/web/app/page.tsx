import { getServerSession } from 'next-auth'
import { authOptions, googleLoginConfigured } from '../auth-options'
import { Dashboard } from '../components/Dashboard'
import { SignInButton } from '../components/SignInButton'
import { readWorkspace } from '../lib/sanity'

export const dynamic = 'force-dynamic'

export default async function Home(): Promise<React.JSX.Element> {
  if (!googleLoginConfigured) return <main className="setup-card"><p className="eyebrow">Work Buddy Web</p><h1>Потрібно підключити Google sign-in</h1><p>Додай на Vercel змінні <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> і <code>WORK_BUDDY_ALLOWED_EMAIL</code>. Вони не потрапляють у браузер.</p></main>
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return <main className="setup-card"><p className="eyebrow">Work Buddy Web</p><h1>Твій мобільний Work Buddy</h1><p>Увійди через свій Google-акаунт, щоб бачити й керувати власним робочим днем.</p><SignInButton /></main>
  let workspace = null
  try { workspace = await readWorkspace() } catch { /* Dashboard shows a useful empty state until the host variables are configured. */ }
  return <Dashboard initialWorkspace={workspace} email={session.user.email} />
}
