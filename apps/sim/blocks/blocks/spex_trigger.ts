import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Sparkles } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const SpexTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Sparkles, props)

export const SpexTriggerBlock: BlockConfig = {
  type: 'spex_trigger',
  triggerAllowed: true,
  singleInstance: true,
  name: 'Spex AI',
  description: 'Run this workflow when Spex AI decides to invoke it.',
  longDescription:
    'Use the Spex AI trigger for workflows that should appear as installable Spex apps/plugins. Define the tool guidance, execution mode, and structured inputs expected from the Spex runtimes.',
  bestPractices: `
  - Write a precise tool prompt so the agent knows when this workflow should be used.
  - Keep the input format minimal and stable; installed copies depend on these field names.
  - Prefer "Short running" for inline answers. Mark it "Long running" only when the workflow may need async delivery later.
  `,
  category: 'triggers',
  bgColor: '#0F766E',
  icon: SpexTriggerIcon,
  subBlocks: [
    {
      id: 'toolPrompt',
      title: 'Tool prompt',
      type: 'long-input',
      placeholder:
        'Explain when Spex AI should call this workflow and what it helps the user do.',
      description:
        'Shown to Spex runtimes so they know when this workflow is relevant for the user.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'executionMode',
      title: 'Execution mode',
      type: 'dropdown',
      options: [
        { label: 'Short running', id: 'sync' },
        { label: 'Long running', id: 'async' },
      ],
      value: () => 'sync',
      description:
        'Use short running for inline responses. Long running is for tasks that may complete later.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'inputFormat',
      title: 'Invoke params',
      type: 'input-format',
      description:
        'Define the structured params Spex AI can pass when invoking this workflow.',
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'How this trigger works',
      type: 'text',
      value: () =>
        'Spex AI invokes this workflow for installed users. The runtime sends the user request plus any structured params defined above.',
      mode: 'trigger',
      hideFromPreview: true,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    input: { type: 'string', description: 'Primary user request text from Spex AI' },
    text: { type: 'string', description: 'Alias of the primary user request text' },
    params: { type: 'json', description: 'Structured invoke params passed by Spex AI' },
    source: { type: 'string', description: 'Calling Spex runtime source' },
  },
  triggers: {
    enabled: true,
    available: ['workflow'],
  },
}
