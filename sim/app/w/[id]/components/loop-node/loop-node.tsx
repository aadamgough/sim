import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X, PlayCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { useGeneralStore } from '@/stores/settings/general/store'
import { LoopConfigBadges } from './components/loop-config-badges'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { getNode, getNodes, setNodes, screenToFlowPosition } = useReactFlow()
  const {
    updateNodeDimensions,
    addBlock,
    blocks,
    addEdge,
    updateParentId
  } = useWorkflowStore()
  
  // State to track if a valid block is being dragged over
  const [isValidDragOver, setIsValidDragOver] = useState(false)
  // Add state to track hover status
  const [isHovered, setIsHovered] = useState(false)
  
  // Get loop configuration values for display
  const loopType = data?.loopType || 'for'
  const iterations = data?.count || 5
  
  // Helper function to refresh ReactFlow nodes when parent-child relationships change
  const refreshReactFlowNodesWithCorrectParentage = useCallback((targetNodeId: string) => {
    logger.info('Refreshing ReactFlow nodes to ensure correct parent-child relationships:', { targetNodeId });
    
    // Get the current block state
    const currentBlock = blocks[targetNodeId];
    if (!currentBlock) {
      logger.warn('Block not found in store for refresh:', { targetNodeId });
      return;
    }
    
    // Only proceed if this block should be a child of the loop
    if (currentBlock.data?.parentId !== id) {
      logger.warn('Block does not have the expected parent ID:', {
        blockId: targetNodeId,
        expectedParentId: id,
        actualParentId: currentBlock.data?.parentId
      });
      return;
    }
    
    // Get the parent node
    const parentNode = blocks[id];
    if (!parentNode) {
      logger.warn('Parent node not found for refresh:', { parentId: id });
      return;
    }
    
    // Calculate the correct relative position
    const absolutePosition = currentBlock.position;
    const relativePosition = {
      x: absolutePosition.x - parentNode.position.x,
      y: absolutePosition.y - parentNode.position.y
    };
    
    logger.info('Calculated relative position for child node:', {
      blockId: targetNodeId,
      absolutePosition,
      parentPosition: parentNode.position,
      relativePosition
    });
    
    // Update the ReactFlow nodes directly
    setNodes(nodes => {
      // Find if the node already exists in ReactFlow
      const existingNodeIndex = nodes.findIndex(n => n.id === targetNodeId);
      if (existingNodeIndex === -1) {
        logger.warn('Node not found in ReactFlow for refresh:', { nodeId: targetNodeId });
        return nodes;
      }
      
      // Update the node with correct parent relationship and position
      const updatedNodes = [...nodes];
      updatedNodes[existingNodeIndex] = {
        ...updatedNodes[existingNodeIndex],
        position: relativePosition,
        parentId: id,
        extent: 'parent' as const
      };
      
      logger.info('Updated ReactFlow node with parent relationship:', {
        nodeId: targetNodeId,
        position: relativePosition,
        parentId: id
      });
      
      return updatedNodes;
    });
  }, [id, blocks, setNodes]);
  
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
    
    logger.info('Drop detected within loop node:', { 
      id, 
      target: (e.target as HTMLElement).className,
      clientX: e.clientX,
      clientY: e.clientY,
      dataTransferTypes: e.dataTransfer.types,
      hasDataAttribute: !!document.querySelector('[data-drag-data]')
    })
    
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
      
      // Calculate position relative to the loop node in flow coordinates
      const relativePosition = {
        x: screenRelativeX * Number(loopNode.style?.width || 800) / contentRect.width,
        y: screenRelativeY * Number(loopNode.style?.height || 1000) / contentRect.height
      }
      
      // Ensure the position is within reasonable bounds
      relativePosition.x = Math.max(50, Math.min(relativePosition.x, Number(loopNode.style?.width || 800)))
      relativePosition.y = Math.max(50, Math.min(relativePosition.y, Number(loopNode.style?.height || 1000)))
      
      // Calculate the absolute position (used for storage)
      const absolutePosition = {
        x: loopNode.position.x + relativePosition.x,
        y: loopNode.position.y + relativePosition.y
      }
      
      // Helper function for auto-connecting blocks
      const handleAutoConnect = (targetId: string, pos: { x: number, y: number }) => {
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
            target: targetId,
            sourceHandle: 'loop-start-source',
            targetHandle: 'target',
            type: 'workflowEdge',
          })
        } else {
          // Look for closest block within the loop
          const loopBlocks = getNodes()
            .filter(node => node.parentId === id && node.id !== targetId)
            .map(node => ({
              id: node.id,
              position: node.position,
              distance: Math.sqrt(
                Math.pow(node.position.x - pos.x, 2) +
                Math.pow(node.position.y - pos.y, 2)
              ),
            }))
            .sort((a, b) => a.distance - b.distance)
          
          if (loopBlocks.length > 0) {
            // Connect from closest block
            const closestBlock = loopBlocks[0]
            addEdge({
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: targetId,
              sourceHandle: 'source',
              targetHandle: 'target',
              type: 'workflowEdge',
            })
          }
        }
      }
      
      // First check for nodes being dragged via our custom attribute
      const draggingNodeElement = document.querySelector('[data-drag-data]')
      if (draggingNodeElement) {
        const dragDataStr = draggingNodeElement.getAttribute('data-drag-data')
        logger.info('Found element with drag data during drop:', {
          nodeId: draggingNodeElement.getAttribute('data-id'),
          dragDataStr
        })
        
        if (dragDataStr) {
          try {
            const dragData = JSON.parse(dragDataStr)
            logger.info('Parsed drag data during drop:', { dragData })
            
            if (dragData.isExistingNode && dragData.id) {
              // Clear the attribute now that we've used it
              draggingNodeElement.removeAttribute('data-drag-data')
              logger.info('Cleared drag data attribute')
              
              // Process the existing block
              const existingBlockId = dragData.id
              
              if (existingBlockId && blocks[existingBlockId]) {
                logger.info('Found existing block in store:', {
                  blockId: existingBlockId,
                  blockType: blocks[existingBlockId].type,
                  blockName: blocks[existingBlockId].name,
                  blockPos: blocks[existingBlockId].position
                })
                
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
                
                logger.info('Updating existing dragged block:', { 
                  blockId: existingBlockId,
                  relativePosition,
                  absolutePosition,
                  newParentId: id
                })
                
                // Use the dedicated function to update parent ID, which handles all the position calculations
                logger.info('Calling updateParentId from drop handler:', {
                  blockId: existingBlockId,
                  parentId: id,
                  extent: 'parent'
                })
                updateParentId(existingBlockId, id, 'parent')
                
                // Refresh the ReactFlow node after a delay to ensure store updates are complete
                setTimeout(() => {
                  refreshReactFlowNodesWithCorrectParentage(existingBlockId);
                }, 100);
                
                // Handle auto-connect if enabled
                const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
                if (isAutoConnectEnabled) {
                  logger.info('Auto-connecting block in loop')
                  handleAutoConnect(existingBlockId, relativePosition);
                }
                
                return;
              } else {
                logger.warn('Block from drag data not found in store:', {
                  blockId: existingBlockId,
                  availableBlockIds: Object.keys(blocks)
                })
              }
            }
          } catch (parseErr) {
            logger.error('Error parsing drag data:', { parseErr, dragDataStr });
          }
        }
      } else {
        logger.info('No element with drag-data found during drop')
      }
      
      // Try to get block data from dataTransfer
      let targetBlockId: string | undefined;
      
      // If there was no drag-data, try to get the block data from the drag event
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
      targetBlockId = existingBlockId

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
        
        // Use the dedicated function to update parent ID, which handles all the position calculations
        updateParentId(existingBlockId, id, 'parent')

        // Refresh the ReactFlow node after a delay to ensure store updates are complete
        setTimeout(() => {
          refreshReactFlowNodesWithCorrectParentage(existingBlockId);
        }, 100);
      } else {
        // Create a new block from the toolbar item that was dragged
        logger.info('Creating new block from drag:', { type, position: absolutePosition })
        
        const blockConfig = getBlock(type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { type })
          return
        }
        
        const blockId = crypto.randomUUID()
        const name = `${blockConfig.name} ${Object.values(blocks).filter((b) => b.type === type).length + 1}`
        
        // Add the block with parent information
        addBlock(blockId, type, name, absolutePosition, {
          parentId: id,
          extent: 'parent' as const
        })
        
        targetBlockId = blockId
        
        // Update React Flow nodes to make sure the new node is properly positioned
        setTimeout(() => {
          setNodes((nds) => {
            const newNodeIndex = nds.findIndex(node => node.id === blockId)
            if (newNodeIndex !== -1) {
              const updatedNodes = [...nds]
              updatedNodes[newNodeIndex] = {
                ...updatedNodes[newNodeIndex],
                position: relativePosition,
              }
              return updatedNodes
            }
            return nds
          })
        }, 50)
      }

      // Handle auto-connect for new blocks
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      if (isAutoConnectEnabled && targetBlockId) {
        handleAutoConnect(targetBlockId, relativePosition);
      }
    } catch (err) {
      logger.error('Error handling drop on loop node:', { err })
    } finally {
      setIsValidDragOver(false)
    }
  }, [id, screenToFlowPosition, addEdge, getNodes, setNodes, blocks, addBlock, updateParentId, refreshReactFlowNodesWithCorrectParentage])
  
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
            logger.info('Existing node dragged over loop via DOM traversal:', { 
              nodeId, 
              loopId: id,
              target: (target as HTMLElement).className
            })
            setIsValidDragOver(true)
            
            // Add animated effect to highlight the drop area
            nodeElement.classList.add('loop-node-drag-over');
            nodeElement.classList.add('dragging-over');
            return
          }
        }
        
        // Check for nodes being dragged using our custom attribute
        const draggingNodeElement = document.querySelector('[data-drag-data]')
        if (draggingNodeElement) {
          const nodeId = draggingNodeElement.getAttribute('data-id')
          if (nodeId && nodeId !== id) {
            const dragData = draggingNodeElement.getAttribute('data-drag-data')
            if (dragData) {
              try {
                const parsedData = JSON.parse(dragData)
                logger.info('Found node with drag data:', {
                  nodeId,
                  loopId: id,
                  dragData: parsedData
                })
                
                if (parsedData.isExistingNode && parsedData.type && parsedData.type !== 'starter' && parsedData.type !== 'loop') {
                  // This is an existing node being dragged from the canvas
                  logger.info('Existing node with drag data being dragged over loop:', { 
                    nodeId, 
                    loopId: id, 
                    data: parsedData 
                  })
                  setIsValidDragOver(true)
                  nodeElement.classList.add('loop-node-drag-over');
                  nodeElement.classList.add('dragging-over');
                  return
                }
              } catch (parseError) {
                // Ignore JSON parse errors
                logger.error('Error parsing drag data during dragover:', { parseError, dragData })
              }
            }
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
  
  // Clean up any leftover drag data attributes when component unmounts
  useEffect(() => {
    return () => {
      // Clean up any nodes with drag-data when component is unmounted
      const nodeWithDragData = document.querySelector('[data-drag-data]');
      if (nodeWithDragData) {
        logger.info('Cleaning up leftover drag data on unmount');
        nodeWithDragData.removeAttribute('data-drag-data');
      }
    };
  }, []);
  
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
        
        // Only reposition nodes that are completely outside the boundaries
        if (node.position.x > finalWidth || node.position.y > finalHeight) {
          const newPos = {
            // Keep x position if possible, only constrain if completely outside
            x: node.position.x > finalWidth ? finalWidth - 20 : node.position.x,
            // Keep y position if possible, only constrain if completely outside
            y: node.position.y > finalHeight ? finalHeight - 20 : node.position.y,
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

  // Remove the problematic boundary enforcement effect
  useEffect(() => {
    // Cleanup only
    return () => {};
  }, []);

  return (
    <div className="relative group">
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
          }}
          className={cn(
            'group-node',
            data?.state === 'valid' && 'border-[#40E0D0] bg-[rgba(34,197,94,0.05)]',
            isHovered && 'hover-highlight',
            isValidDragOver && 'drag-highlight'
          )}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            const dragEvent = e.nativeEvent;
            
            // Check if we're dragging an existing node with custom attribute
            const draggingNodeElement = document.querySelector('[data-drag-data]');
            if (draggingNodeElement) {
              const nodeId = draggingNodeElement.getAttribute('data-id');
              if (nodeId && nodeId !== id) {
                const dragData = draggingNodeElement.getAttribute('data-drag-data');
                if (dragData) {
                  try {
                    const parsedData = JSON.parse(dragData);
                    logger.info('React onDragOver found node with drag data:', {
                      nodeId,
                      loopId: id,
                      dragData: parsedData
                    });
                    
                    if (parsedData.isExistingNode && parsedData.type) {
                      setIsValidDragOver(true);
                      // Highlight effect
                      const nodeElement = document.querySelector(`[data-id="${id}"]`);
                      if (nodeElement) {
                        nodeElement.classList.add('loop-node-drag-over');
                        nodeElement.classList.add('dragging-over');
                      }
                      return;
                    }
                  } catch (err) {
                    logger.error('Error parsing drag data:', err);
                  }
                }
              }
            }
            
            // Also check for toolbar items
            try {
              if (dragEvent.dataTransfer?.types.includes('application/json')) {
                const rawData = dragEvent.dataTransfer.getData('application/json');
                if (rawData) {
                  const data = JSON.parse(rawData);
                  const type = data.type || (data.data && data.data.type);
                  logger.info('Toolbar item dragged over loop:', { type });
                  
                  if (type && type !== 'starter' && type !== 'loop' && type !== 'connectionBlock') {
                    setIsValidDragOver(true);
                    // Highlight effect
                    const nodeElement = document.querySelector(`[data-id="${id}"]`);
                    if (nodeElement) {
                      nodeElement.classList.add('loop-node-drag-over');
                      nodeElement.classList.add('dragging-over');
                    }
                    return;
                  }
                }
              }
            } catch (err) {
              logger.error('Error checking dataTransfer:', err);
            }
            
            // If we get here, no valid drag is happening
            setIsValidDragOver(false);
            const nodeElement = document.querySelector(`[data-id="${id}"]`);
            if (nodeElement) {
              nodeElement.classList.remove('loop-node-drag-over');
              nodeElement.classList.remove('dragging-over');
            }
          }}
          onDragLeave={(e) => {
            setIsValidDragOver(false);
            const nodeElement = document.querySelector(`[data-id="${id}"]`);
            if (nodeElement) {
              nodeElement.classList.remove('loop-node-drag-over');
              nodeElement.classList.remove('dragging-over');
            }
          }}
          data-node-id={id}
          data-type="group"
        >
          {/* Child nodes container */}
          <div 
            className="p-4 h-[calc(100%-10px)]" 
            data-dragarea="true"
            style={{
              position: 'relative',
              minHeight: '100%',
            }}
          >
            {/* Drag handle - invisible but allows dragging the loop node */}
            <div 
              className="absolute top-0 left-0 right-0 h-10 workflow-drag-handle cursor-move z-10 hover:bg-accent/10"
              style={{ opacity: 0.001 }} // Nearly invisible but still detectable for hover
            />
            
            {/* Delete button */}
            <div 
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-background/90 hover:bg-red-100 border border-border cursor-pointer z-20 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
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
                
                <div >
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
      
      {/* Loop Configuration Badges */}
      <LoopConfigBadges nodeId={id} data={data} />
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 