'use client'

import { type FormEvent, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'

type Step = 'email' | 'otp'

type SpexLoginFormProps = {
  spexApiBaseUrl: string
}

function getSpexOtpRequestUrl(spexApiBaseUrl: string) {
  const baseUrl = spexApiBaseUrl.replace(/\/$/, '')
  return `${baseUrl}/auth/sim/email/request-otp`
}

export default function SpexLoginForm({ spexApiBaseUrl }: SpexLoginFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch(getSpexOtpRequestUrl(spexApiBaseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.message || 'Unable to send verification code')
      }

      setStep('otp')
      setMessage('Verification code sent.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send verification code')
    } finally {
      setLoading(false)
    }
  }

  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch('/api/spex-auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.message || 'Unable to verify code')
      }

      router.push(data?.redirectTo || '/workspace')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='w-full rounded-[24px] border border-white/10 bg-black/45 p-8 backdrop-blur-md'>
      <p className='text-white/55 text-xs uppercase tracking-[0.24em]'>Spex Builder</p>
      <h1 className='mt-4 text-3xl text-white leading-tight'>Sign in with your Spex email.</h1>
      <p className='mt-4 text-sm text-white/70 leading-6'>
        Enter the email used for your Spex purchase. We will send a one-time code if your purchase
        is active.
      </p>

      {step === 'email' ? (
        <form className='mt-6 space-y-4' onSubmit={submitEmail}>
          <input
            className='h-11 w-full rounded-[8px] border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30'
            inputMode='email'
            onChange={(event) => setEmail(event.target.value)}
            placeholder='you@example.com'
            type='email'
            value={email}
          />
          <button className={AUTH_SUBMIT_BTN} disabled={loading || !email.trim()} type='submit'>
            {loading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            Send Code
          </button>
        </form>
      ) : (
        <form className='mt-6 space-y-4' onSubmit={submitOtp}>
          <input
            className='h-11 w-full rounded-[8px] border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30'
            inputMode='numeric'
            maxLength={6}
            onChange={(event) => setOtp(event.target.value)}
            placeholder='123456'
            value={otp}
          />
          <button
            className={AUTH_SUBMIT_BTN}
            disabled={loading || otp.trim().length < 6}
            type='submit'
          >
            {loading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            Verify And Open Builder
          </button>
          <button
            className='text-white/55 text-xs transition-colors hover:text-white'
            onClick={() => {
              setStep('email')
              setOtp('')
              setError('')
              setMessage('')
            }}
            type='button'
          >
            Use a different email
          </button>
        </form>
      )}

      {message ? <p className='mt-4 text-emerald-300/85 text-sm'>{message}</p> : null}
      {error ? <p className='mt-4 text-red-300/85 text-sm'>{error}</p> : null}
    </div>
  )
}
