import type { Metadata } from 'next'
import { env } from '@/lib/core/config/env'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'
import SpexLoginForm from '@/app/(auth)/login/spex-login-form'

export const metadata: Metadata = {
  title: 'Log In',
}

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (env.SPEX_AUTH_ONLY) {
    return (
      <AuthBackground className='dark font-[430] font-season text-white'>
        <div className='mx-auto flex min-h-screen max-w-xl items-center px-6 py-16'>
          <SpexLoginForm />
        </div>
      </AuthBackground>
    )
  }

  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  return (
    <LoginForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
    />
  )
}
