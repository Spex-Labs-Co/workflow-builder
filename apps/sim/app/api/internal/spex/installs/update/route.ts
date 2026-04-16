import { db } from '@sim/db'
import { templates, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateInternalToken } from '@/lib/auth/internal'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { generateId } from '@/lib/core/utils/uuid'
import type { RegenerateStateInput } from '@/lib/workflows/persistence/utils'
import { regenerateWorkflowStateIds } from '@/lib/workflows/persistence/utils'

const logger = createLogger('SpexInstallUpdateAPI')

const UpdateInstallSchema = z.object({
  simUserId: z.string().min(1),
  simWorkflowId: z.string().min(1),
  simTemplateId: z.string().min(1),
})

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

export async function POST(request: NextRequest) {
  const authResult = checkInternalApiKey(request)
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { simUserId, simWorkflowId, simTemplateId } = UpdateInstallSchema.parse(body)

    const templateRows = await db
      .select({
        id: templates.id,
        state: templates.state,
        details: templates.details,
        requiredCredentials: templates.requiredCredentials,
      })
      .from(templates)
      .where(eq(templates.id, simTemplateId))
      .limit(1)

    const template = templateRows[0]
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const regeneratedState = regenerateWorkflowStateIds(template.state as RegenerateStateInput)
    const variables = remapTemplateVariables(template.state as Record<string, unknown>, simWorkflowId)
    const statePayload = {
      ...regeneratedState,
      variables,
    }

    const token = await generateInternalToken(simUserId)
    const stateResponse = await fetch(
      `${getInternalApiBaseUrl()}/api/workflows/${simWorkflowId}/state`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(statePayload),
        cache: 'no-store',
      }
    )

    if (!stateResponse.ok) {
      const text = await stateResponse.text()
      logger.error('Failed to refresh installed workflow from template', {
        simUserId,
        simWorkflowId,
        simTemplateId,
        error: text,
      })
      return NextResponse.json(
        { error: 'Failed to update installed workflow', details: text },
        { status: stateResponse.status }
      )
    }

    const details = template.details as { tagline?: string } | null
    await db
      .update(workflow)
      .set({
        description: details?.tagline ?? null,
        updatedAt: new Date(),
      })
      .where(eq(workflow.id, simWorkflowId))

    return NextResponse.json({
      success: true,
      setupStatus: normalizeSetupStatus(template.requiredCredentials),
      requiredSetup: template.requiredCredentials ?? [],
    })
  } catch (error) {
    logger.error('Failed to process Spex install update', {
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
