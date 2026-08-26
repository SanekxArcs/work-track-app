import type { Metadata, Viewport } from 'next'
import './globals.css'
import { PwaRegistration } from '../components/PwaRegistration'

export const metadata: Metadata = {
  title: 'Work Buddy',
  description: 'Your live Work Buddy dashboard',
  applicationName: 'Work Buddy',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Work Buddy' }
}

export const viewport: Viewport = { themeColor: '#161914', colorScheme: 'dark' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <html lang="uk"><body><PwaRegistration />{children}</body></html>
}
