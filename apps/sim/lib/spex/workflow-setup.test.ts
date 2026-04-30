import { describe, expect, it } from 'vitest'
import { getWorkflowSetupStatusFromBlocks } from './workflow-setup'

describe('getWorkflowSetupStatusFromBlocks', () => {
  it('returns needs_setup when a required apiKey field is empty', () => {
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
