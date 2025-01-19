import { BlockConfig } from './types'

// Import blocks
import { AgentBlock } from './blocks/agent'
import { ApiBlock } from './blocks/api'
import { FunctionBlock } from './blocks/function'

// Export blocks for ease of use
export { AgentBlock, ApiBlock, FunctionBlock }

// Registry of all block configurations
const blocks: Record<string, BlockConfig> = {
  agent: AgentBlock,
  api: ApiBlock,
  function: FunctionBlock
}

// Build a reverse mapping of tools to block types
const toolToBlockType = Object.entries(blocks).reduce((acc, [blockType, config]) => {
  config.tools.access.forEach(toolId => {
    acc[toolId] = blockType
  })
  return acc
}, {} as Record<string, string>)

// Helper functions
export const getBlock = (type: string): BlockConfig | undefined =>
  blocks[type]

export const getBlockTypeForTool = (toolId: string): string | undefined =>
  toolToBlockType[toolId]

export const getBlocksByCategory = (category: 'basic' | 'advanced'): BlockConfig[] =>
  Object.values(blocks).filter(block => block.toolbar.category === category)

export const getAllBlockTypes = (): string[] =>
  Object.keys(blocks)

export const isValidBlockType = (type: string): type is string =>
  type in blocks