import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Volume2 } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const SpexOutputIcon = (props: SVGProps<SVGSVGElement>) => createElement(Volume2, props)

export const SpexOutputBlock: BlockConfig = {
  type: 'spex_output',
  name: 'Spex Output',
  description: 'Send a spoken Spex workflow update.',
  longDescription:
    'Use Spex Output inside Spex workflows to send progress or final text updates through the Spex phone notification/TTS path while the workflow continues.',
  bestPractices: `
  - Keep messages concise and user-facing.
  - Use this only for text the user should hear.
  - Avoid rapid repeated updates; Spex skips outputs sent too close together.
  `,
  category: 'tools',
  bgColor: '#0F766E',
  icon: SpexOutputIcon,
  subBlocks: [
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Tell the user what is happening or what is ready.',
      description: 'Text sent to the phone for TTS while the workflow is still running.',
      required: true,
    },
  ],
  tools: {
    access: ['spex_output'],
    config: {
      tool: () => 'spex_output',
    },
  },
  inputs: {
    text: { type: 'string', description: 'Text to speak to the Spex user' },
  },
  outputs: {
    sent: { type: 'boolean', description: 'Whether the backend accepted and sent the update' },
    reason: { type: 'string', description: 'Reason when the update was skipped' },
    text: { type: 'string', description: 'Text passed to Spex Output' },
  },
}
