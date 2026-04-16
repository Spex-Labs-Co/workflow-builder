import { db } from '@sim/db'
import { permissions, templates, user, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { generateInternalToken } from '@/lib/auth/internal'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { env } from '@/lib/core/config/env'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { generateId } from '@/lib/core/utils/uuid'
import { ensureDefaultWorkspaceForUser } from '@/lib/workspaces/default-workspace'
import type { RegenerateStateInput } from '@/lib/workflows/persistence/utils'
import { regenerateWorkflowStateIds } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { syncSpexTemplateInstall } from '@/lib/spex/control-plane'

const logger = createLogger('SpexTemplateInstallAPI')
const PASSWORD_PREFIX = 'spex-bootstrap::'

const InstallTemplateSchema = z.object({
  spexUserId: z.string().min(1),
  simTemplateId: z.string().min(1),
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
})

function buildDeterministicPassword(spexUserId: string) {
  const source = `${PASSWORD_PREFIX}${spexUserId}::${env.BETTER_AUTH_SECRET}`
  const encoded = Buffer.from(source).toString('base64url')
  return `${encoded.slice(0, 48)}Aa1!`
}

function normalizeSetupStatus(requiredCredentials: unknown): 'ready' | 'needs_setup' {
  if (Array.isArray(requiredCredentials)) {
    return requiredCredentials.length > 0 ? 'needs_setup' : 'ready'
  }

  if (requiredCredentials && typeof requiredCredentials === 'object') {
    return Object.keys(requiredCredentials as Record<string, unknown>).length > 0
      ? 'needs_setup'
      : 'ready'
  }

  return 'ready'
}

function remapTemplateVariables(
  templateState: { variables?: Record<string, unknown> } | null | undefined,
  workflowId: string
) {
  const templateVariables = templateState?.variables
  if (!templateVariables || typeof templateVariables !== 'object') {
    return {}
  }

  const mapped: Record<string, unknown> = {}
  for (const [, variable] of Object.entries(templateVariables)) {
    const newVarId = generateId()
    mapped[newVarId] = {
      ...(variable as Record<string, unknown>),
      id: newVarId,
      workflowId,
    }
  }
  return mapped
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

async function findUserByEmail(email: string) {
  const result = await db.select().from(user).where(eq(user.email, email)).limit(1)
  return result[0] ?? null
}

async function synchronizeMappedUser(simUserId: string, email: string, fullName: string) {
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

async function resolveDefaultWorkspace(simUserId: string, spexUserId: string) {
  await ensureIdentityTable()

  const identity = await getIdentityLink(spexUserId)
  if (!identity || identity.sim_user_id !== simUserId) {
    return null
  }

  if (identity.default_workspace_id) {
    const permission = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, simUserId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, identity.default_workspace_id)
        )
      )
      .limit(1)

    if (permission.length > 0) {
      return identity.default_workspace_id
    }
  }

  const [simUserRecord] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, simUserId))
    .limit(1)

  const workspaceRecord = await ensureDefaultWorkspaceForUser(simUserId, simUserRecord?.name ?? null)
  await upsertIdentityLink(spexUserId, simUserId, workspaceRecord.id)
  return workspaceRecord.id
}

async function ensureMappedSimUser({
  spexUserId,
  email,
  fullName,
}: {
  spexUserId: string
  email: string
  fullName: string
}) {
  await ensureIdentityTable()

  const existingIdentity = await getIdentityLink(spexUserId)
  if (existingIdentity?.sim_user_id) {
    await synchronizeMappedUser(existingIdentity.sim_user_id, email, fullName)
    return existingIdentity.sim_user_id
  }

  const existingEmailUser = await findUserByEmail(email)
  if (existingEmailUser) {
    await synchronizeMappedUser(existingEmailUser.id, email, fullName)
    await upsertIdentityLink(spexUserId, existingEmailUser.id)
    return existingEmailUser.id
  }

  const password = buildDeterministicPassword(spexUserId)
  await auth.api.signUpEmail({
    headers: new Headers(),
    body: {
      email,
      password,
      name: fullName,
    },
  })

  const createdUser = await findUserByEmail(email)
  if (!createdUser) {
    throw new Error('Failed to provision SIM user for Spex install')
  }

  await upsertIdentityLink(spexUserId, createdUser.id)
  return createdUser.id
}

export async function POST(request: NextRequest) {
  const authResult = checkInternalApiKey(request)
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { spexUserId, simTemplateId, email, firstName, lastName } =
      InstallTemplateSchema.parse(body)

    await ensureIdentityTable()

    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Spex User'

    let simUserId: string
    const identity = await getIdentityLink(spexUserId)
    if (identity?.sim_user_id) {
      simUserId = identity.sim_user_id
      if (email) {
        await synchronizeMappedUser(simUserId, email, fullName)
      }
    } else {
      if (!email) {
        return NextResponse.json(
          { error: 'Email verification required before installing SIM workflows' },
          { status: 400 }
        )
      }
      simUserId = await ensureMappedSimUser({ spexUserId, email, fullName })
    }

    const workspaceId = await resolveDefaultWorkspace(simUserId, spexUserId)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace available for install' }, { status: 400 })
    }

    const templateRows = await db
      .select({
        id: templates.id,
        name: templates.name,
        details: templates.details,
        state: templates.state,
        requiredCredentials: templates.requiredCredentials,
      })
      .from(templates)
      .where(eq(templates.id, simTemplateId))
      .limit(1)

    const template = templateRows[0]
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const newWorkflowId = generateId()
    const now = new Date()
    const remappedVariables = remapTemplateVariables(
      template.state as Record<string, unknown> | undefined,
      newWorkflowId
    )
    const rawName = `${template.name} (copy)`
    const dedupedName = await deduplicateWorkflowName(rawName, workspaceId, null)

    await db.insert(workflow).values({
      id: newWorkflowId,
      workspaceId,
      name: dedupedName,
      description: (template.details as { tagline?: string } | null)?.tagline || null,
      userId: simUserId,
      variables: remappedVariables,
      createdAt: now,
      updatedAt: now,
      lastSynced: now,
      isDeployed: false,
    })

    const templateState = template.state as RegenerateStateInput
    const workflowState = regenerateWorkflowStateIds(templateState)
    const workflowStateWithVariables = {
      ...workflowState,
      variables: remappedVariables,
    }

    const token = await generateInternalToken(simUserId)
    const stateResponse = await fetch(`${getInternalApiBaseUrl()}/api/workflows/${newWorkflowId}/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(workflowStateWithVariables),
      cache: 'no-store',
    })

    if (!stateResponse.ok) {
      const text = await stateResponse.text()
      logger.error('Failed to create installed workflow from template', {
        simUserId,
        simTemplateId,
        workspaceId,
        error: text,
      })
      await db.delete(workflow).where(eq(workflow.id, newWorkflowId))
      return NextResponse.json(
        { error: 'Failed to create workflow from template', details: text },
        { status: stateResponse.status }
      )
    }

    const setupStatus = normalizeSetupStatus(template.requiredCredentials)
    const enabled = setupStatus === 'ready'

    await syncSpexTemplateInstall({
      simUserId,
      simTemplateId,
      simWorkflowId: newWorkflowId,
      simWorkspaceId: workspaceId,
      requiredSetup: template.requiredCredentials ?? [],
      setupStatus,
      enabled,
    })

    return NextResponse.json({
      success: true,
      simUserId,
      workspaceId,
      workflowId: newWorkflowId,
      setupStatus,
      requiredSetup: template.requiredCredentials ?? [],
      enabled,
    })
  } catch (error) {
    logger.error('Failed to process Spex template install', {
      error: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
