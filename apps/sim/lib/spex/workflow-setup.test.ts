import { describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import { AuthMode } from '@/blocks/types'
import { getWorkflowSetupStatusFromBlocks } from './workflow-setup'

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
    vi.mocked(getBlock).mockReturnValueOnce(BROWSER_USE_BLOCK_CONFIG as any)

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
    vi.mocked(getBlock).mockReturnValueOnce(BROWSER_USE_BLOCK_CONFIG as any)

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
    vi.mocked(getBlock).mockReturnValueOnce(GOOGLE_DRIVE_BLOCK_CONFIG as any)

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
})
