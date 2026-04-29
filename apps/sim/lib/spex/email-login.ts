import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { ensureDefaultWorkspaceForUser } from '@/lib/workspaces/default-workspace'

const PASSWORD_PREFIX = 'spex-email-login::'

export type SpexEmailLoginIdentity = {
  success: boolean
  spexUserId: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export function normalizeEmail(email: unknown) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

export function normalizeOtp(otp: unknown) {
  return String(otp || '').trim()
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Derives a deterministic SIM password from the Spex user ID.
 *
 * @warning This derivation depends on `BETTER_AUTH_SECRET`. Rotating that secret
 *   invalidates every Spex user's SIM session. There is no automated re-key path —
 *   coordinate with the Spex backend before any rotation.
 */
export function buildDeterministicPassword(spexUserId: string) {
  const source = `${PASSWORD_PREFIX}${spexUserId}::${env.BETTER_AUTH_SECRET}`
  const encoded = Buffer.from(source).toString('base64url')
  return `${encoded.slice(0, 48)}Aa1!`
}

function getSpexApiConfig() {
  if (!env.SPEX_API_BASE_URL || !env.SPEX_INTERNAL_API_KEY) {
    throw new Error('SPEX_API_BASE_URL and SPEX_INTERNAL_API_KEY must be configured')
  }

  return {
    baseUrl: env.SPEX_API_BASE_URL.replace(/\/$/, ''),
    apiKey: env.SPEX_INTERNAL_API_KEY,
  }
}

async function postToSpexInternal<T>(path: string, body: Record<string, unknown>) {
  const { baseUrl, apiKey } = getSpexApiConfig()
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': apiKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      typeof payload?.message === 'string' ? payload.message : 'Spex authentication failed'
    const error = new Error(message) as Error & { status?: number }
    error.status = response.status
    throw error
  }

  return payload as T
}

export async function verifySpexEmailOtp(email: string, otp: string) {
  return postToSpexInternal<SpexEmailLoginIdentity>('/auth/internal/sim/email/verify-otp', {
    email,
    otp,
  })
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

async function signInWithSpexPassword(request: NextRequest, email: string, password: string) {
  return auth.api.signInEmail({
    headers: new Headers(request.headers),
    body: { email, password },
    returnHeaders: true,
  })
}

async function signUpWithSpexPassword(
  request: NextRequest,
  email: string,
  password: string,
  name: string
) {
  return auth.api.signUpEmail({
    headers: new Headers(request.headers),
    body: { email, password, name },
    returnHeaders: true,
  })
}

export async function createSpexSimSession(request: NextRequest, identity: SpexEmailLoginIdentity) {
  const email = normalizeEmail(identity.email)
  const fullName = `${identity.firstName || ''} ${identity.lastName || ''}`.trim() || 'Spex User'
  const password = buildDeterministicPassword(identity.spexUserId)
  const existingLink = await getIdentityLink(identity.spexUserId)
  const existingEmailUser = await findUserByEmail(email)

  if (!existingLink && existingEmailUser) {
    throw new Error('Existing SIM account with same email requires migration before Spex login')
  }

  let simUserId = existingLink?.sim_user_id || null
  let authHeaders: Headers

  if (simUserId) {
    await synchronizeMappedUser(simUserId, email, fullName)
    await upsertIdentityLink(identity.spexUserId, simUserId)
    const result = await signInWithSpexPassword(request, email, password)
    authHeaders = result.headers ?? new Headers()
  } else {
    const result = await signUpWithSpexPassword(request, email, password, fullName)
    authHeaders = result.headers ?? new Headers()
    const createdUser = await findUserByEmail(email)
    if (!createdUser) {
      throw new Error('Failed to locate SIM user after sign up')
    }
    simUserId = createdUser.id
    await upsertIdentityLink(identity.spexUserId, simUserId)
  }

  const workspaceRecord = await ensureDefaultWorkspaceForUser(simUserId, fullName)
  await upsertIdentityLink(identity.spexUserId, simUserId, workspaceRecord.id)

  return { authHeaders, simUserId, workspaceId: workspaceRecord.id }
}

export function extractSetCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers)
  }

  const cookie = headers.get('set-cookie')
  return cookie ? [cookie] : []
}
