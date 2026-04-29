import { type NextRequest, NextResponse } from 'next/server'

/**
 * Native credential routes that are blocked in Spex-only deployments.
 * Session reads, sign-out, and OAuth token exchanges are intentionally not blocked.
 */
const BLOCKED_NATIVE_AUTH_PATHS = new Set([
  '/api/auth/sign-up/email',
  '/api/auth/sign-in/email',
  '/api/auth/sign-in/social',
  '/api/auth/sign-in/magic-link',
  '/api/auth/forget-password',
  '/api/auth/reset-password',
])

export function middleware(request: NextRequest) {
  if (process.env.SPEX_AUTH_ONLY !== 'true') {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  if (BLOCKED_NATIVE_AUTH_PATHS.has(pathname)) {
    return NextResponse.json(
      { error: 'Native authentication is disabled. Please use Spex login.' },
      { status: 403 }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/auth/:path*',
}
