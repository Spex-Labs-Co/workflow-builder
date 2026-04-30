import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createSpexSimSession,
  extractSetCookies,
  resolveSpexBootstrapToken,
} from '@/lib/spex/email-login'

const logger = createLogger('SpexBootstrapConsume')

function normalizeRedirectPath(value: unknown) {
  const redirectPath = String(value || '').trim()
  if (!redirectPath) {
    return '/workspace'
  }

  if (!redirectPath.startsWith('/') || redirectPath.startsWith('//')) {
    return '/workspace'
  }

  return redirectPath
}

export async function GET(request: NextRequest) {
  const bootstrapToken = request.nextUrl.searchParams.get('token')?.trim()
  if (!bootstrapToken) {
    return NextResponse.redirect(new URL('/login?error=missing-bootstrap-token', request.url))
  }

  try {
    const identity = await resolveSpexBootstrapToken(bootstrapToken)
    const { authHeaders } = await createSpexSimSession(request, identity)
    const redirectPath = normalizeRedirectPath(identity.redirectPath)
    const response = NextResponse.redirect(new URL(redirectPath, request.url))

    for (const cookie of extractSetCookies(authHeaders)) {
      response.headers.append('set-cookie', cookie)
    }

    return response
  } catch (error) {
    logger.error('Failed to consume Spex bootstrap token', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.redirect(new URL('/login?error=invalid-bootstrap-token', request.url))
  }
}
