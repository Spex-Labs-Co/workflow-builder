import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import type { SpexExecutionContext } from '@/lib/spex/types'

export type { SpexExecutionContext }

const logger = createLogger('SpexControlPlane')

type SpexSyncResult = {
  attempted: boolean
  synced: boolean
  reason?: string
  response?: unknown
}

export function extractSpexExecutionContext(input: unknown): SpexExecutionContext | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const rawContext = (input as Record<string, unknown>).spex_context
  if (!rawContext || typeof rawContext !== 'object' || Array.isArray(rawContext)) {
    return null
  }

  const spexUserId = String((rawContext as Record<string, unknown>).spexUserId || '').trim()
  if (!spexUserId) {
    return null
  }

  const installId = String((rawContext as Record<string, unknown>).installId || '').trim()
  const runtimeSource = String((rawContext as Record<string, unknown>).runtimeSource || '').trim()

  return {
    spexUserId,
    installId: installId || null,
    runtimeSource: runtimeSource || null,
  }
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

async function getSpexUserIdForSimUser(simUserId: string) {
  await ensureIdentityTable()

  const result = await db.execute(sql`
    SELECT spex_user_id
    FROM spex_identity_link
    WHERE sim_user_id = ${simUserId}
    LIMIT 1
  `)

  return (result[0] as { spex_user_id?: string } | undefined)?.spex_user_id ?? null
}

function isConfigured() {
  return Boolean(env.SPEX_API_BASE_URL && env.SPEX_INTERNAL_API_KEY)
}

async function postInternal(path: string, body: Record<string, unknown>) {
  if (!env.SPEX_API_BASE_URL || !env.SPEX_INTERNAL_API_KEY) {
    throw new Error('Spex control plane is not configured')
  }

  const response = await fetch(`${env.SPEX_API_BASE_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': env.SPEX_INTERNAL_API_KEY,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Spex control plane request failed: ${response.status} ${text}`)
  }

  return response.json()
}

