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

// Utility functions for DOM operations and parent-child relationships
const domUtils = {
  // Get DOM element for a node by ID
  getNodeElement: (id: string): HTMLElement | null => {
    return document.querySelector(`[data-id="${id}"]`);
  },
  
  // Add drag highlighting to a node
  addDragHighlight: (nodeElement: HTMLElement | null) => {
    if (!nodeElement) return;
    nodeElement.classList.add('loop-node-drag-over');
    nodeElement.classList.add('dragging-over');
  },
  
  // Remove drag highlighting from a node
  removeDragHighlight: (nodeElement: HTMLElement | null) => {
    if (!nodeElement) return;
    nodeElement.classList.remove('loop-node-drag-over');
    nodeElement.classList.remove('dragging-over');
  },
  
  // Remove highlighting from all loop nodes
  removeAllHighlights: () => {
    document.querySelectorAll('.react-flow__node-group.dragging-over, .loop-node-drag-over, .dragging-over')
      .forEach(node => {
        node.classList.remove('loop-node-drag-over');
        node.classList.remove('dragging-over');
      });
  },
  
  // Clean up any leftover drag data attributes
  clearDragData: (nodeElement: HTMLElement | null) => {
    if (nodeElement && nodeElement.hasAttribute('data-drag-data')) {
      nodeElement.removeAttribute('data-drag-data');
    }
  }
};

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
  const { project, getNodes } = useReactFlow()
  const reactFlowInstance = useReactFlow()

  // Store access
  const { workflows, setActiveWorkflow, createWorkflow } = useWorkflowRegistry()
  const { blocks, edges, addBlock, updateBlockPosition, addEdge, removeEdge, updateParentId } =
    useWorkflowStore()
  const { setValue: setSubBlockValue } = useSubBlockStore()
  const { markAllAsRead } = useNotificationStore()
  const { resetLoaded: resetVariablesLoaded } = useVariablesStore()

  // Execution and debug mode state
  const { activeBlockIds, pendingBlocks } = useExecutionStore()
  const { isDebugModeEnabled } = useGeneralStore()

  // Track group nodes that are currently being dragged so we can ignore
  // synthetic child position events that React-Flow emits while the parent
  // is moving.  This prevents us from overwriting the child positions that
  // we already updated in the store when the parent moved.
  const draggingParentsRef = useRef<Set<string>>(new Set())

  // Track whether we're currently handling edge selection to prevent unnecessary position fixing
  const isHandlingEdgeSelection = useRef(false);

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

    // Add block nodes
    Object.entries(blocks).forEach(([blockId, block]) => {
      if (!block.type || !block.name) {
        logger.warn(`Skipping invalid block: ${blockId}`, { block })
        return
      }

      // Handle loop nodes
      if (block.type === 'loop') {
        nodeArray.push({
          id: block.id,
          type: 'loop',
          position: block.position,
          positionAbsolute: { x: block.position.x, y: block.position.y },
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

      // Process parent-child relationships
      const parentId = block.data?.parentId;
      
      // Handle child nodes (nodes inside a loop)
      if (parentId && blocks[parentId]) {
        const parentBlock = blocks[parentId];
        // Calculate position relative to parent
        const relativePosition = {
            x: block.position.x - parentBlock.position.x,
            y: block.position.y - parentBlock.position.y,
        };

        // Create child node with parent relationship
        nodeArray.push({
          id: block.id,
          type: 'workflowBlock',
          position: relativePosition,
          draggable: true,
          extent: 'parent',
          parentId,
          data: {
            type: block.type,
            config: blockConfig,
            name: block.name,
            isActive,
            isPending,
            _relativePosition: {...relativePosition},
            _absolutePosition: {...block.position},
            parentId,
            extent: 'parent',
            isChildNode: true
          },
        });
        return;
      }
      
      // Create regular node (not a child of any loop)
      nodeArray.push({
        id: block.id,
        type: 'workflowBlock',
        position: block.position,
        draggable: true,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          isActive,
          isPending,
          positionAbsolute: { x: block.position.x, y: block.position.y },
        },
      });
    })

    return nodeArray
  }, [blocks, activeBlockIds, pendingBlocks, isDebugModeEnabled])

  // After the nodes useMemo, add this effect to log when nodes change
  useEffect(() => {
    // Find all parent-child relationships to validate they're set correctly
    const childNodes = nodes.filter(node => node.parentId);
    if (childNodes.length > 0) {
      logger.info('Current parent-child relationships:', {
        childCount: childNodes.length,
        relationships: childNodes.map(node => ({
          nodeId: node.id,
          nodeType: node.data?.type || node.type,
          parentId: node.parentId,
          relativePosition: node.position
        }))
      });
    }
  }, [nodes]);

  // Force Parent-Child Consistency - ensures child nodes maintain correct positions
  const ensureChildPositions = useCallback(() => {
    if (isHandlingEdgeSelection.current) return;
    
    const allNodes = getNodes();
    const parentNodes = allNodes.filter(node => node.type === 'loop');
    const childNodes = allNodes.filter(node => node.parentId);
    
    if (childNodes.length === 0) return;
    
    // Build parent position map
    const parentPositions: Record<string, { x: number; y: number }> = {};
    parentNodes.forEach(parent => {
      parentPositions[parent.id] = parent.position;
    });
    
    // Check and fix child nodes
    let needsFix = false;
    const fixedNodes = childNodes.map(child => {
      const parentId = child.parentId as string;
      const parentPos = parentPositions[parentId];
      if (!parentPos) return child;
      
      // Get stored positions from the store
      const storeBlock = blocks[child.id];
      if (!storeBlock?.data) return child;
      
      // Get expected relative position
      const expectedRelPos = storeBlock.data._relativePosition || {
        x: storeBlock.position.x - blocks[parentId].position.x,
        y: storeBlock.position.y - blocks[parentId].position.y
      };
      
      // Check if current position matches expected
      if (Math.abs(child.position.x - expectedRelPos.x) > 0.1 ||
          Math.abs(child.position.y - expectedRelPos.y) > 0.1) {
        needsFix = true;
        return {
          ...child,
          position: { ...expectedRelPos },
          positionAbsolute: {
            x: parentPos.x + expectedRelPos.x,
            y: parentPos.y + expectedRelPos.y
          }
        };
      }
      
      return child;
    });
    
    if (needsFix) {
      // Apply position fixes
      logger.info('Fixing child node positions that drifted from expected values');
      reactFlowInstance.setNodes(nodes => {
        const nonChildNodes = nodes.filter(n => !n.parentId);
        return [...nonChildNodes, ...fixedNodes];
      });
    }
  }, [blocks, getNodes, reactFlowInstance]);

  // Simplified onNodesChange handler
  const onNodesChange = useCallback(
    (changes: any) => {
      if (!Array.isArray(changes) || changes.length === 0) return;

      // Skip processing if we're handling edge selection
      if (isHandlingEdgeSelection.current) {
        return;
      }

      // Track parent nodes being moved in this batch
      const movedParentIds = new Set<string>();
      
      changes.forEach((c: any) => {
        if (c.type === 'position' && c.dragging) {
          // Track parent nodes
          const blk = blocks[c.id];
          if (blk?.type === 'loop') {
            movedParentIds.add(c.id);
            draggingParentsRef.current.add(c.id);
          }
        }
      });

      // Process position changes
      changes.forEach((change: any) => {
        if (change.type !== 'position' || !change.position) return;

        const block = blocks[change.id];
        if (!block) return;
        
        // Get parentId
        const parentId = block.data?.parentId;
        
        // For child nodes being dragged within parent
        if (parentId) {
          // If parent is being moved, let ReactFlow handle child positions
          if (movedParentIds.has(parentId)) {
            return;
          }
          
          // For child nodes with stationary parents, calculate absolute position
          const parentPos = blocks[parentId]?.position;
          if (parentPos) {
            const absolute = {
              x: parentPos.x + change.position.x,
              y: parentPos.y + change.position.y,
            };
            updateBlockPosition(change.id, absolute);
          }
        } else {
          // For parent/independent nodes, directly update position
          updateBlockPosition(change.id, change.position);
        }
      });
      
      // Release the dragging parents lock after a short delay
      if (movedParentIds.size > 0) {
        setTimeout(() => {
          movedParentIds.forEach(id => {
            draggingParentsRef.current.delete(id);
          });
        }, 100);
      }
    },
    [blocks, updateBlockPosition],
  );

  // Update the onDrop handler
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      // If the drop target is a loop node, let the loop node handle it
      const loopNodeElement = (event.target as HTMLElement).closest('.react-flow__node-group')
      if (loopNodeElement) {
        return
      }

      try {
        const rawData = event.dataTransfer.getData('application/json')
        if (!rawData) return;
        
        const data = JSON.parse(rawData)
        const type = data.type || (data.data && data.data.type)
        
        if (!type || type === 'connectionBlock' || type === 'starter') {
          return
        }
        
        // Calculate drop position in ReactFlow coordinates
        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })

        // Special handling for loop nodes
        if (type === 'loop') {
          const id = crypto.randomUUID()
          const name = `Loop ${Object.values(blocks).filter((b) => b.type === type).length + 1}`

          // Add the loop with proper configuration
          addBlock(id, type, name, position, {
            width: 800,
            height: 1000,
            loopType: 'for',
            count: 5,
            collection: '',
          })

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

          logger.info('Dropped loop block:', { id, name, position })

          return
        }

        // Regular block handling
        const blockConfig = getBlock(type)
        if (!blockConfig) return;

        const id = crypto.randomUUID()
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === type).length + 1
        }`

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
        logger.info('Dropped block:', { id, name, position })
      } 
      catch (err) {
        logger.error('Error dropping block:', { err })
      }
    },
    [project, blocks, addBlock, addEdge, findClosestOutput, determineSourceHandle]
  )

  // Update the onDragOver handler
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    
    // Let loop nodes handle their own highlighting
    const loopNode = (event.target as HTMLElement).closest('.react-flow__node-group')
    if (!loopNode) return;
    
    try {
        const rawData = event.dataTransfer.getData('application/json')
      if (!rawData) return;
      
          const data = JSON.parse(rawData)
          const type = data.type || (data.data && data.data.type)
          
          // Only highlight if it's not a starter block
          if (type && type !== 'starter' && type !== 'connectionBlock') {
            loopNode.classList.add('dragging-over')
      }
    } catch (error) {
      logger.error('Error in onDragOver:', { error })
    }
  }, [])

  // Update the onDragEnd handler
  const onDragEnd = useCallback(() => {
    // Remove highlighting from all loop nodes
    domUtils.removeAllHighlights();
    
    // Clean up any leftover drag data
    const nodeToClear = document.querySelector('[data-drag-data]');
    if (nodeToClear) {
      nodeToClear.removeAttribute('data-drag-data');
    }
  }, []);

  // Simplified node drag start handler
  const onNodeDragStart = useCallback((event: React.MouseEvent, node: any) => {
    // If we start dragging a group/loop node, remember its id
    if (node.type === 'loop') {
      draggingParentsRef.current.add(node.id)
      return;
    }
    
    // For child nodes (with parentId), let ReactFlow handle dragging natively
    if (node.parentId) {
      return;
    }
    
    // Skip starter blocks
    if (node.data?.type === 'starter') {
      return;
    }
    
    // For standalone nodes, add drag data for potential loop transfer
    const nodeElement = domUtils.getNodeElement(node.id);
    if (nodeElement) {
      const dragData = {
        type: node.data?.type,
        id: node.id,
        isExistingNode: true
      };
      
      nodeElement.setAttribute('data-drag-data', JSON.stringify(dragData));
    }
  }, []);

  // Simplified node drag handler
  const onNodeDrag = useCallback((event: React.MouseEvent, node: any) => {
    // If it's a child node inside a parent, let ReactFlow handle it natively
    if (node.parentId) {
      return;
    }
    
    // Skip group/loop nodes and starter blocks
    if (node.data?.type === 'starter' || node.type === 'loop') { //removed node.type === 'group'
      return;
    }
    
    // Original logic for highlighting potential parent loops
    const nodeElement = domUtils.getNodeElement(node.id);
    if (!nodeElement) return;
    
    const nodeRect = nodeElement.getBoundingClientRect();
    const nodeCenterX = nodeRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2;
    
    // Find all loop nodes and check if this node is over one
    const loopNodes = document.querySelectorAll('.react-flow__node-group');
    let foundLoop = false;
    
    for (const loopNodeEl of loopNodes) {
      const loopId = loopNodeEl.getAttribute('data-id');
      if (!loopId) continue;
      
      // Check if node is over this loop
      const loopRect = loopNodeEl.getBoundingClientRect();
      if (
        nodeCenterX >= loopRect.left && 
        nodeCenterX <= loopRect.right && 
        nodeCenterY >= loopRect.top && 
        nodeCenterY <= loopRect.bottom
      ) {
        domUtils.addDragHighlight(loopNodeEl as HTMLElement);
        foundLoop = true;
      } else {
        domUtils.removeDragHighlight(loopNodeEl as HTMLElement);
      }
    }
    
    // Remove all highlights if not over any loop
    if (!foundLoop) {
      domUtils.removeAllHighlights();
    }
  }, []);

  // Simplified node drag stop handler
  const onNodeDragStop = useCallback((event: React.MouseEvent, node: any) => {
    // For child nodes, let ReactFlow handle positioning natively
    if (node.parentId) {
      return;
    }
    
    // Skip group/loop nodes and starter blocks
    if (node.data?.type === 'starter' || node.type === 'loop') { //removed node.type === 'group'
      return;
    }

    // Clean up any visual effects
    domUtils.removeAllHighlights();

    // Get node center point for loop detection
    const nodeElement = domUtils.getNodeElement(node.id);
    if (!nodeElement) return;

    const nodeRect = nodeElement.getBoundingClientRect();
    const nodeCenterX = nodeRect.left + nodeRect.width / 2;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2;

    // Find all loop nodes and check if this node is over one
    const loopNodes = document.querySelectorAll('.react-flow__node-group');
    
    for (const loopNodeEl of loopNodes) {
      const loopId = loopNodeEl.getAttribute('data-id');
      if (!loopId) continue;

      // Check if node center is within loop node bounds
      const loopRect = loopNodeEl.getBoundingClientRect();
      if (
        nodeCenterX >= loopRect.left && 
        nodeCenterX <= loopRect.right && 
        nodeCenterY >= loopRect.top && 
        nodeCenterY <= loopRect.bottom
      ) {
        // Update the parent relationship
        updateParentId(node.id, loopId, 'parent');
        
        break;
      }
    }
    
    // Clean up any leftover drag data
    domUtils.clearDragData(nodeElement);

    // Clear the dragging flag for group/loop nodes
    if ( node.type === 'loop') { //removed node.type === 'group'
      draggingParentsRef.current.delete(node.id)
    }
  }, [updateParentId]);

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
        // 1. First, capture current state before we do anything
        const allNodes = getNodes();
        const childNodeMap = new Map();
        
        // Capture ALL nodes with their parents and positions
        allNodes.forEach(node => {
          if (node.parentId) {
            const parentNode = allNodes.find(p => p.id === node.parentId);
            if (parentNode) {
              childNodeMap.set(node.id, {
                childId: node.id,
                childPosition: { ...node.position },
                parentId: node.parentId,
                parentPosition: { ...parentNode.position }
              });
            }
          }
        });
        
        // 2. Set the flag to indicate we're handling edge operation
        isHandlingEdgeSelection.current = true;
        
        // 3. Calculate expected absolute positions for all child nodes
        const expectedPositions = new Map();
        childNodeMap.forEach((info, nodeId) => {
          expectedPositions.set(nodeId, {
            absolute: {
              x: info.parentPosition.x + info.childPosition.x,
              y: info.parentPosition.y + info.childPosition.y
            },
            relative: { ...info.childPosition }
          });
        });
        
        // 4. Add the edge - this will trigger ReactFlow's rerender
        addEdge({
          ...connection,
          id: crypto.randomUUID(),
          type: 'workflowEdge',
        });
        
        // 5. Run an immediate position check/correction
        queueMicrotask(() => {
          // Get nodes post-edge addition to see what changed
          const updatedNodes = getNodes();
          let positionsFixed = 0;
          
          // Fix any nodes that lost their proper positioning
          reactFlowInstance.setNodes(nodes => 
            nodes.map(node => {
              // Only process child nodes
              if (!node.parentId) return node;
              
              const expectedPos = expectedPositions.get(node.id);
              if (!expectedPos) return node;
              
              // Find the current parent node
              const parentNode = updatedNodes.find(p => p.id === node.parentId);
              if (!parentNode) return node;
              
              // Check if position is significantly different from expected
              if (Math.abs(node.position.x - expectedPos.relative.x) > 0.1 || 
                  Math.abs(node.position.y - expectedPos.relative.y) > 0.1) {
                
                positionsFixed++;
                // Log detailed fix information
                logger.info(`Fixing child node ${node.id} position during edge creation`, {
                  current: node.position,
                  expected: expectedPos.relative,
                  parentId: node.parentId
                });
                
                // Return fixed node
                return {
                  ...node,
                  position: { ...expectedPos.relative },
                  positionAbsolute: {
                    x: parentNode.position.x + expectedPos.relative.x,
                    y: parentNode.position.y + expectedPos.relative.y
                  }
                };
              }
              
              return node;
            })
          );
          
          if (positionsFixed > 0) {
            logger.info(`Fixed positions for ${positionsFixed} child nodes during edge creation`);
          }
          
          // Clear flag after position fixes
          isHandlingEdgeSelection.current = false;
        });
      }
    },
    [addEdge, getNodes, reactFlowInstance]
  );

  // Update onPaneClick to only handle edge selection
  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null)
  }, [])

  // Helper to check if an edge is within a loop
  const isEdgeWithinLoop = useCallback((edge: any, nodes: any[]) => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    
    return sourceNode?.parentId && 
      targetNode?.parentId && 
      sourceNode.parentId === targetNode.parentId;
  }, []);
  
  // Lightweight edge wrapper: only selection/delete handling – no manual node repair here
  const createEdgeWithCustomDelete = useCallback((edge: any) => ({
    ...edge,
    type: edge.type || 'workflowEdge',
    data: {
      selectedEdgeId,
      isWithinLoop: isEdgeWithinLoop(edge, getNodes()),
      isLoopStartEdge: edge.sourceHandle === 'loop-start-source',
      onDelete: (edgeId: string) => {
        logger.info(`Deleting edge: ${edgeId}`)
        removeEdge(edgeId)
        setSelectedEdgeId(null)
      },
    },
  }), [selectedEdgeId, isEdgeWithinLoop, getNodes, removeEdge]);
  
  // Transform edges to include selection state
  const edgesWithSelection = useMemo(() => 
    edges.map(edge => createEdgeWithCustomDelete(edge)), 
    [edges, createEdgeWithCustomDelete]
  );

  // Update onEdgeClick to properly handle edge selection without affecting child positions
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    event.stopPropagation();
    
    console.log('----------- EDGE SELECTION START -----------');
    
    // 1. Log initial state
    const beforeNodes = getNodes();
    const childNodesBefore = beforeNodes.filter(node => node.parentId);
    
    console.log('Before selection - All nodes count:', beforeNodes.length);
    console.log('Before selection - Child nodes count:', childNodesBefore.length);
    
    console.log('Child nodes before selection:', childNodesBefore.map(node => ({
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      position: { ...node.position },
      positionAbsolute: node.positionAbsolute ? { ...node.positionAbsolute } : 'undefined'
    })));
    
    // 1. First, capture current state before we do anything
    const allNodes = getNodes();
    const childNodeMap = new Map();
    
    // Capture ALL nodes with their parents and positions
    allNodes.forEach(node => {
      if (node.parentId) {
        const parentNode = allNodes.find(p => p.id === node.parentId);
        if (parentNode) {
          childNodeMap.set(node.id, {
            childId: node.id,
            childPosition: { ...node.position },
            parentId: node.parentId,
            parentPosition: { ...parentNode.position }
          });
        }
      }
    });
    
    // 2. Set the flag to indicate we're handling edge selection
    isHandlingEdgeSelection.current = true;
    
    // 3. Calculate expected absolute positions for all child nodes
    const expectedPositions = new Map();
    childNodeMap.forEach((info, nodeId) => {
      expectedPositions.set(nodeId, {
        absolute: {
          x: info.parentPosition.x + info.childPosition.x,
          y: info.parentPosition.y + info.childPosition.y
        },
        relative: { ...info.childPosition }
      });
    });
    
    console.log('Expected positions for child nodes:', Object.fromEntries(expectedPositions));
    
    // 4. Update selected edge - this will trigger ReactFlow's rerender
    setSelectedEdgeId(edge.id);
    
    // 5. Run an immediate position check/correction
    queueMicrotask(() => {
      // Get nodes post-selection to see what changed
      const updatedNodes = getNodes();
      const childNodesAfter = updatedNodes.filter(node => node.parentId);
      
      console.log('After selection - All nodes count:', updatedNodes.length);
      console.log('After selection - Child nodes count:', childNodesAfter.length);
      
      console.log('Child nodes after selection:', childNodesAfter.map(node => ({
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        position: { ...node.position },
        positionAbsolute: node.positionAbsolute ? { ...node.positionAbsolute } : 'undefined',
        hasChanged: expectedPositions.has(node.id) ? 
          Math.abs(node.position.x - expectedPositions.get(node.id).relative.x) > 0.1 ||
          Math.abs(node.position.y - expectedPositions.get(node.id).relative.y) > 0.1 : 'N/A'
      })));
      
      // Check if any child nodes disappeared
      const beforeIds = new Set(childNodesBefore.map(n => n.id));
      const afterIds = new Set(childNodesAfter.map(n => n.id));
      
      const missingNodes = [...beforeIds].filter(id => !afterIds.has(id));
      const newNodes = [...afterIds].filter(id => !beforeIds.has(id));
      
      if (missingNodes.length > 0) {
        console.log('ALERT: Some child nodes disappeared after edge selection:', missingNodes);
      }
      
      if (newNodes.length > 0) {
        console.log('ALERT: New child nodes appeared after edge selection:', newNodes);
      }
      
      let positionsFixed = 0;
      
      // Fix any nodes that lost their proper positioning
      reactFlowInstance.setNodes(nodes => 
        nodes.map(node => {
          // Only process child nodes
          if (!node.parentId) return node;
          
          const expectedPos = expectedPositions.get(node.id);
          if (!expectedPos) {
            console.log('No expected position found for child node:', node.id);
            return node;
          }
          
          // Find the current parent node
          const parentNode = updatedNodes.find(p => p.id === node.parentId);
          if (!parentNode) {
            console.log('Parent node not found for child:', node.id, 'parentId:', node.parentId);
            return node;
          }
          
          // Check if position is significantly different from expected
          const positionChanged = 
            Math.abs(node.position.x - expectedPos.relative.x) > 0.1 || 
            Math.abs(node.position.y - expectedPos.relative.y) > 0.1;
            
          if (positionChanged) {
            positionsFixed++;
            
            console.log('Fixing child node position:', {
              nodeId: node.id,
              current: { ...node.position },
              expected: { ...expectedPos.relative },
              delta: {
                x: node.position.x - expectedPos.relative.x,
                y: node.position.y - expectedPos.relative.y
              }
            });
            
            // Return fixed node
            return {
              ...node,
              position: { ...expectedPos.relative },
              positionAbsolute: {
                x: parentNode.position.x + expectedPos.relative.x,
                y: parentNode.position.y + expectedPos.relative.y
              }
            };
          }
          
          return node;
        })
      );
      
      if (positionsFixed > 0) {
        console.log(`Fixed positions for ${positionsFixed} child nodes during edge selection`);
      }
      
      // Log final state
      const finalNodes = getNodes();
      const finalChildNodes = finalNodes.filter(node => node.parentId);
      
      console.log('Final child nodes after fixes:', finalChildNodes.map(node => ({
        id: node.id,
        position: { ...node.position },
        positionAbsolute: node.positionAbsolute ? { ...node.positionAbsolute } : 'undefined'
      })));
      
      console.log('----------- EDGE SELECTION END -----------');
      
      // Clear flag after position fixes
      isHandlingEdgeSelection.current = false;
    });
  }, [getNodes, reactFlowInstance, setSelectedEdgeId]);

  // Keyboard shortcuts: delete selected edge
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdgeId) {
        removeEdge(selectedEdgeId)
        setSelectedEdgeId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeId, removeEdge])

  // Listen for sub-block value updates
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      const { blockId, subBlockId, value } = event.detail as any
      if (blockId && subBlockId) {
        setSubBlockValue(blockId, subBlockId, value)
      }
    }
    window.addEventListener('update-subblock-value', handler as EventListener)
    return () => window.removeEventListener('update-subblock-value', handler as EventListener)
  }, [setSubBlockValue])

  // Run position checks periodically to ensure child nodes stay in correct positions
  useEffect(() => {
    // Skip position checks if there are no loop nodes
    const hasLoopNodes = Object.values(blocks).some(block => block.type === 'loop');
    if (!hasLoopNodes) return;
    
    // Check positions after any operation that might affect them
    const checkPositionsAfterUserAction = () => {
      if (!isHandlingEdgeSelection.current) {
        ensureChildPositions();
      }
    };
    
    // Set up listeners for operations that might disrupt positions
    window.addEventListener('mouseup', checkPositionsAfterUserAction);
    
    // Periodic check as an additional safety measure
    const intervalId = setInterval(() => {
      if (!isHandlingEdgeSelection.current) {
        ensureChildPositions();
      }
    }, 2000); // Check every 2 seconds
    
    return () => {
      window.removeEventListener('mouseup', checkPositionsAfterUserAction);
      clearInterval(intervalId);
    };
  }, [blocks, ensureChildPositions]);

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
          edgeTypes={edgeTypes}
          
          // Node properties
          nodeOrigin={[0.5, 0.5]}
          nodesConnectable={true}
          nodesDraggable={true}
          nodesFocusable={false}
          
          // Event handlers
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeDrag={onNodeDrag}
          onPaneClick={onPaneClick}
          onEdgeClick={onEdgeClick}
          onNodeClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
          
          // View properties
          fitView
          minZoom={0.1}
          maxZoom={1.3}
          panOnScroll
          selectNodesOnDrag={false}
          
          // Edge properties
          defaultEdgeOptions={{ type: 'custom' }}
          elevateEdgesOnSelect={false}
          connectionLineStyle={{
            stroke: '#94a3b8',
            strokeWidth: 2,
            strokeDasharray: '5,5',
          }}
          connectionLineType={ConnectionLineType.SmoothStep}
          edgesFocusable={false}
          edgesUpdatable={true}
          
          // Misc properties
          proOptions={{ hideAttribution: true }}
          draggable={false}
          noWheelClassName="allow-scroll"
          elementsSelectable={true}
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