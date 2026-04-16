import { db } from '@sim/db'
import { permissions, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { generateId } from '@/lib/core/utils/uuid'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getRandomWorkspaceColor } from '@/lib/workspaces/colors'

const logger = createLogger('DefaultWorkspace')

export async function ensureDefaultWorkspaceForUser(userId: string, userName?: string | null) {
  const existing = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      color: workspace.color,
      ownerId: workspace.ownerId,
      billedAccountUserId: workspace.billedAccountUserId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))
    .limit(1)

  if (existing.length > 0) {
    await ensureWorkflowsHaveWorkspace(userId, existing[0].id)
    return existing[0]
  }

  const created = await createDefaultWorkspace(userId, userName)
  await migrateExistingWorkflows(userId, created.id)
  return created
}

export async function createDefaultWorkspace(userId: string, userName?: string | null) {
  const firstName = userName?.split(' ')[0] || null
  const workspaceName = firstName ? `${firstName}'s Workspace` : 'My Workspace'
  return createWorkspaceForUser(userId, workspaceName)
}

export async function createWorkspaceForUser(
  userId: string,
  name: string,
  skipDefaultWorkflow = false,
  explicitColor?: string
) {
  const workspaceId = generateId()
  const workflowId = generateId()
  const now = new Date()
  const color = explicitColor || getRandomWorkspaceColor()

  await db.transaction(async (tx) => {
    await tx.insert(workspace).values({
      id: workspaceId,
      name,
      color,
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(permissions).values({
      id: generateId(),
      entityType: 'workspace' as const,
      entityId: workspaceId,
      userId,
      permissionType: 'admin' as const,
      createdAt: now,
      updatedAt: now,
    })

    if (!skipDefaultWorkflow) {
      await tx.insert(workflow).values({
        id: workflowId,
        userId,
        workspaceId,
        folderId: null,
        name: 'default-agent',
        description: 'Your first workflow - start building here!',
        color: '#3972F6',
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        runCount: 0,
        variables: {},
      })

      const { workflowState } = buildDefaultWorkflowArtifacts()
      await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
    }
  })

  logger.info(
    skipDefaultWorkflow
      ? `Created workspace ${workspaceId} for user ${userId}`
      : `Created workspace ${workspaceId} with initial workflow ${workflowId} for user ${userId}`
  )

  return {
    id: workspaceId,
    name,
    color,
    ownerId: userId,
    billedAccountUserId: userId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
  }
}

async function migrateExistingWorkflows(userId: string, workspaceId: string) {
  const orphanedWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length === 0) {
    return
  }

  logger.info(
    `Migrating ${orphanedWorkflows.length} workflows to workspace ${workspaceId} for user ${userId}`
  )

  await db
    .update(workflow)
    .set({
      workspaceId,
      updatedAt: new Date(),
    })
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
}

async function ensureWorkflowsHaveWorkspace(userId: string, defaultWorkspaceId: string) {
  const orphanedWorkflows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length > 0) {
    await db
      .update(workflow)
      .set({
        workspaceId: defaultWorkspaceId,
        updatedAt: new Date(),
      })
      .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
  }
}
