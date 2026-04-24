import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createSpexSimSession,
  extractSetCookies,
  isValidEmail,
  normalizeEmail,
  normalizeOtp,
  verifySpexEmailOtp,
} from '@/lib/spex/email-login'

const logger = createLogger('SpexEmailOtpVerify')

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = normalizeEmail(body.email)
  const otp = normalizeOtp(body.otp)

  if (!email || !isValidEmail(email) || !otp) {
    return NextResponse.json(
      { message: 'Email and verification code are required' },
      { status: 400 }
    )
  }

  try {
    const identity = await verifySpexEmailOtp(email, otp)
    const { authHeaders } = await createSpexSimSession(request, identity)
    const response = NextResponse.json({ success: true, redirectTo: '/workspace' })

    for (const cookie of extractSetCookies(authHeaders)) {
      response.headers.append('set-cookie', cookie)
    }

    return response
  } catch (error) {
    logger.error('Failed to verify Spex email OTP', {
      error: error instanceof Error ? error.message : String(error),
    })
    const status = (error as Error & { status?: number }).status || 500
    const message = error instanceof Error ? error.message : 'Failed to verify code'
    return NextResponse.json({ message }, { status })
  }
}
