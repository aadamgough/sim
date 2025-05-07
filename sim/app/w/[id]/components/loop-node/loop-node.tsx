import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { deleteElements, getNode, getNodes, setNodes } = useReactFlow()
  const {
    removeBlock,
    updateNodeDimensions
  } = useWorkflowStore()
  
  // State to track if a valid block is being dragged over
  const [isValidDragOver, setIsValidDragOver] = useState(false)
  
  // Set up drag event handlers
  useEffect(() => {
    const nodeElement = document.querySelector(`[data-id="${id}"]`)
    if (!nodeElement) return
    
    const handleDragOver = (e: Event) => {
      e.preventDefault()
      
      try {
        const dragEvent = e as DragEvent
        if (dragEvent.dataTransfer?.getData) {
          try {
            const rawData = dragEvent.dataTransfer.getData('application/json')
            if (rawData) {
              const data = JSON.parse(rawData)
              // Check if it's not a starter block
              const type = data.type || (data.data && data.data.type)
              if (type && type !== 'starter') {
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
        setIsValidDragOver(false)
      }
    }
    
    const handleDragLeave = () => {
      setIsValidDragOver(false)
    }
    
    const handleDrop = () => {
      setIsValidDragOver(false)
    }
    
    nodeElement.addEventListener('dragover', handleDragOver as EventListener)
    nodeElement.addEventListener('dragleave', handleDragLeave)
    nodeElement.addEventListener('drop', handleDrop)
    
    return () => {
      nodeElement.removeEventListener('dragover', handleDragOver as EventListener)
      nodeElement.removeEventListener('dragleave', handleDragLeave)
      nodeElement.removeEventListener('drop', handleDrop)
    }
  }, [id])
  
  const handleResize = useCallback((evt: any, { width, height }: { width: number; height: number }) => {
    logger.info('Loop node resized:', { id, width, height })
    
    // Always ensure minimum dimensions
    const minWidth = 800
    const minHeight = 600
    
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
    // Delete this loop node
    const node = getNode(id)
    if (node) {
      deleteElements({ nodes: [node] })
      removeBlock(id)
    }
  }

  return (
    <div className="relative">
      <NodeResizer 
        minWidth={800} 
        minHeight={600}
        isVisible={selected}
        lineClassName="border-primary"
        handleClassName="h-3 w-3 bg-primary border-primary"
        keepAspectRatio={false}
        onResize={handleResize}
      />
      <div 
        style={{
          width: data.width || 800,
          height: data.height || 600,
          border: isValidDragOver ? '2px solid #40E0D0' : '2px dashed #94a3b8',
          backgroundColor: isValidDragOver ? 'rgba(34,197,94,0.05)' : 'transparent',
          borderRadius: '8px',
          position: 'relative',
          boxShadow: 'none',
          outline: 'none !important',
        }}
        className={cn(
          'transition-all duration-200',
          selected && '!ring-0 !border-none !outline-none !shadow-none',
          data?.state === 'valid' && 'border-[#40E0D0] bg-[rgba(34,197,94,0.05)]'
        )}
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
        <div className="p-4 h-[calc(100%-40px)]" data-dragarea="true">
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