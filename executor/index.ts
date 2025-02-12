import { getAllBlocks } from '@/blocks'
import { generateEvaluatorPrompt } from '@/blocks/blocks/evaluator'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import { BlockOutput } from '@/blocks/types'
import { BlockConfig } from '@/blocks/types'
import { executeProviderRequest } from '@/providers/service'
import { getProviderFromModel } from '@/providers/utils'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { BlockLog, ExecutionContext, ExecutionResult, Tool } from './types'

/**
 * Main executor class for running agentic workflows.
 * Handles parallel execution, state management, and special block types.
 */
export class Executor {
  constructor(
    private workflow: SerializedWorkflow,
    // Initial block states can be passed in (e.g., for resuming workflows or pre-populating data)
    private initialBlockStates: Record<string, BlockOutput> = {},
    private environmentVariables: Record<string, string> = {}
  ) {}

  /**
   * Main entry point for workflow execution.
   * Initializes context, executes blocks, and returns results.
   *
   * @param workflowId - Unique identifier for the workflow
   * @returns Promise<ExecutionResult> - Execution results including success/failure, output, and logs
   */
  async execute(workflowId: string): Promise<ExecutionResult> {
    const startTime = new Date()

    // Build the execution context: holds outputs, logs, metadata, and environment variables.
    const context: ExecutionContext = {
      workflowId,
      blockStates: new Map<string, BlockOutput>(),
      blockLogs: [],
      metadata: {
        startTime: startTime.toISOString(),
      },
      environmentVariables: this.environmentVariables,
    }

    // Pre-populate context with any initial block states.
    Object.entries(this.initialBlockStates).forEach(([blockId, output]) => {
      context.blockStates.set(blockId, output)
    })

    try {
      // Execute all blocks in parallel layers (using topological sorting).
      const lastOutput = await this.executeInParallel(context)

      const endTime = new Date()
      context.metadata.endTime = endTime.toISOString()

      return {
        success: true,
        output: lastOutput,
        metadata: {
          duration: endTime.getTime() - startTime.getTime(),
          startTime: context.metadata.startTime!,
          endTime: context.metadata.endTime!,
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      return {
        success: false,
        output: { response: {} },
        error: error.message || 'Workflow execution failed',
        logs: context.blockLogs,
      }
    }
  }

  /**
   * Executes workflow blocks layer-by-layer in parallel, handling loops and conditional paths.
   *
   * Key Features:
   * - Executes blocks with no dependencies in parallel using topological sorting
   * - Handles special blocks (router, evaluator, condition) and their path decisions
   * - Manages feedback loops with iteration limits
   * - Tracks and updates block states in the execution context
   *
   * @param context - The execution context containing block states and logs
   * @returns Promise<BlockOutput> - The output of the last executed block
   */
  private async executeInParallel(context: ExecutionContext): Promise<BlockOutput> {
    const { blocks, connections } = this.workflow

    // Track iterations per loop
    const loopIterations = new Map<string, number>()
    for (const [loopId, loop] of Object.entries(this.workflow.loops || {})) {
      loopIterations.set(loopId, 0)
    }

    // Build dependency graphs: inDegree (number of incoming edges) and adjacency (outgoing connections)
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    for (const block of blocks) {
      inDegree.set(block.id, 0)
      adjacency.set(block.id, [])
    }

    // Set to track which connections are counted in inDegree
    const countedEdges = new Set<(typeof connections)[number]>()

    // Populate inDegree and adjacency
    for (const conn of connections) {
      const sourceBlock = blocks.find((b) => b.id === conn.source)
      let countEdge = true

      if (conn.condition) {
        countEdge = false
      } else if (sourceBlock && sourceBlock.metadata?.type === 'evaluator') {
        // For evaluator edges, count the dependency only if the target block's config references the evaluator output
        const targetBlock = blocks.find((b) => b.id === conn.target)
        if (targetBlock) {
          const paramsStr = JSON.stringify(targetBlock.config.params || {})
          const evaluatorRef = `<${sourceBlock.metadata?.title?.toLowerCase().replace(/\s+/g, '')}`
          const altEvaluatorRef = `<${sourceBlock.id}`

          // If target block references evaluator output, count the edge
          if (paramsStr.includes(evaluatorRef) || paramsStr.includes(altEvaluatorRef)) {
            countEdge = true
          } else {
            // For paths that don't use evaluator output, handle via decisions
            countEdge = false
          }
        }
      }

      if (countEdge) {
        inDegree.set(conn.target, (inDegree.get(conn.target) || 0) + 1)
        countedEdges.add(conn)
      }
      adjacency.get(conn.source)?.push(conn.target)
    }

    // Function to reset inDegree for blocks in a loop
    const resetLoopBlocksDegrees = (loopId: string) => {
      const loop = this.workflow.loops?.[loopId]
      if (!loop) return

      for (const blockId of loop.nodes) {
        // For each block in the loop, recalculate its initial inDegree
        let degree = 0
        for (const conn of connections) {
          if (conn.target === blockId && loop.nodes.includes(conn.source)) {
            degree++
          }
        }
        inDegree.set(blockId, degree)
      }
    }

    // Maps for decisions
    const routerDecisions = new Map<string, string>()
    const evaluatorDecisions = new Map<string, string>()
    const activeConditionalPaths = new Map<string, string>()

    // Initial queue: all blocks with zero inDegree
    const queue: string[] = []
    for (const [blockId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(blockId)
      }
    }

    let lastOutput: BlockOutput = { response: {} }

    while (queue.length > 0) {
      const currentLayer = [...queue]
      queue.length = 0

      // Filter executable blocks
      const executableBlocks = currentLayer.filter((blockId) => {
        const block = blocks.find((b) => b.id === blockId)
        if (!block || block.enabled === false) return false

        // Check router decisions
        for (const [routerId, chosenPath] of routerDecisions) {
          if (!this.isInChosenPath(blockId, chosenPath, routerId)) return false
        }

        // Check evaluator decisions
        for (const [evaluatorId, chosenPath] of evaluatorDecisions) {
          if (!this.isInChosenPath(blockId, chosenPath, evaluatorId)) return false
        }

        // Check conditional paths
        for (const [conditionBlockId, selectedConditionId] of activeConditionalPaths) {
          const connection = connections.find(
            (conn) =>
              conn.source === conditionBlockId &&
              conn.target === blockId &&
              conn.sourceHandle?.startsWith('condition-')
          )
          if (connection) {
            const connConditionId = connection.sourceHandle?.replace('condition-', '')
            if (connConditionId !== selectedConditionId) return false
          }
        }
        return true
      })

      // Execute all blocks in the current layer in parallel
      const layerResults = await Promise.all(
        executableBlocks.map(async (blockId) => {
          const block = blocks.find((b) => b.id === blockId)
          if (!block) throw new Error(`Block ${blockId} not found`)

          const inputs = this.resolveInputs(block, context)
          const result = await this.executeBlock(block, inputs, context)
          context.blockStates.set(block.id, result)
          lastOutput = result

          if (block.metadata?.type === 'router') {
            const routerResult = result as {
              response: {
                content: string
                model: string
                tokens: { prompt: number; completion: number; total: number }
                selectedPath: { blockId: string }
              }
            }
            routerDecisions.set(block.id, routerResult.response.selectedPath.blockId)
          } else if (block.metadata?.type === 'evaluator') {
            const evaluatorResult = result as {
              response: {
                content: string
                model: string
                tokens: { prompt: number; completion: number; total: number }
                selectedPath: { blockId: string }
              }
            }
            evaluatorDecisions.set(block.id, evaluatorResult.response.selectedPath.blockId)
          } else if (block.metadata?.type === 'condition') {
            const conditionResult = result as {
              response: {
                condition: {
                  selectedConditionId: string
                  result: boolean
                }
              }
            }
            activeConditionalPaths.set(
              block.id,
              conditionResult.response.condition.selectedConditionId
            )
          }
          return blockId
        })
      )

      // Process outgoing connections and update queue
      for (const finishedBlockId of layerResults) {
        const outgoingConns = connections.filter((conn) => conn.source === finishedBlockId)

        for (const conn of outgoingConns) {
          const sourceBlock = blocks.find((b) => b.id === conn.source)

          if (sourceBlock?.metadata?.type === 'evaluator') {
            // Only add to queue if this is the chosen path
            const chosenPath = evaluatorDecisions.get(sourceBlock.id)
            if (conn.target === chosenPath) {
              // CHANGED: Don't rely on inDegree for loop targets
              const targetBlock = blocks.find((b) => b.id === conn.target)
              const isInLoop = Object.values(this.workflow.loops || {}).some((loop) =>
                loop.nodes.includes(conn.target)
              )

              if (isInLoop) {
                // If target is in a loop, queue it directly
                queue.push(conn.target)
              } else {
                // For non-loop targets, use normal inDegree logic
                const newDegree = (inDegree.get(conn.target) || 0) - 1
                inDegree.set(conn.target, newDegree)
                if (newDegree === 0) queue.push(conn.target)
              }
            }
          } else if (sourceBlock?.metadata?.type === 'router') {
            // Only add to queue if this is the chosen path
            const chosenPath = routerDecisions.get(sourceBlock.id)
            if (conn.target === chosenPath) {
              const newDegree = (inDegree.get(conn.target) || 0) - 1
              inDegree.set(conn.target, newDegree)
              if (newDegree === 0) queue.push(conn.target)
            }
          } else if (!conn.sourceHandle?.startsWith('condition-')) {
            // Normal connection
            const newDegree = (inDegree.get(conn.target) || 0) - 1
            inDegree.set(conn.target, newDegree)
            if (newDegree === 0) queue.push(conn.target)
          } else {
            // Condition connection
            const conditionId = conn.sourceHandle.replace('condition-', '')
            if (activeConditionalPaths.get(finishedBlockId) === conditionId) {
              const newDegree = (inDegree.get(conn.target) || 0) - 1
              inDegree.set(conn.target, newDegree)
              if (newDegree === 0) queue.push(conn.target)
            }
          }
        }
      }

      // Check if we need to reset any loops
      for (const [loopId, loop] of Object.entries(this.workflow.loops || {})) {
        const loopBlocks = new Set(loop.nodes)
        const executedLoopBlocks = layerResults.filter((blockId) => loopBlocks.has(blockId))

        if (executedLoopBlocks.length > 0) {
          const iterations = loopIterations.get(loopId) || 0
          if (iterations < loop.maxIterations - 1) {
            // Check if the evaluator chose a block within the loop
            const evaluatorInLoop = executedLoopBlocks.find((blockId) => {
              const block = blocks.find((b) => b.id === blockId)
              return block?.metadata?.type === 'evaluator'
            })

            if (evaluatorInLoop) {
              const chosenPath = evaluatorDecisions.get(evaluatorInLoop)
              if (chosenPath && loopBlocks.has(chosenPath)) {
                // Reset the loop blocks' inDegrees and add them back to queue if needed
                resetLoopBlocksDegrees(loopId)
                for (const blockId of loop.nodes) {
                  if (inDegree.get(blockId) === 0) {
                    queue.push(blockId)
                  }
                }
                loopIterations.set(loopId, iterations + 1)
              }
            }
          }
        }
      }
    }

    return lastOutput
  }

  /**
   * Executes a single block with appropriate tool or provider.
   * Handles different block types (router, evaluator, condition, agent).
   *
   * Process:
   * 1. Validates block state and configuration
   * 2. Executes based on block type
   * 3. Logs execution details
   * 4. Stores results in context
   *
   * @param block - Block to execute
   * @param inputs - Resolved inputs for the block
   * @param context - Current execution context
   * @returns Promise<BlockOutput> - Block execution results
   */
  private async executeBlock(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Check if block is disabled
    if (block.enabled === false) {
      throw new Error(`Cannot execute disabled block: ${block.metadata?.title || block.id}`)
    }

    const startTime = new Date()
    const blockLog: BlockLog = {
      blockId: block.id,
      blockTitle: block.metadata?.title || '',
      blockType: block.metadata?.type || '',
      startedAt: startTime.toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }

    try {
      let output: BlockOutput

      // Execute block based on its type.
      if (block.metadata?.type === 'router') {
        const routerOutput = await this.executeRouterBlock(block, context)
        output = {
          response: {
            content: routerOutput.content,
            model: routerOutput.model,
            tokens: routerOutput.tokens,
            selectedPath: routerOutput.selectedPath,
          },
        }
      } else if (block.metadata?.type === 'evaluator') {
        const evaluatorOutput = await this.executeEvaluatorBlock(block, context)
        output = {
          response: {
            content: evaluatorOutput.content,
            model: evaluatorOutput.model,
            tokens: evaluatorOutput.tokens,
            selectedPath: evaluatorOutput.selectedPath,
          },
        }
      } else if (block.metadata?.type === 'condition') {
        const conditionResult = await this.executeConditionalBlock(block, context)
        output = {
          response: {
            result: conditionResult.sourceOutput,
            content: conditionResult.content,
            condition: {
              result: conditionResult.condition,
              selectedPath: conditionResult.selectedPath,
              selectedConditionId: conditionResult.selectedConditionId,
            },
          },
        }
      } else if (block.metadata?.type === 'agent') {
        // Agent block: use a provider request.
        let responseFormat: any = undefined
        if (inputs.responseFormat) {
          try {
            responseFormat =
              typeof inputs.responseFormat === 'string'
                ? JSON.parse(inputs.responseFormat)
                : inputs.responseFormat
          } catch (error: any) {
            console.error('Error parsing responseFormat:', error)
            throw new Error('Invalid response format: ' + error.message)
          }
        }

        const model = inputs.model || 'gpt-4o'
        const providerId = getProviderFromModel(model)

        // Format tools if provided. (Rename local variable to avoid conflict with imported "tools".)
        const formattedTools = Array.isArray(inputs.tools)
          ? inputs.tools
              .map((tool: any) => {
                const blockFound = getAllBlocks().find((b: BlockConfig) => b.type === tool.type)
                const toolId = blockFound?.tools.access[0]
                if (!toolId) return null

                const toolConfig = getTool(toolId)
                if (!toolConfig) return null

                return {
                  id: toolConfig.id,
                  name: toolConfig.name,
                  description: toolConfig.description,
                  params: tool.params || {},
                  parameters: {
                    type: 'object',
                    properties: Object.entries(toolConfig.params).reduce(
                      (acc, [key, config]) => ({
                        ...acc,
                        [key]: {
                          type: config.type === 'json' ? 'object' : config.type,
                          description: config.description || '',
                          ...(key in tool.params && { default: tool.params[key] }),
                        },
                      }),
                      {}
                    ),
                    required: Object.entries(toolConfig.params)
                      .filter(([_, config]) => config.required)
                      .map(([key]) => key),
                  },
                }
              })
              .filter((t): t is NonNullable<typeof t> => t !== null)
          : []

        const response = await executeProviderRequest(providerId, {
          model,
          systemPrompt: inputs.systemPrompt,
          context:
            Array.isArray(inputs.context) === true
              ? JSON.stringify(inputs.context, null, 2)
              : inputs.context,
          tools: formattedTools.length > 0 ? formattedTools : undefined,
          temperature: inputs.temperature,
          maxTokens: inputs.maxTokens,
          apiKey: inputs.apiKey,
          responseFormat,
        })

        output = responseFormat
          ? {
              ...JSON.parse(response.content),
              tokens: response.tokens || {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              toolCalls: response.toolCalls
                ? {
                    list: response.toolCalls,
                    count: response.toolCalls.length,
                  }
                : undefined,
            }
          : {
              response: {
                content: response.content,
                model: response.model,
                tokens: response.tokens || {
                  prompt: 0,
                  completion: 0,
                  total: 0,
                },
                toolCalls: {
                  list: response.toolCalls || [],
                  count: response.toolCalls?.length || 0,
                },
              },
            }
      } else {
        // Regular tool block execution.
        const tool = getTool(block.config.tool)
        if (!tool) {
          throw new Error(`Tool not found: ${block.config.tool}`)
        }

        const result = await executeTool(block.config.tool, inputs)
        if (!result.success) {
          console.error('Tool execution failed:', result.error)
          throw new Error(result.error || `Tool ${block.config.tool} failed with no error message`)
        }
        output = { response: result.output }
      }

      // Mark block execution as successful and record timing.
      blockLog.success = true
      blockLog.output = output
      const endTime = new Date()
      blockLog.endedAt = endTime.toISOString()
      blockLog.durationMs = endTime.getTime() - startTime.getTime()
      context.blockLogs.push(blockLog)

      // Ensure block output is available in the context for downstream blocks.
      context.blockStates.set(block.id, output)
      return output
    } catch (error: any) {
      // On error: log the error, update blockLog, and rethrow.
      blockLog.success = false
      blockLog.error = error.message || 'Block execution failed'
      const endTime = new Date()
      blockLog.endedAt = endTime.toISOString()
      blockLog.durationMs = endTime.getTime() - startTime.getTime()
      context.blockLogs.push(blockLog)
      throw error
    }
  }

  /**
   * Executes a router block to determine the next execution path.
   *
   * Process:
   * 1. Resolves inputs and gets possible target blocks
   * 2. Generates and sends routing prompt to the model
   * 3. Processes response to determine chosen path
   * 4. Validates and returns routing decision
   *
   * @param block - The router block to execute
   * @param context - Current execution context
   * @returns Promise with routing result including chosen path
   */
  private async executeRouterBlock(
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<{
    content: string
    model: string
    tokens: {
      prompt: number
      completion: number
      total: number
    }
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
  }> {
    // Resolve inputs for the router block.
    const resolvedInputs = this.resolveInputs(block, context)
    const outgoingConnections = this.workflow.connections.filter((conn) => conn.source === block.id)
    const targetBlocks = outgoingConnections.map((conn) => {
      const targetBlock = this.workflow.blocks.find((b) => b.id === conn.target)
      if (!targetBlock) {
        throw new Error(`Target block ${conn.target} not found`)
      }
      return {
        id: targetBlock.id,
        type: targetBlock.metadata?.type,
        title: targetBlock.metadata?.title,
        description: targetBlock.metadata?.description,
        subBlocks: targetBlock.config.params,
        currentState: context.blockStates.get(targetBlock.id),
      }
    })

    const routerConfig = {
      prompt: resolvedInputs.prompt,
      model: resolvedInputs.model,
      apiKey: resolvedInputs.apiKey,
      temperature: resolvedInputs.temperature || 0,
    }

    const model = routerConfig.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Generate and send the router prompt.
    const response = await executeProviderRequest(providerId, {
      model: routerConfig.model,
      systemPrompt: generateRouterPrompt(routerConfig.prompt, targetBlocks),
      messages: [{ role: 'user', content: routerConfig.prompt }],
      temperature: routerConfig.temperature,
      apiKey: routerConfig.apiKey,
    })

    const chosenBlockId = response.content.trim().toLowerCase()
    const chosenBlock = targetBlocks.find((b) => b.id === chosenBlockId)
    if (!chosenBlock) {
      throw new Error(`Invalid routing decision: ${chosenBlockId}`)
    }

    const tokens = response.tokens || { prompt: 0, completion: 0, total: 0 }
    return {
      content: resolvedInputs.prompt,
      model: response.model,
      tokens: {
        prompt: tokens.prompt || 0,
        completion: tokens.completion || 0,
        total: tokens.total || 0,
      },
      selectedPath: {
        blockId: chosenBlock.id,
        blockType: chosenBlock.type || 'unknown',
        blockTitle: chosenBlock.title || 'Untitled Block',
      },
    }
  }

  /**
   * Executes an evaluator block which analyzes content against criteria and chooses a path.
   *
   * Process:
   * 1. Resolves inputs and gets possible target blocks
   * 2. Generates and sends evaluation prompt to the model
   * 3. Processes response to determine chosen path
   * 4. Stores evaluation result in context
   *
   * @param block - The evaluator block to execute
   * @param context - Current execution context
   * @returns Promise with evaluation result including chosen path
   */
  private async executeEvaluatorBlock(
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<{
    content: string
    model: string
    tokens: {
      prompt: number
      completion: number
      total: number
    }
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
  }> {
    // Resolve inputs for the evaluator block.
    const resolvedInputs = this.resolveInputs(block, context)

    // Get all possible target blocks from outgoing connections
    const outgoingConnections = this.workflow.connections.filter((conn) => conn.source === block.id)

    const targetBlocks = outgoingConnections.map((conn) => {
      const targetBlock = this.workflow.blocks.find((b) => b.id === conn.target)
      if (!targetBlock) {
        throw new Error(`Target block ${conn.target} not found`)
      }
      return {
        id: targetBlock.id,
        type: targetBlock.metadata?.type,
        title: targetBlock.metadata?.title,
        description: targetBlock.metadata?.description,
        subBlocks: targetBlock.config.params,
        currentState: context.blockStates.get(targetBlock.id),
      }
    })

    const evaluatorConfig = {
      prompt: resolvedInputs.prompt,
      content: resolvedInputs.content,
      model: resolvedInputs.model,
      apiKey: resolvedInputs.apiKey,
      temperature: resolvedInputs.temperature || 0,
    }

    const model = evaluatorConfig.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Generate and execute the evaluator prompt
    const response = await executeProviderRequest(providerId, {
      model: evaluatorConfig.model,
      systemPrompt: generateEvaluatorPrompt(
        evaluatorConfig.prompt,
        evaluatorConfig.content,
        targetBlocks
      ),
      messages: [{ role: 'user', content: evaluatorConfig.prompt }],
      temperature: evaluatorConfig.temperature,
      apiKey: evaluatorConfig.apiKey,
    })

    const chosenBlockId = response.content.trim().toLowerCase()

    const chosenBlock = targetBlocks.find((b) => b.id === chosenBlockId)
    if (!chosenBlock) {
      throw new Error(`Invalid evaluation decision: ${chosenBlockId}`)
    }

    // Store the evaluation result in the context
    const tokens = response.tokens || { prompt: 0, completion: 0, total: 0 }
    const result = {
      content: evaluatorConfig.content,
      model: response.model,
      tokens: {
        prompt: tokens.prompt || 0,
        completion: tokens.completion || 0,
        total: tokens.total || 0,
      },
      selectedPath: {
        blockId: chosenBlock.id,
        blockType: chosenBlock.type || 'unknown',
        blockTitle: chosenBlock.title || 'Untitled Block',
      },
    }

    // ADDED: Explicitly store the evaluation decision in the context
    context.blockStates.set(block.id, {
      response: result,
    })

    return result
  }

  /**
   * Determines if a block is reachable along the chosen path from a decision block.
   *
   * Uses breadth-first search to:
   * 1. Start from the chosen block
   * 2. Follow valid connections
   * 3. Skip paths from other routers/evaluators
   * 4. Check if target block is reachable
   *
   * @param blockId - ID of block to check
   * @param chosenBlockId - ID of the chosen target block
   * @param decisionBlockId - ID of the router/evaluator making the decision
   * @returns boolean - Whether the block is reachable
   */
  private isInChosenPath(blockId: string, chosenBlockId: string, decisionBlockId: string): boolean {
    const visited = new Set<string>()
    const queue = [chosenBlockId]

    // Add the decision block (router/evaluator) itself as valid
    if (blockId === decisionBlockId) {
      return true
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      // If we found the block we're looking for
      if (currentId === blockId) {
        return true
      }

      // Get all outgoing connections from current block
      const connections = this.workflow.connections.filter((conn) => conn.source === currentId)
      for (const conn of connections) {
        // Don't follow connections from other routers/evaluators
        const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
        if (
          sourceBlock?.metadata?.type !== 'router' &&
          sourceBlock?.metadata?.type !== 'evaluator'
        ) {
          queue.push(conn.target)
        }
      }
    }

    return false
  }

  /**
   * Executes a condition block that evaluates logical conditions and selects a path.
   *
   * Process:
   * 1. Parses and evaluates conditions in order (if/else-if/else)
   * 2. Uses source block's output for evaluation context
   * 3. Selects matching path based on condition result
   * 4. Stores decision in context for downstream execution
   *
   * @param block - The condition block to execute
   * @param context - Current execution context
   * @returns Promise with condition result and selected path
   */
  private async executeConditionalBlock(
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<{
    content: string
    condition: boolean
    selectedConditionId: string
    sourceOutput: BlockOutput
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
  }> {
    const conditions = JSON.parse(block.config.params.conditions)

    // Identify the source block that feeds into this condition block.
    const sourceBlockId = this.workflow.connections.find((conn) => conn.target === block.id)?.source

    if (!sourceBlockId) {
      throw new Error(`No source block found for condition block ${block.id}`)
    }

    const sourceOutput = context.blockStates.get(sourceBlockId)
    if (!sourceOutput) {
      throw new Error(`No output found for source block ${sourceBlockId}`)
    }

    const outgoingConnections = this.workflow.connections.filter((conn) => conn.source === block.id)

    let conditionMet = false
    let selectedConnection: { target: string; sourceHandle?: string } | null = null
    let selectedCondition: { id: string; title: string; value: string } | null = null

    // Evaluate conditions one by one.
    for (const condition of conditions) {
      try {
        // Resolve the condition expression using the current context.
        const resolvedCondition = this.resolveInputs(
          {
            id: block.id,
            config: { params: { condition: condition.value }, tool: block.config.tool },
            metadata: block.metadata,
            position: block.position,
            inputs: block.inputs,
            outputs: block.outputs,
            enabled: block.enabled,
          },
          context
        )
        const evalContext = {
          ...(typeof sourceOutput === 'object' && sourceOutput !== null ? sourceOutput : {}),
          agent1: sourceOutput,
        }
        conditionMet = new Function(
          'context',
          `with(context) { return ${resolvedCondition.condition} }`
        )(evalContext)

        // Cast the connection so that TypeScript knows it has a target property.
        const connection = outgoingConnections.find(
          (conn) => conn.sourceHandle === `condition-${condition.id}`
        ) as { target: string; sourceHandle?: string } | undefined

        if (connection) {
          // For if/else-if, require conditionMet to be true.
          // For else, unconditionally select it.
          if ((condition.title === 'if' || condition.title === 'else if') && conditionMet) {
            selectedConnection = connection
            selectedCondition = condition
            break
          } else if (condition.title === 'else') {
            selectedConnection = connection
            selectedCondition = condition
            break
          }
        }
      } catch (error: any) {
        console.error(`Failed to evaluate condition: ${error.message}`, {
          condition,
          error,
        })
        throw new Error(`Failed to evaluate condition: ${error.message}`)
      }
    }

    if (!selectedConnection || !selectedCondition) {
      throw new Error(`No matching path found for condition block ${block.id}`)
    }

    // Identify the target block based on the selected connection.
    const targetBlock = this.workflow.blocks.find((b) => b.id === selectedConnection!.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection!.target} not found`)
    }

    // Get the raw output from the source block's state
    const sourceBlockState = context.blockStates.get(sourceBlockId)
    if (!sourceBlockState) {
      throw new Error(`No state found for source block ${sourceBlockId}`)
    }

    // Create the block output with the source output when condition is met
    const blockOutput = {
      response: {
        result: conditionMet ? sourceBlockState : false,
        content: `Condition '${selectedCondition.title}' evaluated to ${conditionMet}`,
        condition: {
          result: conditionMet,
          selectedPath: {
            blockId: targetBlock.id,
            blockType: targetBlock.metadata?.type || '',
            blockTitle: targetBlock.metadata?.title || '',
          },
          selectedConditionId: selectedCondition.id,
        },
      },
    }

    // Store the block output in the context
    context.blockStates.set(block.id, blockOutput)

    return {
      content: `Condition '${selectedCondition.title}' chosen`,
      condition: conditionMet,
      selectedConditionId: selectedCondition.id,
      sourceOutput: sourceBlockState,
      selectedPath: {
        blockId: targetBlock.id,
        blockType: targetBlock.metadata?.type || '',
        blockTitle: targetBlock.metadata?.title || '',
      },
    }
  }

  /**
   * Resolves block input values from context and environment.
   * Handles template references and variable substitution.
   *
   * Features:
   * - Resolves block references (<blockId.property>)
   * - Resolves environment variables ({{ENV_VAR}})
   * - Handles special formatting for function blocks
   * - Validates references and paths
   *
   * @param block - Block whose inputs need resolution
   * @param context - Current execution context
   * @returns Record<string, any> - Resolved input values
   */
  private resolveInputs(block: SerializedBlock, context: ExecutionContext): Record<string, any> {
    const inputs = { ...block.config.params }

    // Create quick lookups for blocks by ID and by normalized title.
    const blockById = new Map(this.workflow.blocks.map((b) => [b.id, b]))
    const blockByName = new Map(
      this.workflow.blocks.map((b) => [
        b.metadata?.title?.toLowerCase().replace(/\s+/g, '') || '',
        b,
      ])
    )

    // Helper to resolve environment variables in a given value.
    const resolveEnvVars = (value: any): any => {
      if (typeof value === 'string') {
        const envMatches = value.match(/\{\{([^}]+)\}\}/g)
        if (envMatches) {
          let resolvedValue = value
          for (const match of envMatches) {
            const envKey = match.slice(2, -2)
            const envValue = this.environmentVariables?.[envKey]
            if (envValue === undefined) {
              throw new Error(`Environment variable "${envKey}" was not found.`)
            }
            resolvedValue = resolvedValue.replace(match, envValue)
          }
          return resolvedValue
        }
      } else if (Array.isArray(value)) {
        return value.map((item) => resolveEnvVars(item))
      } else if (value && typeof value === 'object') {
        return Object.entries(value).reduce(
          (acc, [k, v]) => ({
            ...acc,
            [k]: resolveEnvVars(v),
          }),
          {}
        )
      }
      return value
    }

    const resolvedInputs = Object.entries(inputs).reduce(
      (acc, [key, value]) => {
        if (typeof value === 'string') {
          let resolvedValue = value

          // Resolve block reference templates in the format "<blockId.property>"
          const blockMatches = value.match(/<([^>]+)>/g)
          if (blockMatches) {
            for (const match of blockMatches) {
              // e.g. "<someBlockId.response>"
              const path = match.slice(1, -1)
              const [blockRef, ...pathParts] = path.split('.')
              let sourceBlock = blockById.get(blockRef)
              if (!sourceBlock) {
                const normalized = blockRef.toLowerCase().replace(/\s+/g, '')
                sourceBlock = blockByName.get(normalized)
              }
              if (!sourceBlock) {
                throw new Error(`Block reference "${blockRef}" was not found.`)
              }
              if (sourceBlock.enabled === false) {
                throw new Error(
                  `Block "${sourceBlock.metadata?.title}" is disabled, and block "${block.metadata?.title}" depends on it.`
                )
              }
              const sourceState = context.blockStates.get(sourceBlock.id)
              if (!sourceState) {
                throw new Error(
                  `No state found for block "${sourceBlock.metadata?.title}" (ID: ${sourceBlock.id}).`
                )
              }
              // Drill into the property path.
              let replacementValue: any = sourceState
              for (const part of pathParts) {
                if (!replacementValue || typeof replacementValue !== 'object') {
                  throw new Error(
                    `Invalid path "${part}" in "${path}" for block "${block.metadata?.title}".`
                  )
                }
                // Optional: special-case formatting for response formats.
                replacementValue = replacementValue[part]
              }
              if (replacementValue !== undefined) {
                if (block.metadata?.type === 'function' && key === 'code') {
                  // For function blocks, format the code nicely.
                  resolvedValue = resolvedValue.replace(
                    match,
                    typeof replacementValue === 'object'
                      ? JSON.stringify(replacementValue, null, 2)
                      : JSON.stringify(String(replacementValue))
                  )
                } else if (key === 'context') {
                  resolvedValue =
                    typeof replacementValue === 'string'
                      ? replacementValue
                      : JSON.stringify(replacementValue, null, 2)
                } else {
                  resolvedValue = resolvedValue.replace(
                    match,
                    typeof replacementValue === 'object'
                      ? JSON.stringify(replacementValue)
                      : String(replacementValue)
                  )
                }
              } else {
                throw new Error(
                  `No value found at path "${path}" in block "${sourceBlock.metadata?.title}".`
                )
              }
            }
          }
          // Resolve environment variables.
          resolvedValue = resolveEnvVars(resolvedValue)
          try {
            if (resolvedValue.startsWith('{') || resolvedValue.startsWith('[')) {
              acc[key] = JSON.parse(resolvedValue)
            } else {
              acc[key] = resolvedValue
            }
          } catch {
            acc[key] = resolvedValue
          }
        } else {
          acc[key] = resolveEnvVars(value)
        }
        return acc
      },
      {} as Record<string, any>
    )

    return resolvedInputs
  }
}
