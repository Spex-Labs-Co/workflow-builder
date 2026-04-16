import type { Metadata } from 'next'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { AUTH_PRIMARY_CTA_BASE } from '@/app/(auth)/components/auth-button-classes'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'
import { env } from '@/lib/core/config/env'

export const metadata: Metadata = {
  title: 'Log In',
}

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (env.SPEX_AUTH_ONLY) {
    const spexEntryUrl = env.SPEX_FRONTEND_URL || 'https://spexlabs.co'

    return (
      <AuthBackground className='dark font-[430] font-season text-white'>
        <div className='mx-auto flex min-h-screen max-w-xl items-center px-6 py-16'>
          <div className='w-full rounded-[24px] border border-white/10 bg-black/45 p-8 backdrop-blur-md'>
            <p className='text-xs uppercase tracking-[0.24em] text-white/55'>Spex AI Access</p>
            <h1 className='mt-4 text-3xl leading-tight text-white'>Open the builder from Spex.</h1>
            <p className='mt-4 text-sm leading-6 text-white/70'>
              Native SIM login is disabled for this deployment. Use the HeySpex app or Spex
              website with your verified email to enter the workflow builder.
            </p>
            <div className='mt-6'>
              <a href={spexEntryUrl} className={AUTH_PRIMARY_CTA_BASE}>
                Go To Spex
              </a>
            </div>
          </div>
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
