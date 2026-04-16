import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, ne, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { ensureDefaultWorkspaceForUser } from '@/lib/workspaces/default-workspace'

const logger = createLogger('SpexBootstrap')

const PASSWORD_PREFIX = 'spex-bootstrap::'

type SpexBootstrapResolveResponse = {
  success: boolean
  spexUserId: string
  email: string | null
  firstName?: string | null
  lastName?: string | null
  simLoginAllowed?: boolean
  requiresEmailLink?: boolean
}

function buildDeterministicPassword(spexUserId: string) {
  const source = `${PASSWORD_PREFIX}${spexUserId}::${env.BETTER_AUTH_SECRET}`
  const encoded = Buffer.from(source).toString('base64url')
  return `${encoded.slice(0, 48)}Aa1!`
}

function normalizeRedirectPath(value: string | null) {
  if (!value) {
    return '/workspace'
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) {
    return '/workspace'
  }

  if (trimmed.startsWith('//') || trimmed.includes('://')) {
    return '/workspace'
  }

  return trimmed
}

function extractSetCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers)
  }

  const cookie = headers.get('set-cookie')
  return cookie ? [cookie] : []
}

async function ensureIdentityTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS spex_identity_link (
      spex_user_id text PRIMARY KEY,
      sim_user_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
      default_workspace_id text REFERENCES workspace(id) ON DELETE SET NULL,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    )
  `)
}

async function getIdentityLink(spexUserId: string) {
  const result = await db.execute(sql`
    SELECT spex_user_id, sim_user_id, default_workspace_id
    FROM spex_identity_link
    WHERE spex_user_id = ${spexUserId}
    LIMIT 1
  `)

  return result[0] as
    | {
        spex_user_id: string
        sim_user_id: string
        default_workspace_id: string | null
      }
    | undefined
}

async function upsertIdentityLink(
  spexUserId: string,
  simUserId: string,
  defaultWorkspaceId?: string | null
) {
  await db.execute(sql`
    INSERT INTO spex_identity_link (spex_user_id, sim_user_id, default_workspace_id, created_at, updated_at)
    VALUES (${spexUserId}, ${simUserId}, ${defaultWorkspaceId ?? null}, NOW(), NOW())
    ON CONFLICT (spex_user_id)
    DO UPDATE SET
      sim_user_id = EXCLUDED.sim_user_id,
      default_workspace_id = COALESCE(EXCLUDED.default_workspace_id, spex_identity_link.default_workspace_id),
      updated_at = NOW()
  `)
}

async function resolveBootstrapToken(bootstrapToken: string): Promise<SpexBootstrapResolveResponse> {
  if (!env.SPEX_API_BASE_URL || !env.SPEX_INTERNAL_API_KEY) {
    throw new Error('SPEX_API_BASE_URL and SPEX_INTERNAL_API_KEY must be configured')
  }

  const response = await fetch(
    `${env.SPEX_API_BASE_URL.replace(/\/$/, '')}/auth/internal/sim/bootstrap/resolve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.SPEX_INTERNAL_API_KEY,
      },
      body: JSON.stringify({ bootstrapToken }),
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Bootstrap resolve failed: ${response.status} ${body}`)
  }

  return (await response.json()) as SpexBootstrapResolveResponse
}

async function findUserByEmail(email: string) {
  const result = await db.select().from(user).where(eq(user.email, email)).limit(1)
  return result[0] ?? null
}

async function synchronizeMappedUser(simUserId: string, email: string, fullName: string) {
  const conflicting = await db
    .select()
    .from(user)
    .where(and(eq(user.email, email), ne(user.id, simUserId)))
    .limit(1)

  if (conflicting.length > 0) {
    throw new Error('A different SIM account already uses this email')
  }

  await db
    .update(user)
    .set({
      name: fullName,
      email,
      normalizedEmail: email.toLowerCase(),
      emailVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(user.id, simUserId))
}

async function bootstrapSignIn(request: NextRequest, email: string, password: string) {
  const authHeaders = new Headers(request.headers)
  return auth.api.signInEmail({
    headers: authHeaders,
    body: {
      email,
      password,
    },
    returnHeaders: true,
  })
}

async function bootstrapSignUp(request: NextRequest, email: string, password: string, name: string) {
  const authHeaders = new Headers(request.headers)
  return auth.api.signUpEmail({
    headers: authHeaders,
    body: {
      email,
      password,
      name,
    },
    returnHeaders: true,
  })
}

export async function GET(request: NextRequest) {
  const bootstrapToken = request.nextUrl.searchParams.get('token')
  const redirectPath = normalizeRedirectPath(request.nextUrl.searchParams.get('redirect'))

  if (!bootstrapToken) {
    return NextResponse.redirect(new URL('/login?error=missing-bootstrap-token', request.url))
  }

  try {
    await ensureIdentityTable()

    const resolved = await resolveBootstrapToken(bootstrapToken)
    if (!resolved.email || !resolved.simLoginAllowed) {
      return NextResponse.redirect(new URL('/login?error=email-required', request.url))
    }

    const fullName =
      `${resolved.firstName || ''} ${resolved.lastName || ''}`.trim() || 'Spex User'
    const password = buildDeterministicPassword(resolved.spexUserId)
    const existingLink = await getIdentityLink(resolved.spexUserId)
    const existingEmailUser = await findUserByEmail(resolved.email)

    if (!existingLink && existingEmailUser) {
      throw new Error('Existing SIM account with same email requires migration before Spex bootstrap')
    }

    let simUserId = existingLink?.sim_user_id || null
    let authHeaders: Headers

    if (simUserId) {
      await synchronizeMappedUser(simUserId, resolved.email, fullName)
      await upsertIdentityLink(resolved.spexUserId, simUserId)
      const result = await bootstrapSignIn(request, resolved.email, password)
      authHeaders = result.headers ?? new Headers()
    } else {
      const result = await bootstrapSignUp(request, resolved.email, password, fullName)
      authHeaders = result.headers ?? new Headers()
      const createdUser = await findUserByEmail(resolved.email)
      if (!createdUser) {
        throw new Error('Failed to locate SIM user after sign up')
      }
      simUserId = createdUser.id
      await upsertIdentityLink(resolved.spexUserId, simUserId)
    }

    const workspaceRecord = await ensureDefaultWorkspaceForUser(simUserId, fullName)
    await upsertIdentityLink(resolved.spexUserId, simUserId, workspaceRecord.id)

    const response = NextResponse.redirect(new URL(redirectPath, request.url))
    for (const cookie of extractSetCookies(authHeaders)) {
      response.headers.append('set-cookie', cookie)
    }
    return response
  } catch (error) {
    logger.error('Failed to bootstrap Spex session', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.redirect(new URL('/login?error=spex-bootstrap-failed', request.url))
  }
}
