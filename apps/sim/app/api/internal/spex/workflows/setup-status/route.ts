import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { getWorkflowSetupStatusFromBlocks } from '@/lib/spex/workflow-setup'

const SetupStatusRequestSchema = z.object({
  workflows: z
    .array(
      z.object({
        simUserId: z.string().min(1),
        simWorkflowId: z.string().min(1),
      })
    )
    .max(100),
})

export async function POST(request: NextRequest) {
  const authResult = checkInternalApiKey(request)
  if (!authResult.success) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { workflows } = SetupStatusRequestSchema.parse(body)

    if (workflows.length === 0) {
      return NextResponse.json({ success: true, statuses: [] })
    }

    const workflowIds = workflows.map((item) => item.simWorkflowId)
    const workflowRows = await db
      .select({
        id: workflow.id,
        userId: workflow.userId,
      })
      .from(workflow)
      .where(inArray(workflow.id, workflowIds))

    const allowedWorkflowIds = new Set(
      workflowRows
        .filter((row) =>
          workflows.some((item) => item.simWorkflowId === row.id && item.simUserId === row.userId)
        )
        .map((row) => row.id)
    )

    const blockRows = allowedWorkflowIds.size
      ? await db
          .select({
            workflowId: workflowBlocks.workflowId,
            id: workflowBlocks.id,
            type: workflowBlocks.type,
            triggerMode: workflowBlocks.triggerMode,
            advancedMode: workflowBlocks.advancedMode,
            data: workflowBlocks.data,
            subBlocks: workflowBlocks.subBlocks,
          })
          .from(workflowBlocks)
          .where(inArray(workflowBlocks.workflowId, [...allowedWorkflowIds]))
      : []

    const blocksByWorkflowId = new Map<string, any[]>()
    for (const block of blockRows) {
      const current = blocksByWorkflowId.get(block.workflowId) || []
      current.push(block)
      blocksByWorkflowId.set(block.workflowId, current)
    }

    const statuses = workflows.map((item) => {
      if (!allowedWorkflowIds.has(item.simWorkflowId)) {
        return {
          simWorkflowId: item.simWorkflowId,
          setupStatus: 'needs_setup' as const,
          found: false,
        }
      }

      const setupStatus = getWorkflowSetupStatusFromBlocks(
        (blocksByWorkflowId.get(item.simWorkflowId) || []) as any[]
      )

      return {
        simWorkflowId: item.simWorkflowId,
        setupStatus,
        found: true,
      }
    })

    return NextResponse.json({ success: true, statuses })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
