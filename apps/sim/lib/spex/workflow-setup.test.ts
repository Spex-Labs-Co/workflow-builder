import { describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import { AuthMode } from '@/blocks/types'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  getWorkflowSetupStatusForWorkflowId,
  getWorkflowSetupStatusFromBlocks,
  getWorkflowSetupStatusFromState,
} from './workflow-setup'

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
}))

const BROWSER_USE_BLOCK_CONFIG = {
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  icon: () => null,
  authMode: AuthMode.ApiKey,
  subBlocks: [{ id: 'apiKey', type: 'short-input', password: true, required: true }],
  outputs: {},
}

const GOOGLE_DRIVE_BLOCK_CONFIG = {
  name: 'Google Drive',
  description: 'Google Drive integration',
  icon: () => null,
  authMode: AuthMode.OAuth,
  subBlocks: [],
  outputs: {},
}

describe('getWorkflowSetupStatusFromBlocks', () => {
  it('returns needs_setup when a required apiKey field is empty', () => {
    ;(getBlock as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      BROWSER_USE_BLOCK_CONFIG as any
    )

    const status = getWorkflowSetupStatusFromBlocks([
      {
        id: 'block-1',
        type: 'browser_use',
        triggerMode: false,
        advancedMode: false,
        data: {},
        subBlocks: {
          apiKey: { id: 'apiKey', type: 'short-input', value: '' },
        },
      },
    ])

    expect(status).toBe('needs_setup')
  })

  it('returns ready when a required apiKey field is populated', () => {
    ;(getBlock as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      BROWSER_USE_BLOCK_CONFIG as any
    )

    const status = getWorkflowSetupStatusFromBlocks([
      {
        id: 'block-1',
        type: 'browser_use',
        triggerMode: false,
        advancedMode: false,
        data: {},
        subBlocks: {
          apiKey: { id: 'apiKey', type: 'short-input', value: 'secret-key' },
        },
      },
    ])

    expect(status).toBe('ready')
  })

  it('returns needs_setup when an oauth credential reference is missing', () => {
    ;(getBlock as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      GOOGLE_DRIVE_BLOCK_CONFIG as any
    )

    const status = getWorkflowSetupStatusFromBlocks([
      {
        id: 'block-1',
        type: 'google_drive',
        triggerMode: false,
        advancedMode: false,
        data: {},
        subBlocks: {
          credential: { id: 'credential', type: 'dropdown', value: '' },
        },
      },
    ])

    expect(status).toBe('needs_setup')
  })

  it('derives setup status from workflow state blocks', () => {
    ;(getBlock as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      BROWSER_USE_BLOCK_CONFIG as any
    )

    const status = getWorkflowSetupStatusFromState({
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'browser_use',
          triggerMode: false,
          advancedMode: false,
          data: {},
          subBlocks: {
            apiKey: { id: 'apiKey', type: 'short-input', value: 'secret-key' },
          },
        } as any,
      },
    } as any)

    expect(status).toBe('ready')
  })

  it('derives setup status from persisted workflow blocks by workflow id', async () => {
    ;(getBlock as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      BROWSER_USE_BLOCK_CONFIG as any
    )
    ;(loadWorkflowFromNormalizedTables as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'browser_use',
          triggerMode: false,
          advancedMode: false,
          data: {},
          subBlocks: {
            apiKey: { id: 'apiKey', type: 'short-input', value: 'secret-key' },
          },
        },
      },
    })

    const status = await getWorkflowSetupStatusForWorkflowId('workflow-1')

    expect(status).toBe('ready')
  })

  it('throws when workflow id cannot be resolved', async () => {
    ;(loadWorkflowFromNormalizedTables as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null
    )

    await expect(getWorkflowSetupStatusForWorkflowId('missing-workflow')).rejects.toThrow(
      'Workflow missing-workflow not found'
    )
  })
})
