import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { generateId } from '@/lib/core/utils/uuid'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { extractSpexExecutionContext, reportSpexWorkflowCompletion } from '@/lib/spex/control-plane'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('TriggerWorkflowExecution')

const SPEX_WORKFLOW_TIMEOUT_MS = 5 * 60 * 1000

function summarizeOutput(output: unknown): string | null {
  if (typeof output === 'string' && output.trim()) {
    return output.trim()
  }
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    for (const key of ['text', 'response', 'message', 'result']) {
      const value = (output as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
  }
  return null
}

export function buildWorkflowCorrelation(
  payload: WorkflowExecutionPayload
): AsyncExecutionCorrelation {
  const executionId = payload.executionId || generateId()
  const requestId = payload.requestId || payload.correlation?.requestId || executionId.slice(0, 8)

  return {
    executionId,
    requestId,
    source: 'workflow',
    workflowId: payload.workflowId,
    triggerType: payload.triggerType || payload.correlation?.triggerType || 'api',
  }
}

export type WorkflowExecutionPayload = {
  workflowId: string
  userId: string
  workspaceId?: string
  input?: any
  triggerType?: CoreTriggerType
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  metadata?: Record<string, any>
  callChain?: string[]
  executionMode?: 'sync' | 'stream' | 'async'
}

/**
 * Background workflow execution job
 * @see preprocessExecution For detailed information on preprocessing checks
 * @see executeWorkflowCore For the core workflow execution logic
 */
export async function executeWorkflowJob(payload: WorkflowExecutionPayload) {
  const workflowId = payload.workflowId
  const correlation = buildWorkflowCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId
  const spexContext =
    (payload.triggerType || payload.correlation?.triggerType) === 'workflow'
      ? extractSpexExecutionContext(payload.input)
      : null

  logger.info(`[${requestId}] Starting workflow execution job: ${workflowId}`, {
    userId: payload.userId,
    triggerType: payload.triggerType,
    executionId,
  })

  const triggerType = (correlation.triggerType || 'api') as CoreTriggerType
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  try {
    const preprocessResult = await preprocessExecution({
      workflowId: payload.workflowId,
      userId: payload.userId,
      triggerType: triggerType,
      executionId: executionId,
      requestId: requestId,
      checkRateLimit: true,
      checkDeployment: true,
      loggingSession: loggingSession,
      triggerData: { correlation },
    })

    if (!preprocessResult.success) {
      logger.error(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`, {
        workflowId,
        statusCode: preprocessResult.error?.statusCode,
      })

      throw new Error(preprocessResult.error?.message || 'Preprocessing failed')
    }

    const actorUserId = preprocessResult.actorUserId!
    const workspaceId = preprocessResult.workflowRecord?.workspaceId
    if (!workspaceId) {
      throw new Error(`Workflow ${workflowId} has no associated workspace`)
    }

    logger.info(`[${requestId}] Preprocessing passed. Using actor: ${actorUserId}`)

    const workflow = preprocessResult.workflowRecord!

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId,
      userId: actorUserId,
      sessionUserId: undefined,
      workflowUserId: workflow.userId,
      triggerType: payload.triggerType || 'api',
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      callChain: payload.callChain,
      correlation,
      executionMode: payload.executionMode ?? 'async',
      spexContext: spexContext ?? undefined,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      payload.input,
      workflow.variables || {},
      []
    )

    const asyncTimeoutMs = preprocessResult.executionTimeout?.async
    const timeoutController = createTimeoutAbortController(
      spexContext
        ? Math.min(asyncTimeoutMs ?? SPEX_WORKFLOW_TIMEOUT_MS, SPEX_WORKFLOW_TIMEOUT_MS)
        : asyncTimeoutMs
    )

    let result
    try {
      result = await executeWorkflowCore({
        snapshot,
        callbacks: {},
        loggingSession,
        includeFileBase64: true,
        base64MaxBytes: undefined,
        abortSignal: timeoutController.signal,
      })
    } finally {
      timeoutController.cleanup()
    }

    if (
      result.status === 'cancelled' &&
      timeoutController.isTimedOut() &&
      timeoutController.timeoutMs
    ) {
      const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
      logger.info(`[${requestId}] Workflow execution timed out`, {
        timeoutMs: timeoutController.timeoutMs,
      })
      await loggingSession.markAsFailed(timeoutErrorMessage)
    } else {
      await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })
    }

    await loggingSession.waitForPostExecution()

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
      executionId,
    })

    if (triggerType === 'workflow' && spexContext) {
      const terminalStatus =
        result.status === 'cancelled' && timeoutController.isTimedOut()
          ? 'expired'
          : result.status === 'cancelled'
            ? 'cancelled'
            : result.success
              ? 'completed'
              : 'failed'

      await reportSpexWorkflowCompletion({
        executionId,
        spexUserId: spexContext.spexUserId,
        installId: spexContext.installId ?? null,
        simWorkflowId: workflowId,
        simUserId: actorUserId,
        runtimeSource: spexContext.runtimeSource ?? null,
        status: terminalStatus,
        outputSummary: summarizeOutput(result.output),
        output: result.output,
        error: result.success ? null : (result.error ?? null),
      })
    }

    return {
      success: result.success,
      workflowId: payload.workflowId,
      executionId,
      output: result.output,
      executedAt: new Date().toISOString(),
      metadata: payload.metadata,
    }
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, {
      error: error instanceof Error ? error.message : String(error),
      executionId,
    })

    if (wasExecutionFinalizedByCore(error, executionId)) {
      throw error
    }

    const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
    const { traceSpans } = executionResult ? buildTraceSpans(executionResult) : { traceSpans: [] }

    await loggingSession.safeCompleteWithError({
      error: {
        message: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      traceSpans,
    })

    if (triggerType === 'workflow' && spexContext) {
      await reportSpexWorkflowCompletion({
        executionId,
        spexUserId: spexContext.spexUserId,
        installId: spexContext.installId ?? null,
        simWorkflowId: workflowId,
        simUserId: payload.userId,
        runtimeSource: spexContext.runtimeSource ?? null,
        status: 'failed',
        outputSummary: null,
        output: executionResult?.output ?? null,
        error: executionResult?.error ?? (error instanceof Error ? error.message : String(error)),
      })
    }

    throw error
  }
}

export const workflowExecutionTask = task({
  id: 'workflow-execution',
  machine: 'medium-1x',
  run: executeWorkflowJob,
})
