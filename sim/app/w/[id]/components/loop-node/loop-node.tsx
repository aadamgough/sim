import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { deleteElements, getNode, getNodes, setNodes, screenToFlowPosition } = useReactFlow()
  const {
    removeBlock,
    updateNodeDimensions,
    addBlock,
    blocks,
    addEdge,
    updateBlockPosition
  } = useWorkflowStore()
  
  // State to track if a valid block is being dragged over
  const [isValidDragOver, setIsValidDragOver] = useState(false)
  
  // Handle drops directly on the loop node
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    logger.info('Drop detected within loop node:', { id, target: (e.target as HTMLElement).className })
    
    try {
      // Get the loop node
      const loopNode = getNode(id)
      if (!loopNode) {
        logger.error('Could not find loop node')
        return
      }

      // Get the drop position in flow coordinates
      const dropPosition = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY
      })
      
      logger.info('Drop position in flow coordinates:', { dropPosition })

      // Calculate position relative to the loop node's position in flow coordinates
      const relativePosition = {
        x: dropPosition.x - loopNode.position.x,
        y: dropPosition.y - loopNode.position.y
      }

      logger.info('Relative position within loop node:', { relativePosition })

      // Get the block data from the drag event
      const rawData = e.dataTransfer.getData('application/json')
      if (!rawData) {
        logger.error('No data found in drop event')
        return
      }
      
      const data = JSON.parse(rawData)
      const type = data.type || (data.data && data.data.type)
      
      if (!type || type === 'connectionBlock' || type === 'starter' || type === 'loop') {
        logger.info('Ignoring drop for unsupported block type:', { type })
        return
      }

      // Check if this is an existing block being moved
      const existingBlockId = data.id
      let targetBlockId: string | undefined = existingBlockId

      if (existingBlockId && blocks[existingBlockId]) {
        // Check if the block is already in a different loop
        const existingParentId = blocks[existingBlockId].data?.parentId
        if (existingParentId && existingParentId !== id) {
          logger.info('Block already belongs to another parent:', { 
            blockId: existingBlockId,
            currentParent: existingParentId,
            targetParent: id
          })
          
          // If we decide to allow moving between parents, we'd need to first remove
          // it from the original parent before adding to the new one
          // For now, let's avoid this complexity
          return
        }
        
        logger.info('Updating existing block:', { blockId: existingBlockId })
        
        // When moving an existing block into a loop, update its position and parent relationship
        const updatedBlock = {
          ...blocks[existingBlockId],
          position: relativePosition,
          data: {
            ...blocks[existingBlockId].data,
            parentId: id,
            extent: 'parent'
          }
        }
        
        // Update the store
        useWorkflowStore.setState(state => ({
          blocks: {
            ...state.blocks,
            [existingBlockId]: updatedBlock
          }
        }))
        
        // Update React Flow nodes
        setNodes((nds) =>
          nds.map((node) =>
            node.id === existingBlockId
              ? {
                  ...node,
                  position: relativePosition,
                  parentId: id,
                  extent: 'parent',
                }
              : node
          )
        )
      } else {
        // Create a new block
        targetBlockId = crypto.randomUUID()
        const blockConfig = getBlock(type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { type })
          return
        }
        
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === type).length + 1
        }`
        
        // Add the new block with proper parent relationship parameters
        addBlock(
          targetBlockId,
          type,
          name,
          relativePosition,
          {}, // Pass an empty data object
          id, // Pass parentId as a separate parameter
          'parent' // Pass extent as a separate parameter
        )

        logger.info('Added new block with parent relationship:', { 
          blockId: targetBlockId, 
          parentId: id,
          position: relativePosition 
        })
      }

      // Auto-connect if enabled
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      if (isAutoConnectEnabled && targetBlockId) {
        // Find the loop's start node or closest block within the loop
        const loopStartBlocks = getNodes().filter(
          node => node.parentId === id && node.data?.isLoopStart
        )
        
        if (loopStartBlocks.length > 0) {
          // Connect from loop start block
          const sourceBlock = loopStartBlocks[0]
          addEdge({
            id: crypto.randomUUID(),
            source: sourceBlock.id,
            target: targetBlockId,
            sourceHandle: 'loop-start-source',
            targetHandle: 'target',
            type: 'workflowEdge',
          })
        } else {
          // Look for closest block within the loop
          const loopBlocks = getNodes()
            .filter(node => node.parentId === id && node.id !== targetBlockId)
            .map(node => ({
              id: node.id,
              position: node.position,
              distance: Math.sqrt(
                Math.pow(node.position.x - relativePosition.x, 2) +
                Math.pow(node.position.y - relativePosition.y, 2)
              ),
            }))
            .sort((a, b) => a.distance - b.distance)
          
          if (loopBlocks.length > 0) {
            // Connect from closest block
            const closestBlock = loopBlocks[0]
            addEdge({
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: targetBlockId,
              sourceHandle: 'source',
              targetHandle: 'target',
              type: 'workflowEdge',
            })
          }
        }
      }
    } catch (err) {
      logger.error('Error handling drop on loop node:', { err })
    } finally {
      setIsValidDragOver(false)
    }
  }, [id, screenToFlowPosition, addEdge, getNodes, setNodes, blocks, addBlock])
  
  // Set up drag event handlers
  useEffect(() => {
    const nodeElement = document.querySelector(`[data-id="${id}"]`)
    if (!nodeElement) return
    
    const handleDragOver = (e: Event) => {
      e.preventDefault()
      
      try {
        const dragEvent = e as DragEvent
        
        // Check if we're dragging an existing node
        const target = dragEvent.target as HTMLElement
        const existingNodeElement = target.closest('.react-flow__node-workflowBlock')
        if (existingNodeElement) {
          const nodeId = existingNodeElement.getAttribute('data-id')
          if (nodeId && nodeId !== id) {
            // This is an existing node being dragged over the loop
            logger.info('Existing node dragged over loop:', { nodeId, loopId: id })
            setIsValidDragOver(true)
            return
          }
        }
        
        // Check for new nodes from toolbar
        if (dragEvent.dataTransfer?.getData) {
          try {
            const rawData = dragEvent.dataTransfer.getData('application/json')
            if (rawData) {
              const data = JSON.parse(rawData)
              // Check if it's not a starter block
              const type = data.type || (data.data && data.data.type)
              if (type && type !== 'starter' && type !== 'loop') {
                logger.info('Toolbar item dragged over loop:', { type })
                setIsValidDragOver(true)
                return
              }
            }
          } catch (parseError) {
            // Ignore parse errors
          }
        }
        setIsValidDragOver(false)
      } catch (err) {
        logger.error('Error in drag over:', { err })
        setIsValidDragOver(false)
      }
    }
    
    const handleDragLeave = () => {
      setIsValidDragOver(false)
    }
    
    nodeElement.addEventListener('dragover', handleDragOver as EventListener)
    nodeElement.addEventListener('dragleave', handleDragLeave)
    nodeElement.addEventListener('drop', handleDrop as unknown as EventListener)
    
    return () => {
      nodeElement.removeEventListener('dragover', handleDragOver as EventListener)
      nodeElement.removeEventListener('dragleave', handleDragLeave)
      nodeElement.removeEventListener('drop', handleDrop as unknown as EventListener)
    }
  }, [id, handleDrop])
  
  const handleResize = useCallback((evt: any, { width, height }: { width: number; height: number }) => {
    logger.info('Loop node resized:', { id, width, height })
    
    // Always ensure minimum dimensions
    const minWidth = 800
    const minHeight = 1000
    
    const finalWidth = Math.max(width, minWidth)
    const finalHeight = Math.max(height, minHeight)
    
    updateNodeDimensions(id, { width: finalWidth, height: finalHeight })
    
    // Update child node positions if needed
    const childNodes = getNodes().filter(node => node.parentId === id)
    if (childNodes.length > 0) {
      // Check if any child nodes need to be repositioned
      childNodes.forEach(node => {
        const rightEdge = node.position.x + 320 // Approximate node width
        const bottomEdge = node.position.y + 180 // Approximate node height
        
        // If node is outside new boundaries, reposition it
        if (rightEdge > finalWidth - 100 || bottomEdge > finalHeight - 100) {
          const newPos = {
            x: Math.min(node.position.x, finalWidth - 420), // 100px from right edge
            y: Math.min(node.position.y, finalHeight - 280), // 100px from bottom
          }
          
          // Update node position if needed
          if (newPos.x !== node.position.x || newPos.y !== node.position.y) {
            setNodes(nodes => 
              nodes.map(n => {
                if (n.id === node.id) {
                  return {
                    ...n,
                    position: newPos
                  }
                }
                return n
              })
            )
          }
        }
      })
    }
  }, [id, updateNodeDimensions, getNodes, setNodes])

  const onDelete = () => {
    // Find all child nodes to delete them as well
    const childNodeIds = getNodes()
      .filter(node => node.parentId === id)
      .map(node => node.id);
    
    logger.info('Deleting loop node and children:', { loopId: id, childCount: childNodeIds.length });
    
    // Delete the loop node (will trigger workflow store's removeBlock)
    const node = getNode(id);
    if (node) {
      deleteElements({ nodes: [node] });
      
      // Use the workflow store's removeBlock which handles cleanup properly
      removeBlock(id);
      
      // Delete any child nodes that might not be automatically cleaned up
      childNodeIds.forEach(childId => {
        removeBlock(childId);
      });
    }
  };

  return (
    <div className="relative">
      <NodeResizer 
        minWidth={800} 
        minHeight={1000}
        isVisible={selected}
        lineClassName="border-primary"
        handleClassName="h-3 w-3 bg-primary border-primary"
        keepAspectRatio={false}
        onResize={handleResize}
      />
      <div 
        style={{
          width: data.width || 800,
          height: data.height || 1000,
          border: isValidDragOver ? '2px solid #40E0D0' : selected ? '2px solid #94a3b8' : '2px dashed #94a3b8',
          backgroundColor: isValidDragOver ? 'rgba(34,197,94,0.05)' : 'transparent',
          borderRadius: '8px',
          position: 'relative',
          boxShadow: 'none',
          overflow: 'visible', // Allow children to overflow
        }}
        className={cn(
          'transition-all duration-200',
          data?.state === 'valid' && 'border-[#40E0D0] bg-[rgba(34,197,94,0.05)]'
        )}
        onDrop={handleDrop}
      >
        {/* Simple header with icon and label */}
        <div className="flex items-center px-3 py-2 bg-background rounded-t-lg workflow-drag-handle cursor-move border-b border-dashed border-gray-300">
          <div className="flex items-center justify-center w-6 h-6 rounded bg-[#40E0D0] mr-2">
            <RepeatIcon className="w-4 h-4 text-white" />
          </div>
          <div className="font-medium text-sm">
            {data.label || 'Loop'} - {data.loopType === 'for' ? `${data.count || 5} iterations` : 'For each'}
          </div>
          
          <button
            className="ml-auto p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={onDelete}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        {/* Child nodes container */}
        <div 
          className="p-4 h-[calc(100%-40px)]" 
          data-dragarea="true"
          style={{
            position: 'relative',
            minHeight: '100%',
            transform: 'none', // Ensure no transforms affect child positioning
          }}
        >
          {/* Loop Start Block - positioned at left middle */}
          <div className="absolute top-1/2 left-10 w-28 transform -translate-y-1/2">
            <div className="bg-[#40E0D0]/20 border border-[#40E0D0]/50 rounded-md p-2 relative">
              <div className="flex items-center justify-center gap-1.5">
                <PlayCircle size={16} className="text-[#40E0D0]" />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 text-center">
                {data?.loopType === 'for' ? `${data?.count || 5} iterations` : 'For each item'}
              </div>
              
              <Handle
                type="source"
                position={Position.Right}
                id="loop-start-source"
                className="!bg-[#40E0D0] !w-3 !h-3 z-50"
                style={{ 
                  right: "-6px", 
                  top: "50%",
                  transform: "translateY(-50%)"
                }}
              />
            </div>
          </div>
        </div>

        {/* Input handle on left middle */}
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 !w-3 !h-3"
          style={{ 
            left: "-6px", 
            top: "50%",
            transform: "translateY(-50%)" 
          }}
        />
      </div>
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 