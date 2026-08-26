'use client'

import { signIn } from 'next-auth/react'

export function SignInButton(): React.JSX.Element {
  return <button className="primary-button" onClick={() => void signIn('google')}>Увійти через Google</button>
}
