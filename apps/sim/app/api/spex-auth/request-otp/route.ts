import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidEmail, normalizeEmail, requestSpexEmailOtp } from '@/lib/spex/email-login'

const logger = createLogger('SpexEmailOtpRequest')

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = normalizeEmail(body.email)

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ message: 'A valid email is required' }, { status: 400 })
  }

  try {
    await requestSpexEmailOtp(email)
    return NextResponse.json({ success: true, message: 'Verification code sent' })
  } catch (error) {
    logger.error('Failed to request Spex email OTP', {
      error: error instanceof Error ? error.message : String(error),
    })
    const status = (error as Error & { status?: number }).status || 500
    const message = error instanceof Error ? error.message : 'Failed to send verification code'
    return NextResponse.json({ message }, { status })
  }
}
