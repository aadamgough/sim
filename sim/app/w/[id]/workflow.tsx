'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  EdgeTypes,
  NodeTypes,
  ReactFlowProvider,
  useReactFlow,
  Node,
  NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { createLogger } from '@/lib/logs/console-logger'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { initializeSyncManagers, isSyncInitialized } from '@/stores/sync-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { NotificationList } from '@/app/w/[id]/components/notifications/notifications'
import { getBlock } from '@/blocks'
import { ControlBar } from './components/control-bar/control-bar'
import { ErrorBoundary } from './components/error/index'
import { Panel } from './components/panel/panel'
import { Toolbar } from './components/toolbar/toolbar'
import { WorkflowBlock } from './components/workflow-block/workflow-block'
import { WorkflowEdge } from './components/workflow-edge/workflow-edge'
import { LoopInput } from './components/workflow-loop/components/loop-input/loop-input'
import { LoopLabel } from './components/workflow-loop/components/loop-label/loop-label'
import { LoopNodeComponent } from '@/app/w/[id]/components/loop-node/loop-node'

const logger = createLogger('Workflow')

// Define custom node and edge types
const nodeTypes = {
  workflowBlock: WorkflowBlock,
  loopLabel: LoopLabel,
  loopInput: LoopInput,
  loop: LoopNodeComponent,
} satisfies Record<string, React.ComponentType<NodeProps>>

// Add resizable configuration to the loop node
const nodeConfig = {
  loop: {
    resizable: true,
  },
}

const edgeTypes: EdgeTypes = { workflowEdge: WorkflowEdge }

