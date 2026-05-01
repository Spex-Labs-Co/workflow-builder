import {
  buildCanonicalIndex,
  buildSubBlockValues,
  evaluateSubBlockCondition,
  hasAdvancedValues,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
  type CanonicalModeOverrides,
  type SubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import { AuthMode, type SubBlockConfig } from '@/blocks/types'

type WorkflowBlockRecord = {
  id: string
  type: string
  triggerMode?: boolean
  advancedMode?: boolean
  data?: Record<string, unknown>
  subBlocks?: Record<string, { id?: string; type?: string; value?: unknown } | null | undefined>
}

const OAUTH_SUBBLOCK_IDS = ['credential', 'triggerCredentials']

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function isSubBlockVisible(block: WorkflowBlockRecord, subBlockConfig: SubBlockConfig): boolean {
  if (!isSubBlockFeatureEnabled(subBlockConfig)) return false

  const values = buildSubBlockValues(block.subBlocks || {})
  const blockConfig = getBlock(block.type)
  const blockSubBlocks = blockConfig?.subBlocks || []
  const canonicalIndex = buildCanonicalIndex(blockSubBlocks)
  const effectiveAdvanced =
    (block.advancedMode ?? false) || hasAdvancedValues(blockSubBlocks, values, canonicalIndex)
  const canonicalModeOverrides = block.data?.canonicalModes as CanonicalModeOverrides | undefined

  if (subBlockConfig.mode === 'trigger' && !block.triggerMode) return false
  if (block.triggerMode && subBlockConfig.mode && subBlockConfig.mode !== 'trigger') return false

  if (
    !isSubBlockVisibleForMode(
      subBlockConfig,
      effectiveAdvanced,
      canonicalIndex,
      values,
      canonicalModeOverrides
    )
  ) {
    return false
  }

  return evaluateSubBlockCondition(subBlockConfig.condition as SubBlockCondition, values)
}

export function getWorkflowSetupStatusFromBlocks(
  blocks: WorkflowBlockRecord[]
): 'ready' | 'needs_setup' {
  for (const block of blocks) {
    const blockConfig = getBlock(block.type)
    if (!blockConfig) continue

    if (blockConfig.authMode === AuthMode.OAuth) {
      const hasOAuthCredential = OAUTH_SUBBLOCK_IDS.some((subBlockId) =>
        hasValue(block.subBlocks?.[subBlockId]?.value)
      )
      if (!hasOAuthCredential) {
        return 'needs_setup'
      }
    }

    for (const subBlockConfig of blockConfig.subBlocks || []) {
      if (!subBlockConfig.password) continue
      if (subBlockConfig.required === false) continue
      if (!isSubBlockVisible(block, subBlockConfig)) continue

      const subBlockValue = block.subBlocks?.[subBlockConfig.id]?.value
      if (!hasValue(subBlockValue)) {
        return 'needs_setup'
      }
    }
  }

  return 'ready'
}