export async function syncSpexTemplateSource(params: {
  simUserId: string
  simTemplateId: string
  sourceWorkflowId: string
  name: string
  description?: string | null
  requiredSetup?: unknown
  ownerSetupStatus?: 'ready' | 'needs_setup'
  visibility?: 'private' | 'public'
  bumpVersion?: boolean
  ownerEnabled?: boolean
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  const spexUserId = await getSpexUserIdForSimUser(params.simUserId)
  if (!spexUserId) {
    return { attempted: false, synced: false, reason: 'no-spex-identity-link' }
  }

  try {
    const payload: Record<string, unknown> = {
      spexUserId,
      simTemplateId: params.simTemplateId,
      sourceWorkflowId: params.sourceWorkflowId,
      name: params.name,
      description: params.description ?? null,
      requiredSetup: params.requiredSetup ?? [],
      ownerSetupStatus: params.ownerSetupStatus,
      bumpVersion: Boolean(params.bumpVersion),
    }

    if (params.visibility !== undefined) {
      payload.visibility = params.visibility
    }

    if (params.ownerEnabled !== undefined) {
      payload.ownerEnabled = params.ownerEnabled
    }

    await postInternal('/sim/internal/sources/upsert', {
      ...payload,
      simOwnerUserId: params.simUserId,
    })

    return { attempted: true, synced: true }
  } catch (error) {
    logger.error('Failed to sync Spex template source', {
      simUserId: params.simUserId,
      simTemplateId: params.simTemplateId,
      sourceWorkflowId: params.sourceWorkflowId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'source-sync-failed' }
  }
}

export async function syncSpexTemplateInstall(params: {
  simUserId: string
  simTemplateId: string
  simWorkflowId: string
  simWorkspaceId?: string | null
  requiredSetup?: unknown
  setupStatus: 'ready' | 'needs_setup'
  enabled?: boolean
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  const spexUserId = await getSpexUserIdForSimUser(params.simUserId)
  if (!spexUserId) {
    return { attempted: false, synced: false, reason: 'no-spex-identity-link' }
  }

  try {
    await postInternal('/sim/internal/installs/from-template', {
      spexUserId,
      simInstallerUserId: params.simUserId,
      simTemplateId: params.simTemplateId,
      simWorkflowId: params.simWorkflowId,
      simWorkspaceId: params.simWorkspaceId ?? null,
      requiredSetup: params.requiredSetup ?? [],
      setupStatus: params.setupStatus,
      enabled: Boolean(params.enabled),
    })

    return { attempted: true, synced: true }
  } catch (error) {
    logger.error('Failed to sync Spex template install', {
      simUserId: params.simUserId,
      simTemplateId: params.simTemplateId,
      simWorkflowId: params.simWorkflowId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'install-sync-failed' }
  }
}

export async function syncSpexInstalledWorkflowStatus(params: {
  simUserId: string
  simWorkflowId: string
  simWorkspaceId?: string | null
  setupStatus: 'ready' | 'needs_setup'
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  const spexUserId = await getSpexUserIdForSimUser(params.simUserId)
  if (!spexUserId) {
    return { attempted: false, synced: false, reason: 'no-spex-identity-link' }
  }

  try {
    if (!env.SPEX_API_BASE_URL || !env.SPEX_INTERNAL_API_KEY) {
      return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
    }

    const response = await fetch(
      `${env.SPEX_API_BASE_URL.replace(/\/$/, '')}/sim/internal/installs/by-workflow`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': env.SPEX_INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          spexUserId,
          simInstallerUserId: params.simUserId,
          simWorkflowId: params.simWorkflowId,
          simWorkspaceId: params.simWorkspaceId ?? null,
          setupStatus: params.setupStatus,
        }),
        cache: 'no-store',
      }
    )

    if (response.status === 404) {
      return { attempted: true, synced: false, reason: 'no-install-record' }
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Spex control plane request failed: ${response.status} ${text}`)
    }

    await response.json()

    return { attempted: true, synced: true }
  } catch (error) {
    logger.error('Failed to sync Spex installed workflow status', {
      simUserId: params.simUserId,
      simWorkflowId: params.simWorkflowId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'installed-status-sync-failed' }
  }
}

export async function archiveSpexTemplateSource(params: {
  simUserId: string
  simTemplateId: string
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  const spexUserId = await getSpexUserIdForSimUser(params.simUserId)
  if (!spexUserId) {
    return { attempted: false, synced: false, reason: 'no-spex-identity-link' }
  }

  try {
    await postInternal('/sim/internal/sources/archive', {
      spexUserId,
      simTemplateId: params.simTemplateId,
    })

    return { attempted: true, synced: true }
  } catch (error) {
    logger.error('Failed to archive Spex template source', {
      simUserId: params.simUserId,
      simTemplateId: params.simTemplateId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'source-archive-failed' }
  }
}

export async function reportSpexWorkflowCompletion(params: {
  executionId: string
  spexUserId: string
  installId?: string | null
  simWorkflowId: string
  simUserId?: string | null
  runtimeSource?: string | null
  status: 'completed' | 'cancelled' | 'failed' | 'expired'
  outputSummary?: string | null
  output?: unknown
  error?: string | null
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  try {
    await postInternal('/sim/internal/executions/complete', {
      executionId: params.executionId,
      spexUserId: params.spexUserId,
      installId: params.installId ?? null,
      simWorkflowId: params.simWorkflowId,
      simUserId: params.simUserId ?? null,
      runtimeSource: params.runtimeSource ?? null,
      status: params.status,
      outputSummary: params.outputSummary ?? null,
      output: params.output ?? null,
      error: params.error ?? null,
    })

    return { attempted: true, synced: true }
  } catch (error) {
    logger.error('Failed to report Spex workflow completion', {
      executionId: params.executionId,
      simWorkflowId: params.simWorkflowId,
      spexUserId: params.spexUserId,
      status: params.status,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'completion-report-failed' }
  }
}

export async function reportSpexWorkflowStarted(params: {
  executionId: string
  spexUserId: string
  installId?: string | null
  simWorkflowId: string
  simUserId?: string | null
  runtimeSource?: string | null
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  try {
    const response = await postInternal('/sim/internal/executions/start', {
      executionId: params.executionId,
      spexUserId: params.spexUserId,
      installId: params.installId ?? null,
      simWorkflowId: params.simWorkflowId,
      simUserId: params.simUserId ?? null,
      runtimeSource: params.runtimeSource ?? null,
    })

    return { attempted: true, synced: true, response }
  } catch (error) {
    logger.error('Failed to report Spex workflow start', {
      executionId: params.executionId,
      simWorkflowId: params.simWorkflowId,
      spexUserId: params.spexUserId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'start-report-failed' }
  }
}

export async function reportSpexWorkflowOutput(params: {
  executionId: string
  spexUserId: string
  installId?: string | null
  simWorkflowId: string
  runtimeSource?: string | null
  text: string
}): Promise<SpexSyncResult> {
  if (!isConfigured()) {
    return { attempted: false, synced: false, reason: 'control-plane-not-configured' }
  }

  try {
    const response = await postInternal('/sim/internal/executions/output', {
      executionId: params.executionId,
      spexUserId: params.spexUserId,
      installId: params.installId ?? null,
      simWorkflowId: params.simWorkflowId,
      runtimeSource: params.runtimeSource ?? null,
      text: params.text,
    })

    const payload = response as { sent?: boolean; reason?: string }
    return {
      attempted: true,
      synced: Boolean(payload.sent),
      reason: payload.reason,
      response,
    }
  } catch (error) {
    logger.error('Failed to report Spex workflow output', {
      executionId: params.executionId,
      simWorkflowId: params.simWorkflowId,
      spexUserId: params.spexUserId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { attempted: true, synced: false, reason: 'output-report-failed' }
  }
}
