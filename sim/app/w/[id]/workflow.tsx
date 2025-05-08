'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  EdgeTypes,
  NodeTypes,
  ReactFlowProvider,
  useReactFlow,
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
import { LoopNodeComponent } from '@/app/w/[id]/components/loop-node/loop-node'

const logger = createLogger('Workflow')

// Define custom node and edge types outside the component
const defaultNodeTypes = {
  workflowBlock: WorkflowBlock,
  group: LoopNodeComponent,
  loop: LoopNodeComponent,
}

const defaultEdgeTypes = { workflowEdge: WorkflowEdge }

function WorkflowContent() {
  // State
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const { isCollapsed: isSidebarCollapsed } = useSidebarStore()

  // Memoize node and edge types to prevent re-creation on each render
  const nodeTypes = useMemo<NodeTypes>(() => defaultNodeTypes, []);
  const edgeTypes = useMemo<EdgeTypes>(() => defaultEdgeTypes, []);

  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project } = useReactFlow()
  const reactFlowInstance = useReactFlow()

  // Store access
  const { workflows, setActiveWorkflow, createWorkflow } = useWorkflowRegistry()
  const { blocks, edges, loops, addBlock, updateBlockPosition, addEdge, removeEdge } =
    useWorkflowStore()
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
      const { type, clientX, clientY } = event.detail
      logger.info('Handling add block from toolbar:', { type, clientX, clientY })

      if (!type) return
      if (type === 'connectionBlock') return

      // Calculate the center position of the viewport
      const centerPosition = project({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })

      // Special handling for loop nodes
      if (type === 'loop') {
        logger.info('Creating loop node from toolbar')
        const id = crypto.randomUUID()
        const name = `Loop ${Object.values(blocks).filter((b) => b.type === type).length + 1}`

        // Add the loop block to the workflow with proper configuration
        addBlock(id, type, name, centerPosition, {
          width: 800,
          height: 1000,
          loopType: 'for',
          count: 5,
          collection: '',
        })

        // Auto-connect logic
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        if (isAutoConnectEnabled) {
          const closestBlock = findClosestOutput(centerPosition)
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
        return
      }

      // Regular block handling
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
      if (isAutoConnectEnabled && type !== 'starter') {
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
            type: 'workflowEdge',
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

  // Transform blocks and loops into ReactFlow nodes
  const nodes = useMemo(() => {
    const nodeArray: any[] = []
    // logger.info('Creating nodes from blocks:', { blockCount: Object.keys(blocks).length })

    // Add block nodes
    Object.entries(blocks).forEach(([blockId, block]) => {
      if (!block.type || !block.name) {
        logger.warn(`Skipping invalid block: ${blockId}`, { block })
        return
      }

      // Handle loop nodes
      if (block.type === 'loop') {
        // logger.info('Creating loop node in useMemo:', { id: block.id, data: block.data })
        nodeArray.push({
          id: block.id,
          type: 'group',
          position: block.position,
          dragHandle: '.workflow-drag-handle',
          style: {
            width: block.data?.width || 800,
            height: block.data?.height || 1000,
            backgroundColor: 'transparent',
            border: 'none',
            boxShadow: 'none',
            outline: 'none',
          },
          data: {
            ...block.data,
            label: block.name,
            loopType: block.data?.loopType || 'for',
            count: block.data?.count || 5,
            collection: block.data?.collection || '',
            width: block.data?.width || 800,
            height: block.data?.height || 1000,
          },
        })
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, {
          block,
        })
        return
      }

      const isActive = activeBlockIds.has(block.id)
      const isPending = isDebugModeEnabled && pendingBlocks.includes(block.id)

      // Calculate position relative to parent if it exists
      let position = { ...block.position }; // Clone to avoid mutations
      let parentId = block.data?.parentId;
      let includeParentInfo = false;

      // If this block belongs to a loop node, calculate its position relative to the parent
      if (parentId) {
        const parentBlock = blocks[parentId];
        if (parentBlock) {
          // For child nodes, we want to render them at positions relative to the parent
          position = {
            x: block.position.x - parentBlock.position.x,
            y: block.position.y - parentBlock.position.y,
          };
          includeParentInfo = true;
        } else {
          // Parent doesn't exist - log warning and detach from parent
          logger.warn(`Parent node ${parentId} not found for block ${blockId}, detaching from parent`);
          parentId = undefined;
        }
      }

      // Create the node with proper parent-child relationship properties
      const node = {
        id: block.id,
        type: 'workflowBlock',
        position,
        // Set parentId directly on the node if it exists and is valid
        ...(includeParentInfo && {
          parentId,
          extent: 'parent',
          draggable: true // Make sure child nodes are draggable
        }),
        dragHandle: '.workflow-drag-handle',
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          isActive,
          isPending,
          // Remove parentId reference if parent is missing
          ...(block.data && {
            ...block.data,
            ...(includeParentInfo ? {} : { parentId: undefined })
          })
        },
      }

      nodeArray.push(node)
    })

    return nodeArray
  }, [blocks, activeBlockIds, pendingBlocks, isDebugModeEnabled])

  // Update the onDrop handler
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      // If the drop target is a loop node, let the loop node handle it
      const loopNodeElement = (event.target as HTMLElement).closest('.react-flow__node-group')
      if (loopNodeElement) {
        logger.info('Drop targeted at loop node, letting loop node handle it')
        return
      }

      try {
        const rawData = event.dataTransfer.getData('application/json')
        logger.info('Drop event raw data:', rawData)
        
        const data = JSON.parse(rawData)
        logger.info('Parsed drop data:', data)
        
        const type = data.type || (data.data && data.data.type)
        
        if (!type) {
          logger.error('Invalid drop data, no type found:', data)
          return
        }
        
        if (type === 'connectionBlock' || type === 'starter') {
          logger.info('Ignoring drop for connectionBlock or starter')
          return
        }

        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })

        // Special handling for loop nodes
        if (type === 'loop') {
          logger.info('Creating loop node from drop')
          const id = crypto.randomUUID()
          const name = `Loop ${Object.values(blocks).filter((b) => b.type === type).length + 1}`

          // Add the loop with proper configuration to ensure it renders as a group node
          addBlock(id, type, name, position, {
            width: 800,
            height: 1000,
            loopType: 'for',
            count: 5,
            collection: '',
          })

          logger.info("Loop block created at position:", position)

          // Auto-connect logic
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          if (isAutoConnectEnabled) {
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
          return
        }

        // Regular block handling
        const blockConfig = getBlock(type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { type })
          return
        }

        const id = crypto.randomUUID()
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === type).length + 1
        }`

        logger.info('Adding new block:', { id, type, name, position })
        addBlock(id, type, name, position)

        // Auto-connect logic
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        if (isAutoConnectEnabled && type !== 'starter') {
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
      } catch (err) {
        logger.error('Error dropping block:', { err })
      }
    },
    [project, blocks, addBlock, addEdge, findClosestOutput, determineSourceHandle]
  )

  // Update the onDragOver handler
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    
    try {
      const targetElement = event.target as HTMLElement
      const loopNode = targetElement.closest('.react-flow__node-group')
      
      if (loopNode) {
        logger.info('Drag over loop node:', { 
          id: loopNode.getAttribute('data-id'),
          clientX: event.clientX,
          clientY: event.clientY
        })
        
        // Try to get data about what's being dragged
        const rawData = event.dataTransfer.getData('application/json')
        if (rawData) {
          const data = JSON.parse(rawData)
          const type = data.type || (data.data && data.data.type)
          logger.info('Dragging block type:', { type })
          
          // Only highlight if it's not a starter block
          if (type && type !== 'starter' && type !== 'connectionBlock') {
            loopNode.classList.add('dragging-over')
            logger.info('Added dragging-over class to loop node')
          }
        }
      }
    } catch (error) {
      logger.error('Error in onDragOver:', { error })
    }
  }, [])

  // Add a utility for throttling function calls
  const throttle = useCallback((func: Function, delay: number): Function => {
    let lastCall = 0;
    return function (...args: any[]) {
      const now = Date.now();
      if (now - lastCall < delay) {
        return;
      }
      lastCall = now;
      return func(...args);
    };
  }, []);
  
  // Throttled version of updateBlockPosition to prevent too many updates
  const throttledUpdatePosition = useMemo(
    () => throttle((id: string, pos: any) => updateBlockPosition(id, pos), 16), // ~60fps
    [throttle, updateBlockPosition]
  );

  // Update the onNodesChange handler to properly handle parent-child relationships
  const onNodesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const node = reactFlowInstance.getNode(change.id);
          if (!node) return;

          // If this is a child node being dragged inside a parent
          if (node.parentId) {
            const parentNode = reactFlowInstance.getNode(node.parentId);
            
            // Check if parent node exists
            if (!parentNode) {
              logger.warn(`Parent node ${node.parentId} not found for node ${node.id} during position update`);
              
              // Update position without parent constraints
              updateBlockPosition(change.id, change.position);
              
              // Detach from parent in store
              setTimeout(() => {
                // Use setTimeout to avoid state mutation during render
                useWorkflowStore.setState(state => {
                  const updatedBlock = state.blocks[change.id];
                  if (updatedBlock && updatedBlock.data) {
                    return {
                      ...state,
                      blocks: {
                        ...state.blocks,
                        [change.id]: {
                          ...updatedBlock,
                          data: {
                            ...updatedBlock.data,
                            parentId: undefined
                          }
                        }
                      }
                    };
                  }
                  return state;
                });
              }, 0);
              return;
            }
            
            // Get parent dimensions from style or fallback to defaults
            const parentStyle = parentNode.style || {};
            const parentWidth = (parentStyle.width as number) || 800;
            const parentHeight = (parentStyle.height as number) || 1000;
            
            // Child node approximate dimensions
            const childWidth = 320;
            const childHeight = 180;
            
            // Constrain position to stay within parent bounds
            // Allow some margin from the edges (20px)
            const constrainedPosition = {
              x: Math.max(20, Math.min(change.position.x, parentWidth - childWidth+ 170)),
              y: Math.max(20, Math.min(change.position.y, parentHeight - childHeight))
            };
            
            // Check if parent exists in the block store
            if (!blocks[node.parentId]) {
              logger.warn(`Parent block ${node.parentId} missing in store for node ${node.id}`);
              updateBlockPosition(change.id, change.position);
              return;
            }
            
            // Calculate the absolute position based on the parent position and relative position
            const absolutePosition = {
              x: blocks[node.parentId].position.x + constrainedPosition.x,
              y: blocks[node.parentId].position.y + constrainedPosition.y
            };
            
            // Update the relative position in ReactFlow
            reactFlowInstance.setNodes(nodes => 
              nodes.map(n => {
                if (n.id === change.id) {
                  return {
                    ...n,
                    position: constrainedPosition
                  }
                }
                return n
              })
            );
            
            // Update the absolute position in the store
            throttledUpdatePosition(change.id, absolutePosition);
          } else {
            // If this is a regular node or parent node
            updateBlockPosition(change.id, change.position);
          }
        }
      });
    },
    [reactFlowInstance, blocks, updateBlockPosition, throttledUpdatePosition]
  );

  // Update the onDragEnd handler
  const onDragEnd = useCallback((event: any) => {
    // Remove highlighting from all loop nodes
    const highlightedNodes = document.querySelectorAll('.react-flow__node-group.dragging-over')
    logger.info('Removing drag highlight from nodes:', { count: highlightedNodes.length })
    highlightedNodes.forEach(node => {
      node.classList.remove('dragging-over')
    })
    
    // If a node was dragged onto a loop node, this would be handled by the loop node's drop handler
    if (event?.target) {
      const loopNode = event.target.closest('.react-flow__node-group')
      if (loopNode) {
        const draggedNodeId = event.target.getAttribute('data-id')
        const loopNodeId = loopNode.getAttribute('data-id')
        
        if (draggedNodeId && loopNodeId) {
          logger.info('Node dragged onto loop:', { 
            draggedNodeId, 
            loopNodeId
          })
          
          // The drop handling will be done by the loop node component
          // This is just for logging
        }
      }
    }
  }, [])

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
          nodesConnectable={true}
          nodesDraggable={true}
          nodesFocusable={false}
          edgeTypes={edgeTypes}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
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
          edgesFocusable={false}
          edgesUpdatable={true}
          className="workflow-container h-full"
          nodeExtent={[[-10000, -10000], [10000, 10000]]}
          snapToGrid={false}
          snapGrid={[20, 20]}
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