function WorkflowContent() {
  // State
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const { isCollapsed: isSidebarCollapsed } = useSidebarStore()
  const overlappingNodeRef = useRef<Node | null>(null)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project, getIntersectingNodes, setNodes } = useReactFlow()

  // Store access
  const { workflows, setActiveWorkflow, createWorkflow } = useWorkflowRegistry()
  const {
    blocks,
    edges,
    loops,
    addBlock,
    updateBlockPosition,
    updateNodeDimensions,
    addEdge,
    removeEdge,
    removeBlock
  } = useWorkflowStore()
  const { setValue: setSubBlockValue } = useSubBlockStore()
  const { markAllAsRead } = useNotificationStore()
  const { resetLoaded: resetVariablesLoaded } = useVariablesStore()

  // Execution and debug mode state
  const { activeBlockIds, pendingBlocks } = useExecutionStore()
  const { isDebugModeEnabled } = useGeneralStore()

  // Initialize workflow
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Ensure sync system is initialized before proceeding
      const initSync = async () => {
        // Initialize sync system if not already initialized
        await initializeSyncManagers()
        setIsInitialized(true)
      }

      // Check if already initialized
      if (isSyncInitialized()) {
        setIsInitialized(true)
      } else {
        initSync()
      }
    }
  }, [])

  // Handle drops
  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }) => {
      const existingBlocks = Object.entries(blocks)
        .filter(([_, block]) => block.enabled)
        .map(([id, block]) => ({
          id,
          type: block.type,
          position: block.position,
          distance: Math.sqrt(
            Math.pow(block.position.x - newNodePosition.x, 2) +
              Math.pow(block.position.y - newNodePosition.y, 2)
          ),
        }))
        .sort((a, b) => a.distance - b.distance)

      return existingBlocks[0] ? existingBlocks[0] : null
    },
    [blocks]
  )

  // Determine the appropriate source handle based on block type
  const determineSourceHandle = useCallback((block: { id: string; type: string }) => {
    // Default source handle
    let sourceHandle = 'source'

    // For condition blocks, use the first condition handle
    if (block.type === 'condition') {
      // Get just the first condition handle from the DOM
      const conditionHandles = document.querySelectorAll(
        `[data-nodeid^="${block.id}"][data-handleid^="condition-"]`
      )
      if (conditionHandles.length > 0) {
        // Extract the full handle ID from the first condition handle
        const handleId = conditionHandles[0].getAttribute('data-handleid')
        if (handleId) {
          sourceHandle = handleId
        }
      }
    }

    return sourceHandle
  }, [])

  // Listen for toolbar block click events
  useEffect(() => {
    const handleAddBlockFromToolbar = (event: CustomEvent) => {
      const { type } = event.detail

      if (!type) return
      if (type === 'connectionBlock') return

      // Calculate the center position of the viewport
      const centerPosition = project({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })

      // Handle loop nodes differently
      if (type === 'loop') {
        const id = crypto.randomUUID()
        addBlock(id, type, 'Loop', centerPosition, {
          loopType: 'while',
          condition: '',
          count: 1,
          collection: '',
          extent: 'parent' // Ensure child nodes stay within parent bounds
        })
        return
      }

      const blockConfig = getBlock(type)
      if (!blockConfig) {
        logger.error('Invalid block type:', { type })
        return
      }

      // Create a new block with a unique ID
      const id = crypto.randomUUID()
      const name = `${blockConfig.name} ${
        Object.values(blocks).filter((b) => b.type === type).length + 1
      }`

      // Add the block to the workflow
      addBlock(id, type, name, centerPosition)

      // Auto-connect logic
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      if (isAutoConnectEnabled && type !== 'starter' || type == 'loop') {
        const closestBlock = findClosestOutput(centerPosition)
        if (closestBlock) {
          // Get appropriate source handle
          const sourceHandle = determineSourceHandle(closestBlock)

          addEdge({
            id: crypto.randomUUID(),
            source: closestBlock.id,
            target: id,
            sourceHandle,
            targetHandle: 'target',
            type: 'custom',
          })
        }
      }
    }

    window.addEventListener('add-block-from-toolbar', handleAddBlockFromToolbar as EventListener)

    return () => {
      window.removeEventListener(
        'add-block-from-toolbar',
        handleAddBlockFromToolbar as EventListener
      )
    }
  }, [project, blocks, addBlock, addEdge, findClosestOutput, determineSourceHandle])

  // Update the onDrop handler
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      logger.info('Drop event on workflow')

      try {
        const data = JSON.parse(event.dataTransfer.getData('application/json'))
        logger.info('Dropped data:', data)
        
        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })
        logger.info('Calculated drop position:', position)

        // Check if dropping onto a loop node
        const droppedOnLoop = getIntersectingNodes({ x: position.x, y: position.y, width: 1, height: 1 })
          .find(node => node.type === 'loop')

        if (droppedOnLoop) {
          logger.info('Dropping onto loop node:', droppedOnLoop.id)
          
          // Get the loop node's DOM element
          const loopElement = document.querySelector(`[data-id="${droppedOnLoop.id}"]`)
          if (!loopElement) return
          
          // Get the drop container within the loop node
          const dropContainer = loopElement.querySelector('.loop-drop-container')
          if (!dropContainer) {
            logger.error('Could not find drop container in loop node')
            return
          }
          
          // Get dimensions for the loop node
          const loopNodeData = droppedOnLoop.data || {};
          const loopNodeWidth = loopNodeData.width || 800;
          const loopNodeHeight = loopNodeData.height || 400;
          
          // Calculate relative position within the loop's drop container
          const containerBounds = dropContainer.getBoundingClientRect()
          
          // OPTION 8: Based on drop position relative to loop node
          const loopRect = loopElement.getBoundingClientRect();
          const relativePosition = {
            // Calculate position relative to the loop node's top-left corner with gentler constraints
            x: Math.max(20, Math.min(containerBounds.width - 350, 
              event.clientX - loopRect.left - 4)), // 4px is for the padding
            y: Math.max(20, Math.min(containerBounds.height - 200, 
              event.clientY - loopRect.top - 36)) // Reduced from 109px to 36px for better accuracy
          }
          
          // Get dimensions of the element being dropped
          let blockWidth = 320;  // Default width for most blocks
          let blockHeight = 180; // Default height with some buffer
          
          logger.info('Drop container bounds:', {
            left: containerBounds.left,
            top: containerBounds.top,
            width: containerBounds.width,
            height: containerBounds.height
          })
          
          logger.info('Calculated relative position:', relativePosition)

          // Create the new block
          const id = crypto.randomUUID()
          const blockConfig = getBlock(data.type)
          if (!blockConfig) {
            logger.error('Invalid block type:', { data })
            return
          }

          const name = `${blockConfig.name} ${
            Object.values(blocks).filter((b) => b.type === data.type).length + 1
          }`

          // Add to workflow store with relative position
          addBlock(id, data.type, name, relativePosition, {
            parentId: droppedOnLoop.id,  // Store the parentId in block data
          })

          // IMPROVED: Calculate new dimensions considering all nodes in the loop
          // Get existing child nodes in this loop
          const existingChildren = nodes.filter(n => n.parentId === droppedOnLoop.id);
          
          // Calculate the rightmost and bottommost positions to determine the needed size
          let rightmostPosition = relativePosition.x + blockWidth;
          let bottommostPosition = relativePosition.y + blockHeight;
          
          // Check if existing children require more space
          existingChildren.forEach(child => {
            // Calculate the right and bottom edges of existing children
            const childRight = child.position.x + blockWidth;
            const childBottom = child.position.y + blockHeight;
            
            // Update the rightmost and bottommost positions if needed
            rightmostPosition = Math.max(rightmostPosition, childRight);
            bottommostPosition = Math.max(bottommostPosition, childBottom);
          });
          
          // Now add more generous margins to ensure sufficient space
          const horizontalPadding = 300; // Add 300px beyond the rightmost element
          const verticalPadding = 400;   // Add 400px beyond the bottommost element
          
          const newWidth = Math.max(loopNodeWidth, rightmostPosition + horizontalPadding);
          const newHeight = Math.max(loopNodeHeight, bottommostPosition + verticalPadding);
          
          logger.info('New loop dimensions:', { width: newWidth, height: newHeight });

          // Add to React Flow with proper parent node configuration
          setNodes((nds) => {
            // First update any existing nodes
            const updatedNodes = nds.map(node => {
              if (node.id === droppedOnLoop.id) {
                // Update the loop node dimensions
                logger.info('Updating loop node dimensions:', { 
                  id: droppedOnLoop.id, 
                  width: newWidth, 
                  height: newHeight 
                });
                return {
                  ...node,
                  style: {
                    ...node.style,
                    width: newWidth,
                    height: newHeight,
                  },
                  data: {
                    ...node.data,
                    width: newWidth,
                    height: newHeight,
                  },
                };
              }
              return node;
            });
            
            // Then add the new node
            logger.info('Adding node as child of loop:', {
              childId: id,
              parentId: droppedOnLoop.id,
              position: relativePosition
            });
            
            return updatedNodes.concat({
              id,
              type: 'workflowBlock',
              position: relativePosition,
              parentId: droppedOnLoop.id,
              extent: 'parent' as const,
              expandParent: true,
              zIndex: 1000, // Ensure it appears above other elements
              dragHandle: '.workflow-drag-handle',
              data: {
                type: data.type,
                config: blockConfig,
                name: name,
              }
            });
          });
          
          // Update loop dimensions in workflow store
          updateNodeDimensions(droppedOnLoop.id, { width: newWidth, height: newHeight });

          // Update the loop's nodes array
          const workflowStore = useWorkflowStore.getState()
          const currentLoops = { ...workflowStore.loops }
          
          if (!currentLoops[droppedOnLoop.id]) {
            currentLoops[droppedOnLoop.id] = {
              id: droppedOnLoop.id,
              nodes: [id],
              iterations: 5,
              loopType: 'for',
              forEachItems: '',
            }
          } else {
            currentLoops[droppedOnLoop.id] = {
              ...currentLoops[droppedOnLoop.id],
              nodes: [...currentLoops[droppedOnLoop.id].nodes, id]
            }
          }

          useWorkflowStore.setState({ loops: currentLoops })
          return
        }

        // Handle loop nodes
        if (data.type === 'loop') {
          const id = crypto.randomUUID()
          logger.info('Creating new loop node:', { id })
          
          // Add to workflow store first
          addBlock(id, 'loop', data.name, position, {
            ...data.storeData,
            extent: 'parent',
          })
          logger.info('Added loop to workflow store')

          // Add to React Flow
          setNodes((nds) => nds.concat({
            id,
            type: 'loop',
            position,
            dragHandle: data.dragHandle,
            style: data.style,
            data: {
              ...data.data,
              id,
              label: data.name,
            }
          }))
          logger.info('Added loop to React Flow')
          
          // Create and add a loop start block inside the loop node
          const startBlockId = crypto.randomUUID()
          const startPosition = { x: 50, y: 50 } // Better relative position within the loop node
          
          // Add to workflow store with parent node info
          addBlock(startBlockId, 'loopStart', 'Loop Start', startPosition, {
            parentId: id,  // Set the parentId explicitly
            loopType: data.data?.loopType || 'for',
            count: data.data?.count || 5
          });
          
          logger.info('Added loopStart block with parent info:', {
            blockId: startBlockId,
            parentId: id,
            position: startPosition
          });
          
          // Add to React Flow
          setNodes((nds) => nds.concat({
            id: startBlockId,
            type: 'loopStart',
            position: startPosition,
            parentId: id,
            extent: 'parent' as const,
            dragHandle: '.workflow-drag-handle',
            data: {
              loopType: data.data?.loopType || 'for',
              count: data.data?.count || 5,
            }
          }))
          
          // Update the loop's nodes array to include the start block
          const workflowStore = useWorkflowStore.getState()
          const currentLoops = { ...workflowStore.loops }
          
          currentLoops[id] = {
            id,
            nodes: [startBlockId],
            iterations: data.data?.count || 5,
            loopType: data.data?.loopType || 'for',
            forEachItems: data.data?.collection || '',
          }
          
          useWorkflowStore.setState({ loops: currentLoops })
          logger.info('Updated loop data with start block')
          
          return
        }

        // For regular blocks, add them to the workflow store
        const blockConfig = getBlock(data.type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { data })
          return
        }

        const id = crypto.randomUUID()
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === data.type).length + 1
        }`

        addBlock(id, data.type, name, position)

        // Auto-connect logic
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        if (isAutoConnectEnabled && data.type !== 'starter') {
          const closestBlock = findClosestOutput(position)
          if (closestBlock) {
            const sourceHandle = determineSourceHandle(closestBlock)

            addEdge({
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: id,
              sourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            })
          }
        }
      } catch (error) {
        logger.error('Error in onDrop:', error)
      }
    },
    [project, blocks, addBlock, addEdge, findClosestOutput, determineSourceHandle])

  // Init workflow
  useEffect(() => {
    if (!isInitialized) return

    const validateAndNavigate = async () => {
      const workflowIds = Object.keys(workflows)
      const currentId = params.id as string

      if (workflowIds.length === 0) {
        // Create initial workflow using the centralized function
        const newId = createWorkflow({ isInitial: true })
        router.replace(`/w/${newId}`)
        return
      }

      if (!workflows[currentId]) {
        router.replace(`/w/${workflowIds[0]}`)
        return
      }

      // Import the isActivelyLoadingFromDB function to check sync status
      const { isActivelyLoadingFromDB } = await import('@/stores/workflows/sync')

      // Wait for any active DB loading to complete before switching workflows
      if (isActivelyLoadingFromDB()) {
        logger.info('Waiting for DB loading to complete before switching workflow')
        const checkInterval = setInterval(() => {
          if (!isActivelyLoadingFromDB()) {
            clearInterval(checkInterval)
            // Reset variables loaded state before setting active workflow
            resetVariablesLoaded()
            setActiveWorkflow(currentId)
            markAllAsRead(currentId)
          }
        }, 100)
        return
      }

      // Reset variables loaded state before setting active workflow
      resetVariablesLoaded()
      setActiveWorkflow(currentId)
      markAllAsRead(currentId)
    }

    validateAndNavigate()
  }, [
    params.id,
    workflows,
    setActiveWorkflow,
    createWorkflow,
    router,
    isInitialized,
    markAllAsRead,
    resetVariablesLoaded,
  ])

  // Transform blocks and loops into ReactFlow nodes
  const nodes = useMemo(() => {
    const nodeArray: any[] = []

    // Add regular block nodes
    Object.entries(blocks).forEach(([blockId, block]) => {
      if (!block.type || !block.name) {
        logger.warn(`Skipping invalid block: ${blockId}`, { block })
        return
      }

      // Handle loop nodes differently
      if (block.type === 'loop') {
        logger.info('Creating loop node in ReactFlow:', { 
          id: block.id, 
          width: block.data?.width || 800,
          height: block.data?.height || 400,
          loopType: block.data?.loopType || 'for'
        });
        
        nodeArray.push({
          id: block.id,
          type: 'loop',
          position: block.position,
          dragHandle: '.workflow-drag-handle',
          style: {
            width: block.data?.width || 800,
            height: block.data?.height || 400,
          },
          data: {
            ...block.data,
            label: block.name,
            loopType: block.data?.loopType || 'for',
            condition: block.data?.condition || '',
            count: block.data?.count || 1,
            collection: block.data?.collection || '',
            width: block.data?.width || 800,
            height: block.data?.height || 400,
          },
        })
        return
      }

      // Handle regular blocks
      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, {
          block,
        })
        return
      }

      const isActive = activeBlockIds.has(block.id)
      const isPending = isDebugModeEnabled && pendingBlocks.includes(block.id)
      
      // Check if this block belongs to a loop node
      const parentId = block.data?.parentId;
      if (parentId) {
        logger.info('Found block with parentId in data:', {
          blockId: block.id,
          parentId,
          blockType: block.type
        });
      }

      nodeArray.push({
        id: block.id,
        type: 'workflowBlock',
        position: block.position,
        parentId: parentId, // Set the parentId from block data
        extent: parentId ? 'parent' as const : undefined,
        dragHandle: '.workflow-drag-handle',
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          isActive,
          isPending,
        },
      })
    })
    
    // Add diagnostic logging for loop-node relationships
    const loopNodes = nodeArray.filter(n => n.type === 'loop');
    loopNodes.forEach(loopNode => {
      const loopId = loopNode.id;
      const childNodesInStore = loops[loopId]?.nodes || [];
      logger.info('Loop-node relationship check:', {
        loopId,
        childrenCount: childNodesInStore.length,
        childrenIds: childNodesInStore
      });
    });

    logger.info('Node array created:', { 
      totalNodes: nodeArray.length,
      loopNodes: nodeArray.filter(n => n.type === 'loop').length,
      nodesWithParents: nodeArray.filter(n => n.parentId).length
    });

    return nodeArray
  }, [blocks, activeBlockIds, pendingBlocks, isDebugModeEnabled, loops])

  // Update nodes
  const onNodesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const node = nodes.find((n) => n.id === change.id)
          if (!node) return

          if (node.parentId) {
            const loopNode = nodes.find((n) => n.id === node.parentId)
            if (loopNode) {
              // For nodes inside a loop, we need to:
              // 1. Let React Flow handle the visual rendering and movement
              // 2. Only enforce boundary constraints to prevent blocks from going out of bounds
              // 3. Update our data store with the correct relative position

              // Get loop dimensions
              const loopWidth = loopNode.style?.width || 800;
              const loopHeight = loopNode.style?.height || 400;
              
              // Get node dimensions (approximate)
              const nodeWidth = 320; // Default width
              const nodeHeight = 150; // Default height
              
              // SIMPLIFY: Allow more freedom of movement inside the loop node
              // Only constrain if extremely out of bounds to prevent the node
              // from disappearing completely outside the loop
              const minX = -nodeWidth / 2;
              const minY = -nodeHeight / 2;
              const maxX = loopWidth - nodeWidth / 2;
              const maxY = loopHeight - nodeHeight / 2;
              
              // Only apply constraints if seriously out of bounds
              let newX = change.position.x;
              let newY = change.position.y;
              
              // Only apply constraints in extreme cases
              if (newX < minX - 100) newX = minX;
              else if (newX > maxX + 100) newX = maxX;
              
              if (newY < minY - 100) newY = minY;
              else if (newY > maxY + 100) newY = maxY;
              
              // If we adjusted the position, update it
              if (newX !== change.position.x || newY !== change.position.y) {
                change.position.x = newX;
                change.position.y = newY;
              }

              // Update the node in our workflow store with its position
              updateBlockPosition(node.id, { x: change.position.x, y: change.position.y })
            }
          } else {
            // For top-level nodes, simply update the position
            updateBlockPosition(node.id, { x: change.position.x, y: change.position.y })
          }
        } else if (change.type === 'remove') {
          // Handle node removal

          // Check if it was a loop node
          const node = nodes.find((n) => n.id === change.id)
          if (node?.type === 'loop') {
            const workflowStore = useWorkflowStore.getState()
            const currentLoops = { ...workflowStore.loops }
            
            // Remove the loop
            delete currentLoops[node.id]
            
            // Update the store
            useWorkflowStore.setState({ loops: currentLoops })
          }

          // Remove from blocks
          removeBlock(change.id)
        }
      })
    },
    [nodes, removeBlock, updateBlockPosition]
  )

  // Update edges
  const onEdgesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'remove') {
          removeEdge(change.id)
        }
      })
    },
    [removeEdge]
  )

  // Handle connections
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        addEdge({
          ...connection,
          id: crypto.randomUUID(),
          type: 'workflowEdge',
        })
      }
    },
    [addEdge]
  )

  // Update onPaneClick to only handle edge selection
  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null)
  }, [])

  // Edge selection
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    setSelectedEdgeId(edge.id)
  }, [])

  // Transform edges to include selection state
  const edgesWithSelection = edges.map((edge) => ({
    ...edge,
    type: edge.type || 'workflowEdge',
    data: {
      selectedEdgeId,
      onDelete: (edgeId: string) => {
        removeEdge(edgeId)
        setSelectedEdgeId(null)
      },
    },
  }))

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
        removeEdge(selectedEdgeId)
        setSelectedEdgeId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeId, removeEdge])

  // Handle sub-block value updates from custom events
  useEffect(() => {
    const handleSubBlockValueUpdate = (event: CustomEvent) => {
      const { blockId, subBlockId, value } = event.detail
      if (blockId && subBlockId) {
        setSubBlockValue(blockId, subBlockId, value)
      }
    }

    window.addEventListener('update-subblock-value', handleSubBlockValueUpdate as EventListener)

    return () => {
      window.removeEventListener(
        'update-subblock-value',
        handleSubBlockValueUpdate as EventListener
      )
    }
  }, [setSubBlockValue])

  const onNodeDrag = useCallback(
    (evt: React.MouseEvent, dragNode: Node) => {
      logger.info('Node drag event:', { 
        nodeId: dragNode.id, 
        nodeType: dragNode.type,
        position: dragNode.position,
        parentId: dragNode.parentId 
      })

      // Get the node that's currently being overlapped, if any
      const intersections = getIntersectingNodes(dragNode).filter(
        (n) => n.type === 'loop' && n.id !== dragNode.parentId
      )
      
      const overlappingNode = intersections[0]
      overlappingNodeRef.current = overlappingNode

      // If the node being dragged is inside a loop node (has a parentId),
      // we want to optimize the dragging experience to make it smooth and natural
      if (dragNode.parentId) {
        // Use ReactFlow's built-in drag handling and don't interfere with its calculations
        // This allows for smooth movement of nodes within their parent
        logger.info('Node is being dragged within parent:', dragNode.parentId)
        return
      }

      // The rest of the function handles dragging nodes that are not inside a loop
      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id === dragNode.id) {
            return {
              ...node,
              data: {
                ...node.data,
                state: overlappingNode ? 'dragging' : undefined,
              },
            }
          }

          // If the current node is being dragged over, highlight it
          if (overlappingNode && node.id === overlappingNode.id) {
            return {
              ...node,
              style: {
                ...node.style,
                borderColor: '#40E0D0',
                backgroundColor: 'rgba(34, 197, 94, 0.05)',
              },
              data: {
                ...node.data,
                state: 'valid',
              },
            }
          }
          
          // Reset state on other loop nodes
          if (node.type === 'loop' && (!overlappingNode || node.id !== overlappingNode.id)) {
            return {
              ...node,
              style: {
                ...node.style,
                borderColor: undefined,
                backgroundColor: undefined,
              },
              data: {
                ...node.data,
                state: undefined,
              },
            }
          }
          return node
        })
      )
    },
    [getIntersectingNodes, setNodes]
  )

  const onNodeDragStop = useCallback(
    (evt: React.MouseEvent, dragNode: Node) => {
      logger.info('Node drag stop event:', { nodeId: dragNode.id, nodeType: dragNode.type })
      
      const overlappingNode = overlappingNodeRef.current
      logger.info('Final overlapping node:', overlappingNode ? {
        nodeId: overlappingNode.id,
        nodeType: overlappingNode.type
      } : 'none')

      // If dragging into a loop node
      if (overlappingNode?.type === 'loop') {
        // Find the loop node's DOM element
        const loopElement = document.querySelector(`[data-id="${overlappingNode.id}"]`)
        logger.info('Found loop element:', { 
          found: !!loopElement, 
          loopId: overlappingNode.id 
        })
        
        if (!loopElement) return

        // Get the loop node's drop container
        const dropContainer = loopElement.querySelector('.loop-drop-container')
        if (!dropContainer) {
          logger.error('Could not find drop container in loop node')
          return
        }
        
        // Get the dragged node's dimensions
        const draggedNodeElement = document.querySelector(`[data-id="${dragNode.id}"]`)
        if (!draggedNodeElement) return
        
        // Get bounds
        const containerBounds = dropContainer.getBoundingClientRect()
        const draggedNodeBounds = draggedNodeElement.getBoundingClientRect()
        
        // Get dimensions for the loop node
        const loopNodeData = overlappingNode.data || {};
        const loopNodeWidth = loopNodeData.width || 800;
        const loopNodeHeight = loopNodeData.height || 400;
        
        // Calculate position - simplify the relative positioning calculation
        // This is where we simplify to reduce erratic movement
        const loopRect = loopElement.getBoundingClientRect();
        const relativePosition = {
          x: evt.clientX - loopRect.left - 4, // 4px is for the loop's padding
          y: evt.clientY - loopRect.top - 109 // 109px accounts for header + padding
        };
        
        logger.info('Calculated relative position:', relativePosition)
        
        // IMPROVED: Calculate required dimensions based on the node's position and existing child nodes
        // Get existing child nodes in this loop (excluding the current dragged node if it was already in this loop)
        const existingChildren = nodes.filter(n => 
          n.parentId === overlappingNode.id && n.id !== dragNode.id
        );
        
        // Default block dimensions
        const blockWidth = draggedNodeBounds.width || 320;
        const blockHeight = draggedNodeBounds.height || 180;
        
        // Calculate the rightmost and bottommost positions including the dragged node
        let rightmostPosition = relativePosition.x + blockWidth;
        let bottommostPosition = relativePosition.y + blockHeight;
        
        // Check if existing children require more space
        existingChildren.forEach(child => {
          // Calculate the right and bottom edges of existing children
          const childRight = child.position.x + blockWidth;
          const childBottom = child.position.y + blockHeight;
          
          // Update the rightmost and bottommost positions if needed
          rightmostPosition = Math.max(rightmostPosition, childRight);
          bottommostPosition = Math.max(bottommostPosition, childBottom);
        });
        
        // Now add more generous margins to ensure sufficient space
        const horizontalPadding = 300; // Add 300px beyond the rightmost element
        const verticalPadding = 400;   // Add 400px beyond the bottommost element
        
        const requiredWidth = Math.max(loopNodeWidth, rightmostPosition + horizontalPadding);
        const requiredHeight = Math.max(loopNodeHeight, bottommostPosition + verticalPadding);
        
        logger.info('New loop dimensions after drag:', {
          width: requiredWidth,
          height: requiredHeight,
          rightmostPos: rightmostPosition,
          bottommostPos: bottommostPosition
        });

        // Find and remove any connections to the dragged node before it goes into the loop
        const connectionsToRemove = edges.filter(
          edge => edge.source === dragNode.id || edge.target === dragNode.id
        )
        
        if (connectionsToRemove.length > 0) {
          connectionsToRemove.forEach(edge => {
            removeEdge(edge.id)
          })
          logger.info('Removed connections to node being moved into loop:', 
            connectionsToRemove.map(edge => edge.id))
        }

        // Update nodes in React Flow
        setNodes((prevNodes) => {
          logger.info('Updating nodes for loop containment - BEFORE:', {
            dragNodeId: dragNode.id,
            dragNodeParent: dragNode.parentId,
            overlappingNodeId: overlappingNode.id
          });
          
          const updatedNodes = prevNodes.map((node) => {
            if (node.id === dragNode.id) {
              logger.info('Setting parentId of dragged node:', {
                nodeId: node.id,
                newParent: overlappingNode.id,
                position: relativePosition
              });
              return {
                ...node,
                // Create a new position object to ensure React Flow detects the change
                position: {
                  x: relativePosition.x,
                  y: relativePosition.y
                },
                parentId: overlappingNode.id,
                extent: 'parent' as const,
                expandParent: true,
                zIndex: 1000,
                data: {
                  ...node.data,
                  state: undefined,
                },
              };
            }
            if (node.id === overlappingNode.id) {
              logger.info('Updating loop dimensions in React Flow:', {
                nodeId: node.id,
                width: requiredWidth,
                height: requiredHeight
              });
              return {
                ...node,
                style: {
                  ...node.style,
                  width: requiredWidth,
                  height: requiredHeight,
                  borderColor: undefined,
                  backgroundColor: undefined,
                },
                data: {
                  ...node.data,
                  width: requiredWidth,
                  height: requiredHeight,
                  state: undefined,
                },
              };
            }
            return node;
          });
          
          // Verify if the parentId is properly set
          const updatedDragNode = updatedNodes.find(n => n.id === dragNode.id);
          logger.info('Updated drag node - AFTER:', {
            nodeId: dragNode.id, 
            hasParentNode: !!updatedDragNode?.parentId,
            parentId: updatedDragNode?.parentId || 'none'
          });
          
          return updatedNodes;
        });

        // Update position in workflow store
        logger.info('Updating position in workflow store with parent info:', {
          nodeId: dragNode.id,
          position: relativePosition,
          parentId: overlappingNode.id
        })
        
        // We need to store the parentId relationship in the block's data
        // This ensures it's maintained across rerenders
        const updatedBlock = {
          ...blocks[dragNode.id],
          // Store the RELATIVE position directly, not absolute
          position: {
            x: relativePosition.x,
            y: relativePosition.y
          },
          data: {
            ...blocks[dragNode.id].data,
            parentId: overlappingNode.id
          }
        };
        
        // Update the block with the parent info
        useWorkflowStore.setState((state) => ({
          ...state,
          blocks: {
            ...state.blocks,
            [dragNode.id]: updatedBlock
          }
        }));

        // Update loop dimensions in workflow store
        logger.info('Updating loop dimensions in workflow store:', {
          nodeId: overlappingNode.id,
          width: requiredWidth,
          height: requiredHeight
        })
        updateNodeDimensions(overlappingNode.id, { width: requiredWidth, height: requiredHeight })

        // Initialize or update the loop's nodes array in the workflow store
        const workflowStore = useWorkflowStore.getState()
        const currentLoops = { ...workflowStore.loops }  // Create a new copy
        const loopId = overlappingNode.id
        
        if (!currentLoops[loopId]) {
          // Create a new loop entry if it doesn't exist
          currentLoops[loopId] = {
            id: loopId,
            nodes: [dragNode.id],
            iterations: 5,
            loopType: 'for',
            forEachItems: '',
          }
        } else if (!currentLoops[loopId].nodes.includes(dragNode.id)) {
          // Add the dragged node to the existing loop's nodes array
          currentLoops[loopId] = {
            ...currentLoops[loopId],
            nodes: [...currentLoops[loopId].nodes, dragNode.id]
          }
        }

        // Update the store with the new loops state
        useWorkflowStore.setState({ loops: currentLoops })
      } else {
        logger.info('Node not dropped on loop, resetting state')
        // Reset any visual feedback state
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            if (node.id === dragNode.id) {
              // If the node was previously in a loop, remove it from that loop
              if (node.parentId) {
                const workflowStore = useWorkflowStore.getState()
                const currentLoops = { ...workflowStore.loops }
                const previousLoopId = node.parentId
                
                if (currentLoops[previousLoopId]?.nodes) {
                  currentLoops[previousLoopId] = {
                    ...currentLoops[previousLoopId],
                    nodes: currentLoops[previousLoopId].nodes.filter(id => id !== dragNode.id)
                  }
                  useWorkflowStore.setState({ loops: currentLoops })
                }
              }
              
              return {
                ...node,
                parentId: undefined,
                extent: undefined,
                data: {
                  ...node.data,
                  state: undefined,
                },
              }
            }
            return node
          })
        )
      }

      overlappingNodeRef.current = null
    },
    [setNodes, updateBlockPosition, updateNodeDimensions, edges, removeEdge, blocks]
  )

  // Add diagnostic logging right before we return nodes
  useEffect(() => {
    if (nodes.length > 0) {
      const parentChildLog = nodes.map(node => ({
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        hasExtent: !!node.extent
      }));
      
      logger.info('Parent-child relationships in ReactFlow:', {
        parentChildNodes: parentChildLog.filter(n => n.parentId),
        totalNodeCount: nodes.length
      });
    }
  }, [nodes]);

  if (!isInitialized) {
    return (
      <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center">
        <LoadingAgent size="lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <div className={`transition-all duration-200 ${isSidebarCollapsed ? 'ml-14' : 'ml-60'}`}>
        <ControlBar />
        <Toolbar />
      </div>
      <div
        className={`flex-1 relative w-full h-full transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
      >
        <Panel />
        <NotificationList />
        <ReactFlow
          nodes={nodes}
          edges={edgesWithSelection}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          nodeOrigin={[0.5, 0.5]}
          nodesDraggable={true}
          nodesConnectable={true}
          nodesFocusable={true}
          edgeTypes={edgeTypes}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          fitView
          minZoom={0.1}
          maxZoom={1.3}
          panOnScroll
          defaultEdgeOptions={{ type: 'custom' }}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{
            stroke: '#94a3b8',
            strokeWidth: 2,
            strokeDasharray: '5,5',
          }}
          connectionLineType={ConnectionLineType.SmoothStep}
          onNodeClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
          onPaneClick={onPaneClick}
          onEdgeClick={onEdgeClick}
          elementsSelectable={true}
          selectNodesOnDrag={false}
          draggable={false}
          noWheelClassName="allow-scroll"
          edgesFocusable={true}
          edgesUpdatable={true}
          className="workflow-container h-full"
        >
          <Background />
        </ReactFlow>
      </div>
    </div>
  )
}

// Workflow wrapper
export default function Workflow() {
  return (
    <ReactFlowProvider>
      <ErrorBoundary>
        <WorkflowContent />
      </ErrorBoundary>
    </ReactFlowProvider>
  )
}
