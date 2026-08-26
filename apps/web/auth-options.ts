import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

const clientId = process.env.GOOGLE_CLIENT_ID
const clientSecret = process.env.GOOGLE_CLIENT_SECRET

export const googleLoginConfigured = Boolean(clientId && clientSecret)
export const googleLoginEnabled = googleLoginConfigured && process.env.WORK_BUDDY_REQUIRE_GOOGLE_LOGIN === 'true'

export const authOptions: NextAuthOptions = {
  providers: googleLoginEnabled ? [GoogleProvider({ clientId: clientId!, clientSecret: clientSecret! })] : [],
  callbacks: {
    async signIn({ profile }) {
      const allowedEmail = process.env.WORK_BUDDY_ALLOWED_EMAIL?.trim().toLowerCase()
      const email = typeof profile?.email === 'string' ? profile.email.toLowerCase() : ''
      return Boolean(allowedEmail && email === allowedEmail)
    }
  },
  pages: { signIn: '/' }
}
