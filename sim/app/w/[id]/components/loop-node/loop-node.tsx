import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X, PlayCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { useGeneralStore } from '@/stores/settings/general/store'
import { LoopActionBar } from './loop-action-bar'

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
  // Add state to track hover status
  const [isHovered, setIsHovered] = useState(false)
  
  // Get loop configuration values for display
  const loopType = data?.loopType || 'for'
  const iterations = data?.count || 5
  
  // Initialize node dimensions from props or defaults
  useEffect(() => {
    // Make sure we have proper width and height set
    if (id && (data.width === undefined || data.height === undefined)) {
      logger.info('Initializing loop node dimensions', { id })
      updateNodeDimensions(id, { 
        width: data.width || 800, 
        height: data.height || 1000 
      })
      
      // Also update in ReactFlow directly
      setNodes(nodes => nodes.map(node => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              width: data.width || 800,
              height: data.height || 1000
            },
            style: {
              ...node.style,
              width: data.width || 800,
              height: data.height || 1000
            }
          }
        }
        return node
      }))
    }
  }, [id, data, updateNodeDimensions, setNodes])
  
  // Handle drops directly on the loop node
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    logger.info('Drop detected within loop node:', { id, target: (e.target as HTMLElement).className })
    
    // Clean up any visual effects immediately when drop occurs
    const nodeElement = document.querySelector(`[data-id="${id}"]`);
    if (nodeElement) {
      nodeElement.classList.remove('loop-node-drag-over');
      nodeElement.classList.remove('dragging-over');
    }
    
    try {
      // Get the loop node
      const loopNode = getNode(id)
      if (!loopNode) {
        logger.error('Could not find loop node')
        return
      }

      // Get the offset of the loop node's content area (adjust if needed)
      const loopNodeDOM = document.querySelector(`[data-id="${id}"]`)
      if (!loopNodeDOM) {
        logger.error('Could not find loop node DOM element')
        return
      }
      
      // Get the drop position in client coordinates
      const clientX = e.clientX
      const clientY = e.clientY
      
      // Get the loop node's content area bounds
      const contentArea = loopNodeDOM.querySelector('[data-dragarea="true"]')
      if (!contentArea) {
        logger.error('Could not find content area in loop node')
        return
      }
      
      const contentRect = contentArea.getBoundingClientRect()
      logger.debug('Loop node content area:', { 
        left: contentRect.left, 
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height
      })
      
      // Calculate drop position relative to the content area in screen coordinates
      const screenRelativeX = clientX - contentRect.left
      const screenRelativeY = clientY - contentRect.top
      
      logger.debug('Screen relative position:', { 
        screenRelativeX, 
        screenRelativeY,
        clientX,
        clientY
      })
      
      // Convert to flow coordinates
      const dropPosition = screenToFlowPosition({
        x: clientX,
        y: clientY
      })
      
      // Calculate position relative to the loop node in flow coordinates
      const relativePosition = {
        x: screenRelativeX * Number(loopNode.style?.width || 800) / contentRect.width,
        y: screenRelativeY * Number(loopNode.style?.height || 1000) / contentRect.height
      }
      
      // Ensure the position is within reasonable bounds
      relativePosition.x = Math.max(50, Math.min(relativePosition.x, Number(loopNode.style?.width || 800) - 150))
      relativePosition.y = Math.max(50, Math.min(relativePosition.y, Number(loopNode.style?.height || 1000) - 150))
      
      // Calculate the absolute position (used for storage)
      const absolutePosition = {
        x: loopNode.position.x + relativePosition.x,
        y: loopNode.position.y + relativePosition.y
      }
      
      logger.info('Position calculations:', { 
        dropPosition,
        loopPosition: loopNode.position,
        relativePosition,
        absolutePosition,
        bounds: {
          width: loopNode.style?.width || 800,
          height: loopNode.style?.height || 1000
        }
      })

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
        
        logger.info('Updating existing block:', { 
          blockId: existingBlockId,
          relativePosition,
          absolutePosition
        })
        
        // When moving an existing block into a loop, update its position and parent relationship
        const updatedBlock = {
          ...blocks[existingBlockId],
          position: absolutePosition, // Store absolute position in the block
          data: {
            ...blocks[existingBlockId].data,
            parentId: id,
            extent: 'parent'
          }
        }
        
        // Update the store with the absolute position
        useWorkflowStore.setState(state => ({
          blocks: {
            ...state.blocks,
            [existingBlockId]: updatedBlock
          }
        }))
        
        // Update React Flow nodes with the relative position
        setNodes((nds) =>
          nds.map((node) =>
            node.id === existingBlockId
              ? {
                  ...node,
                  position: relativePosition, // Use relative position for React Flow node
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
        
        logger.info('Creating new block in loop:', {
          blockId: targetBlockId,
          parentId: id,
          relativePosition,
          absolutePosition
        })
        
        // Add the new block with proper parent relationship parameters
        // Use the absolute position for storage in the block store
        addBlock(
          targetBlockId,
          type,
          name,
          absolutePosition, // Store absolute position
          {}, // Pass an empty data object
          id, // Pass parentId as a separate parameter
          'parent' // Pass extent as a separate parameter
        )

        // Manually update the node position in ReactFlow to ensure it's displayed at the right place
        setNodes(nodes => {
          const targetNode = nodes.find(n => n.id === targetBlockId)
          if (targetNode) {
            return nodes.map(n => 
              n.id === targetBlockId
                ? { ...n, position: relativePosition } // Use relative position for display
                : n
            )
          }
          return nodes
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
            
            // Add animated effect to highlight the drop area
            nodeElement.classList.add('loop-node-drag-over');
            nodeElement.classList.add('dragging-over');
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
                
                // Add animated effect to highlight the drop area
                nodeElement.classList.add('loop-node-drag-over');
                nodeElement.classList.add('dragging-over');
                return
              }
            }
          } catch (parseError) {
            // Ignore parse errors
          }
        }
        
        nodeElement.classList.remove('loop-node-drag-over');
        nodeElement.classList.remove('dragging-over');
        setIsValidDragOver(false)
      } catch (err) {
        logger.error('Error in drag over:', { err })
        nodeElement.classList.remove('loop-node-drag-over');
        nodeElement.classList.remove('dragging-over');
        setIsValidDragOver(false)
      }
    }
    
    const handleDragLeave = () => {
      setIsValidDragOver(false)
      nodeElement.classList.remove('loop-node-drag-over');
      nodeElement.classList.remove('dragging-over');
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
  
  const handleResize = useCallback((evt: any, params: { width: number; height: number }) => {
    logger.info('Loop node resized:', { id, width: params.width, height: params.height })
    
    // Always ensure minimum dimensions
    const minWidth = 800
    const minHeight = 1000
    
    const finalWidth = Math.max(params.width, minWidth)
    const finalHeight = Math.max(params.height, minHeight)
    
    // Update both the node dimensions in workflow store 
    // AND the node style in React Flow
    updateNodeDimensions(id, { width: finalWidth, height: finalHeight })
    
    // Also update the ReactFlow node directly to ensure immediate visual feedback
    setNodes((nodes) => 
      nodes.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              width: finalWidth,
              height: finalHeight
            },
            style: {
              ...node.style,
              width: finalWidth,
              height: finalHeight
            }
          }
        }
        return node
      })
    )
    
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
            x: Math.min(node.position.x, finalWidth - 120), // 100px from right edge
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

  // Remove the problematic boundary enforcement effect
  useEffect(() => {
    // Cleanup only
    return () => {};
  }, []);

  return (
    <div 
      className="relative group-node-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <NodeResizer 
        minWidth={800} 
        minHeight={1000}
        isVisible={false}
        lineClassName="border-primary border-2"
        handleClassName="h-4 w-4 bg-primary border-primary"
        handleStyle={{ opacity: 1, visibility: 'visible', zIndex: 100 }}
        keepAspectRatio={false}
        onResize={handleResize}
      />
      <div 
        style={{
          width: data.width || 800,
          height: data.height || 1000,
          border: isValidDragOver ? '2px solid #40E0D0' : 
                  isHovered ? '2px solid #1e293b' : 
                  selected ? '2px solid #94a3b8' : 
                  '2px dashed #94a3b8',
          backgroundColor: isValidDragOver ? 'rgba(64,224,208,0.08)' : 'transparent',
          borderRadius: '8px',
          position: 'relative',
          boxShadow: isValidDragOver ? '0 0 0 3px rgba(64,224,208,0.2)' : 'none',
          overflow: 'visible', // Allow children to overflow
          transition: 'border-color 0.2s, background-color 0.2s, box-shadow 0.2s',
        }}
        className={cn(
          'transition-all duration-200 group-node',
          data?.state === 'valid' && 'border-[#40E0D0] bg-[rgba(34,197,94,0.05)]',
          isHovered && 'hover-highlight'
        )}
        onDrop={handleDrop}
        data-node-id={id}
        data-type="group"
      >
        {/* Simplified loop node header */}
        <div className="flex items-center px-3 py-2 bg-background rounded-t-lg workflow-drag-handle cursor-move border-b border-dashed border-gray-300">
          <div className="flex items-center justify-center w-6 h-6 rounded bg-[#40E0D0] mr-2">
            <RepeatIcon className="w-4 h-4 text-white" />
          </div>
          
          <div className="flex-1 flex items-center">
            <div className="font-medium text-sm">
              {data.label || 'Loop'} 
              <span className="text-xs ml-2 text-muted-foreground">
                {loopType === 'for' 
                  ? `(${iterations})` 
                  : '(For each item)'}
              </span>
            </div>
          </div>
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
            <div className="bg-[#40E0D0]/20 border border-[#40E0D0]/50 rounded-md p-2 relative hover:bg-[#40E0D0]/30 transition-colors">
              <div className="flex items-center justify-center gap-1.5">
                <PlayCircle size={16} className="text-[#40E0D0]" />
              </div>
              
              <div className="absolute -right-3 top-0 h-full flex items-center">
                <Handle
                  type="source"
                  position={Position.Right}
                  id="loop-start-source"
                  className="!bg-[#40E0D0] !w-3 !h-3 z-50"
                />
              </div>
              
              {/* Visual flow indicator */}
              <div className="absolute -right-12 top-1/2 transform -translate-y-1/2">
                <svg width="12" height="12" viewBox="0 0 12 12" className="text-[#40E0D0]/70">
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Loop Actions Sidebar */}
        <LoopActionBar nodeId={id} data={data} />

        {/* Custom resize handle visible in the bottom right corner */}
        <div
          className="absolute bottom-0 right-0 w-10 h-10 cursor-nwse-resize z-10 group hover:bg-gray-100/10 rounded-bl-lg"
          style={{
            pointerEvents: 'all',
            transform: 'translate(2px, 2px)',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Store the mouse coordinates for use after timeout
            const clientX = e.clientX;
            const clientY = e.clientY;
            const startX = clientX;
            const startY = clientY;
            
            logger.info('Resize handle clicked, looking for ReactFlow resizer:', { id });
            
            // Use a small timeout to ensure ReactFlow has fully initialized its resize handlers
            setTimeout(() => {
              try {
                // Try several selector strategies
                let resizerHandle = document.querySelector(`[data-id="${id}"] .react-flow__resize-control.bottom-right`);
                
                // If specific class selector doesn't work, try to find by position attribute
                if (!resizerHandle) {
                  const allResizeControls = document.querySelectorAll(`[data-id="${id}"] .react-flow__resize-control`);
                  logger.info(`Found ${allResizeControls.length} resize controls`);
                  
                  // Find the bottom-right handle by checking all resize controls
                  for (const control of Array.from(allResizeControls)) {
                    const rect = control.getBoundingClientRect();
                    const controlElement = control as HTMLElement;
                    const style = window.getComputedStyle(controlElement);
                    
                    // Log position info to help debug
                    logger.info('Resize control position:', { 
                      right: style.right, 
                      bottom: style.bottom,
                      transform: style.transform
                    });
                    
                    // Bottom-right handle will typically have 'right' and 'bottom' set to 0
                    if (style.right === '0px' && style.bottom === '0px') {
                      resizerHandle = control;
                      break;
                    }
                  }
                  
                  // Final fallback: just try the last resize control
                  if (!resizerHandle && allResizeControls.length > 0) {
                    resizerHandle = allResizeControls[allResizeControls.length - 1];
                  }
                }
                
                if (resizerHandle && resizerHandle instanceof HTMLElement) {
                  // Create and dispatch a mousedown event to the original resizer
                  const mouseEvent = new MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    clientX,
                    clientY,
                    button: 0,  // Left button
                    view: window
                  });
                  
                  resizerHandle.dispatchEvent(mouseEvent);
                  logger.info('Successfully triggered resize handle for loop node:', { id });
                } else {
                  // If we can't find the resize handle, implement manual resize as fallback
                  logger.warn('Could not find ReactFlow resize handle, using fallback resize:', { id });
                  
                  // Get the current node dimensions
                  const currentWidth = data.width || 800;
                  const currentHeight = data.height || 1000;
                  const minWidth = 800;
                  const minHeight = 1000;
                  
                  // Setup manual resize
                  let isDragging = true;
                  
                  const onMouseMove = (moveEvent: MouseEvent) => {
                    if (!isDragging) return;
                    
                    // Calculate new dimensions based on mouse movement
                    const deltaX = moveEvent.clientX - startX;
                    const deltaY = moveEvent.clientY - startY;
                    
                    const newWidth = Math.max(minWidth, currentWidth + deltaX);
                    const newHeight = Math.max(minHeight, currentHeight + deltaY);
                    
                    // Update node dimensions
                    handleResize(null, { width: newWidth, height: newHeight });
                  };
                  
                  const onMouseUp = () => {
                    isDragging = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                  };
                  
                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                }
              } catch (error) {
                logger.error('Error trying to activate resize handle:', { error, id });
              }
            }, 50); // Short delay to ensure DOM is ready
          }}
        >
          {/* Subtle diagonal lines indicating resize handle */}
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 14 14" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            className="opacity-40 group-hover:opacity-100 transition-opacity absolute right-1 bottom-1"
          >
            <path d="M13 13L8 8M13 3L3 13" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
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
      </div>
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 