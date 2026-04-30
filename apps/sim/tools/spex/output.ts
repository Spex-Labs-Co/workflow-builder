import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

type SpexOutputParams = {
  text?: string
  _context?: WorkflowToolExecutionContext
}

type SpexOutputResult = {
  sent: boolean
  reason?: string
  text: string
}

function result(output: SpexOutputResult): ToolResponse {
  return {
    success: true,
    output,
  }
}

export const spexOutputTool: ToolConfig<SpexOutputParams, ToolResponse> = {
  id: 'spex_output',
  name: 'Spex Output',
  description: 'Send a text update from a running Spex workflow to the Spex phone TTS path.',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to speak to the user',
    },
  },

  request: {
    url: '',
    method: 'POST',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    if (typeof window !== 'undefined') {
      return result({ sent: false, reason: 'server_only', text: String(params.text || '').trim() })
    }

    const text = String(params.text || '').trim()
    if (!text) {
      return result({ sent: false, reason: 'empty_text', text: '' })
    }

    const context = params._context
    const spexContext = context?.spexContext
    if (!context?.executionId || !context.workflowId || !spexContext?.spexUserId) {
      return result({ sent: false, reason: 'missing_spex_context', text })
    }

    const { reportSpexWorkflowOutput } = await import('@/lib/spex/control-plane')
    const response = await reportSpexWorkflowOutput({
      executionId: context.executionId,
      spexUserId: spexContext.spexUserId,
      installId: spexContext.installId ?? null,
      simWorkflowId: context.workflowId,
      runtimeSource: spexContext.runtimeSource ?? null,
      text,
    })
    const payload = response.response as { sent?: boolean; reason?: string } | undefined

    return result({
      sent: Boolean(payload?.sent),
      reason: payload?.reason ?? response.reason,
      text,
    })
  },

  outputs: {
    sent: { type: 'boolean', description: 'Whether the backend accepted and sent the update' },
    reason: { type: 'string', description: 'Reason when the update was skipped', optional: true },
    text: { type: 'string', description: 'Text passed to Spex Output' },
  },
}
