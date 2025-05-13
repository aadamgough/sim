import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { X, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { useGeneralStore } from '@/stores/settings/general/store'
import { LoopConfigBadges } from './components/loop-config-badges'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  // const { getNodes, setNodes, screenToFlowPosition } = useReactFlow()
  const {
    updateNodeDimensions,
    addBlock,
    blocks,
    addEdge,
    updateParentId
  } = useWorkflowStore()
  
  // // State to track if a valid block is being dragged over
  // const [isValidDragOver, setIsValidDragOver] = useState(false)
  // // Add state to track hover status
  // const [isHovered, setIsHovered] = useState(false)
  
  // // Initialize node dimensions from props or defaults
  // useEffect(() => {
  //   // Make sure we have proper width and height set
  //   if (id && (data.width === undefined || data.height === undefined)) {
  //     logger.info('Initializing loop node dimensions', { id })
  //     updateNodeDimensions(id, { 
  //       width: data.width || 800, 
  //       height: data.height || 1000 
  //     })
  //   }
  // }, [id, data, updateNodeDimensions, setNodes])
  
  // // Handle drops directly on the loop node
  // const handleDrop = useCallback((e: React.DragEvent) => {
  //   e.preventDefault()
  //   e.stopPropagation()
    
  //   logger.info('Drop detected within loop node:', { 
  //     id, 
  //     dataTransferTypes: e.dataTransfer.types,
  //   })
    
  //   setIsValidDragOver(false)
    
  //   try {
  //     // Get the drop position in React-Flow coordinates
  //     const clientPoint = { x: e.clientX, y: e.clientY };
  //     const flowPoint = screenToFlowPosition(clientPoint);
      
  //     // Helper function for auto-connecting blocks
  //     const handleAutoConnect = (targetId: string, pos: { x: number, y: number }) => {
  //       // Find the loop's start node or closest block within the loop
  //       const loopStartBlocks = getNodes().filter(
  //         node => node.parentId === id && node.data?.isLoopStart
  //       )
        
  //       if (loopStartBlocks.length > 0) {
  //         // Connect from loop start block
  //         const sourceBlock = loopStartBlocks[0]
  //         addEdge({
  //           id: crypto.randomUUID(),
  //           source: sourceBlock.id,
  //           target: targetId,
  //           sourceHandle: 'loop-start-source',
  //           targetHandle: 'target',
  //           type: 'workflowEdge',
  //         })
  //       } else {
  //         // Look for closest block within the loop
  //         const loopBlocks = getNodes()
  //           .filter(node => node.parentId === id && node.id !== targetId)
  //           .map(node => ({
  //             id: node.id,
  //             position: node.position,
  //             distance: Math.sqrt(
  //               Math.pow(node.position.x - pos.x, 2) +
  //               Math.pow(node.position.y - pos.y, 2)
  //             ),
  //           }))
  //           .sort((a, b) => a.distance - b.distance)
          
  //         if (loopBlocks.length > 0) {
  //           // Connect from closest block
  //           const closestBlock = loopBlocks[0]
  //           addEdge({
  //             id: crypto.randomUUID(),
  //             source: closestBlock.id,
  //             target: targetId,
  //             sourceHandle: 'source',
  //             targetHandle: 'target',
  //             type: 'workflowEdge',
  //           })
  //         }
  //       }
  //     }
      
  //     // First check for nodes being dragged via data attribute
  //     const draggingNodeElement = document.querySelector('[data-drag-data]')
  //     if (draggingNodeElement) {
  //       const dragDataStr = draggingNodeElement.getAttribute('data-drag-data')
  //       if (dragDataStr) {
  //         try {
  //           const dragData = JSON.parse(dragDataStr)
  //           if (dragData.isExistingNode && dragData.id) {
  //             // Clear the attribute now that we've used it
  //             draggingNodeElement.removeAttribute('data-drag-data')
              
  //             // Process the existing block
  //             const existingBlockId = dragData.id
  //             if (existingBlockId && blocks[existingBlockId]) {
  //               // Check if the block is already in a different loop
  //               const existingParentId = blocks[existingBlockId].data?.parentId
  //               if (existingParentId && existingParentId !== id) {
  //                 return
  //               }
                
  //               // Update parent relationship
  //               updateParentId(existingBlockId, id, 'parent')
                
  //               // Handle auto-connect if enabled
  //               const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
  //               if (isAutoConnectEnabled) {
  //                 handleAutoConnect(existingBlockId, flowPoint)
  //               }
  //               return
  //             }
  //           }
  //         } catch (parseErr) {
  //           logger.error('Error parsing drag data:', { parseErr, dragDataStr })
  //         }
  //       }
  //     }
      
  //     // Try to get block data from dataTransfer
  //     const rawData = e.dataTransfer.getData('application/json')
  //     if (!rawData) {
  //       logger.error('No data found in drop event')
  //       return
  //     }
      
  //     const data = JSON.parse(rawData)
  //     const type = data.type || (data.data && data.data.type)
      
  //     if (!type || type === 'connectionBlock' || type === 'starter' || type === 'loop') {
  //       logger.info('Ignoring drop for unsupported block type:', { type })
  //       return
  //     }

  //     // Create a new block from the toolbar item that was dragged
  //     const blockConfig = getBlock(type)
  //     if (!blockConfig) {
  //       logger.error('Invalid block type:', { type })
  //       return
  //     }
      
  //     const blockId = crypto.randomUUID()
  //     const name = `${blockConfig.name} ${Object.values(blocks).filter((b) => b.type === type).length + 1}`
      
  //     // Add the block with parent information and let ReactFlow handle positioning
  //     addBlock(blockId, type, name, flowPoint, {
  //       parentId: id,
  //       extent: 'parent' as const
  //     })
      
  //     // Handle auto-connect for new blocks
  //     const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
  //     if (isAutoConnectEnabled) {
  //       handleAutoConnect(blockId, flowPoint)
  //     }
  //   } catch (err) {
  //     logger.error('Error handling drop on loop node:', { err })
  //   } finally {
  //     setIsValidDragOver(false)
  //   }
  // }, [id, screenToFlowPosition, addEdge, getNodes, blocks, addBlock, updateParentId])
  
  // // Handle resize with boundaries
  const handleResize = useCallback((evt: any, params: { width: number; height: number }) => {
    // Always ensure minimum dimensions
    const minWidth = 800
    const minHeight = 1000
    
    const finalWidth = Math.max(params.width, minWidth)
    const finalHeight = Math.max(params.height, minHeight)
    
    // Update node dimensions
    updateNodeDimensions(id, { width: finalWidth, height: finalHeight })
  }, [id, updateNodeDimensions])

  return (
    <div 
      className={cn(
        'relative group-node',
        data?.state === 'valid' && 'border-[#40E0D0] bg-[rgba(34,197,94,0.05)]',
      )}
      style={{
        width: data.width || 800,
        height: data.height || 1000,
        borderRadius: '8px',
        position: 'relative',
        overflow: 'visible',
        border: data?.state === 'valid' ? '2px solid #40E0D0' : '2px dashed #94a3b8',
        backgroundColor: data?.state === 'valid' ? 'rgba(34,197,94,0.05)' : 'transparent',
        transition: 'border-color 0.2s ease-in-out, background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
      }}
      // onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        try {
          // Check for toolbar items
          if (e.dataTransfer?.types.includes('application/json')) {
            const rawData = e.dataTransfer.getData('application/json');
            if (rawData) {
              const data = JSON.parse(rawData);
              const type = data.type || (data.data && data.data.type);
            }
          }
          
          // If we get here, no valid drag is happening
        } catch (err) {
          logger.error('Error checking dataTransfer:', err);
        }
      }}
      data-node-id={id}
      data-type="group"
    >
      {/* Critical drag handle that controls only the loop node movement */}
      <div 
        className="absolute top-0 left-0 right-0 h-10 workflow-drag-handle cursor-move z-10"
      />
      
      <NodeResizer 
        minWidth={800} 
        minHeight={1000}
        isVisible={true}
        lineClassName="border-primary border-2"
        handleClassName="h-4 w-4 bg-primary border-primary"
        handleStyle={{ opacity: 1, visibility: 'visible', zIndex: 100 }}
        keepAspectRatio={false}
        onResize={handleResize}
      />
      
      {/* Custom visible resize handle */}
      <div 
        className="absolute bottom-2 right-2 w-8 h-8 flex items-center justify-center z-20 text-muted-foreground cursor-se-resize"
      >
      </div>
      
      {/* Child nodes container */}
      <div 
        className="p-4 h-[calc(100%-10px)]" 
        data-dragarea="true"
        style={{
          position: 'relative',
          minHeight: '100%',
        }}
      >
        {/* Delete button - now always visible */}
        <div 
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-background/90 hover:bg-red-100 border border-border cursor-pointer z-20 shadow-sm"
          onClick={(e) => {
            e.stopPropagation();
            useWorkflowStore.getState().removeBlock(id);
          }}
        >
          <X size={14} className="text-muted-foreground hover:text-red-500" />
        </div>
        
        {/* Loop Start Block - positioned at left middle */}
        <div className="absolute top-1/2 left-10 w-28 transform -translate-y-1/2">
          <div className="bg-[#40E0D0]/20 border border-[#40E0D0]/50 rounded-md p-2 relative hover:bg-[#40E0D0]/30 transition-colors">
            <div className="flex items-center justify-center gap-1.5">
              <PlayCircle size={16} className="text-[#40E0D0]" />
            </div>
            
            <div>
              <Handle
                type="source"
                position={Position.Right}
                id="loop-start-source"
                className="!bg-[#40E0D0] !w-3 !h-3 z-40"
              />
            </div>
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
        
      {/* Output handle on right middle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-gray-400 !w-3 !h-3"
        style={{ 
          right: "-6px", 
          top: "50%",
          transform: "translateY(-50%)" 
        }}
        id="loop-end-source"
      />
      
      {/* Loop Configuration Badges */}
      <LoopConfigBadges nodeId={id} data={data} />
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 