import { memo, useCallback, useState, useEffect } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X, ChevronDown, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'
import Editor from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { deleteElements, getNode, getNodes, setNodes } = useReactFlow()
  const {
    loops,
    removeBlock,
    updateLoopType,
    updateLoopIterations,
    updateLoopForEachItems,
    updateNodeDimensions
  } = useWorkflowStore()
  
  // State for loop configuration
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false)
  const [inputPopoverOpen, setInputPopoverOpen] = useState(false)
  const [inputValue, setInputValue] = useState(String(data.count || 5))
  const [editorValue, setEditorValue] = useState(data.collection || '')

  // Auto-resize effect when child nodes change
  useEffect(() => {
    const loopData = loops[id]
    if (loopData && loopData.nodes && loopData.nodes.length > 0) {
      const currentWidth = data.width || 800
      const currentHeight = data.height || 500
      
      // Get all nodes in this loop
      const childNodes = getNodes().filter(node => node.parentId === id)
      if (childNodes.length === 0) return
      
      // Calculate the space needed for the child nodes
      let rightmostPosition = 0
      let bottommostPosition = 0
      
      childNodes.forEach(node => {
        // Default node dimensions (approximated)
        const nodeWidth = 320
        const nodeHeight = 180
        
        const nodeRight = node.position.x + nodeWidth
        const nodeBottom = node.position.y + nodeHeight
        
        rightmostPosition = Math.max(rightmostPosition, nodeRight)
        bottommostPosition = Math.max(bottommostPosition, nodeBottom)
      })
      
      // Add generous padding
      const horizontalPadding = 350
      const verticalPadding = 450
      
      const neededWidth = Math.max(800, rightmostPosition + horizontalPadding)
      const neededHeight = Math.max(500, bottommostPosition + verticalPadding)
      
      // Only update if we need more space
      if (neededWidth > currentWidth || neededHeight > currentHeight) {
        logger.info('Auto-resizing loop node:', { id, width: neededWidth, height: neededHeight })
        updateNodeDimensions(id, { 
          width: neededWidth, 
          height: neededHeight 
        })
      }
    }
  }, [loops, id, data.width, data.height, getNodes, updateNodeDimensions])

  const onDelete = () => {
    // Delete this loop node
    const node = getNode(id)
    if (node) {
      deleteElements({ nodes: [node] })
      removeBlock(id)
    }
  }

  const handleLoopTypeChange = (loopType: 'for' | 'forEach') => {
    logger.info('Changing loop type:', { id, loopType })
    updateLoopType(id, loopType)
    setLabelPopoverOpen(false)
  }

  const getLoopLabel = () => {
    switch (data.loopType) {
      case 'for':
        return 'For loop'
      case 'forEach':
        return 'For each'
      default:
        return 'For loop'
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputSave = () => {
    // Validate input (must be a number between 1 and 50)
    const numValue = parseInt(inputValue)
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 50) {
      updateLoopIterations(id, numValue)
    } else {
      // Reset to current value if invalid
      setInputValue(String(data.count || 5))
    }
    setInputPopoverOpen(false)
  }

  const handleEditorChange = (value: string) => {
    setEditorValue(value)
    updateLoopForEachItems(id, value)
  }

  const getInputLabel = () => {
    switch (data.loopType) {
      case 'for':
        return `Iterations: ${data.count || 5}`
      case 'forEach':
        return 'Items'
      default:
        return `Iterations: ${data.count || 5}`
    }
  }

  const handleResize = useCallback((evt: any, { width, height }: { width: number; height: number }) => {
    logger.info('Loop node resized:', { id, width, height })
    
    // Always ensure minimum dimensions
    const minWidth = 800
    const minHeight = 500
    
    const finalWidth = Math.max(width, minWidth)
    const finalHeight = Math.max(height, minHeight)
    
    updateNodeDimensions(id, { width: finalWidth, height: finalHeight })
  }, [id, updateNodeDimensions])

  logger.info('Rendering loop node:', { 
    id, 
    selected, 
    data: {
      label: data.label,
      state: data.state,
    }
  })

  return (
    <div className="group relative">
      <NodeResizer 
        minWidth={800} 
        minHeight={600}
        isVisible={selected}
        lineClassName="border-primary"
        handleClassName="h-3 w-3 bg-primary border-primary"
        keepAspectRatio={false}
        onResize={handleResize}
      />
      <Card 
        className={cn(
          'relative flex flex-col min-w-[800px] min-h-[600px] bg-background/50 p-4',
          'border-2 border-dashed border-gray-400',
          'transition-all duration-200',
          selected && 'ring-2 ring-primary ring-offset-2',
          'drag-target'
        )}
        style={{
          width: data.width || 800,
          height: data.height || 600,
          pointerEvents: 'all',
          borderColor: data?.state === 'valid' ? '#40E0D0' : undefined,
          backgroundColor: data?.state === 'valid' ? 'rgba(34, 197, 94, 0.05)' : undefined,
        }}
      >
        <button
          className={cn(
            'absolute right-2 top-2 p-1 rounded-md hover:bg-accent',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'text-muted-foreground hover:text-foreground'
          )}
          onClick={onDelete}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 mb-4 workflow-drag-handle cursor-move">
          <div className="flex items-center justify-center w-7 h-7 rounded bg-[#40E0D0]">
            <RepeatIcon className="w-5 h-5 text-white" />
          </div>
          
          {/* Loop Type Selection */}
          <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
            <PopoverTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'bg-background border-border text-foreground font-medium pr-1.5 pl-2.5 py-0.5 text-sm',
                  'hover:bg-accent/50 transition-colors duration-150 cursor-pointer',
                  'flex items-center gap-1'
                )}
              >
                {getLoopLabel()}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1" align="start">
              <div className="text-sm">
                <div
                  className={cn(
                    'px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 transition-colors duration-150',
                    data.loopType === 'for' && 'bg-accent'
                  )}
                  onClick={() => handleLoopTypeChange('for')}
                >
                  <span>For loop</span>
                </div>
                <div
                  className={cn(
                    'px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 transition-colors duration-150',
                    data.loopType === 'forEach' && 'bg-accent'
                  )}
                  onClick={() => handleLoopTypeChange('forEach')}
                >
                  <span>For each</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Loop Input Configuration */}
          <Popover open={inputPopoverOpen} onOpenChange={setInputPopoverOpen}>
            <PopoverTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'bg-background border-border text-foreground font-medium px-2.5 py-0.5 text-sm',
                  'hover:bg-accent/50 transition-colors duration-150 cursor-pointer'
                )}
              >
                {getInputLabel()}
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-3" align="start">
              <div>
                <div className="text-sm font-medium mb-2">
                  {data.loopType === 'for' ? 'Number of iterations' : 'Collection to iterate over'}
                </div>

                {data.loopType === 'for' ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={inputValue}
                      onChange={handleInputChange}
                      onBlur={handleInputSave}
                      className="h-8 text-sm"
                    />
                  </div>
                ) : (
                  <div className="relative min-h-[80px] rounded-md bg-background font-mono text-sm px-3 pt-2 pb-3 border border-input">
                    <Editor
                      value={editorValue}
                      onValueChange={handleEditorChange}
                      highlight={(code) => highlight(code, languages.javascript, 'javascript')}
                      padding={0}
                      style={{
                        fontFamily: 'monospace',
                        lineHeight: '21px',
                      }}
                      className="focus:outline-none w-full"
                      textareaClassName="focus:outline-none focus:ring-0 bg-transparent resize-none w-full"
                    />
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground">
                  {data.loopType === 'for'
                    ? 'Enter a number between 1 and 50'
                    : 'Array or object to iterate over'}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Container for child nodes */}
        <div className={cn(
          "flex-1 border border-dashed rounded-md p-2 transition-all duration-200 mt-4",
          data?.state === 'valid' ? 'border-green-500/30 bg-green-50/5' : 'border-gray-300',
          "relative min-h-[100px]",
          "group-hover:border-primary/30",
          "after:content-['Connect blocks to loop start'] after:absolute after:top-1 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:text-muted-foreground/50 after:pointer-events-none after:opacity-0 after:transition-opacity group-hover:after:opacity-100",
          "loop-drop-container"
        )}>
          {/* Simple Static Loop Start Block */}
          <div className="absolute top-20 left-10 w-28 flex flex-col items-center">
            <div className="bg-[#40E0D0]/20 border border-[#40E0D0]/50 rounded-md p-2 relative">
              <div className="flex items-center justify-center gap-1.5">
                <PlayCircle size={16} className="text-[#40E0D0]" />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 text-center">
                {data?.loopType === 'for' ? `${data?.count || 5} iterations` : 'For each item'}
              </div>
              
              {/* Fixed, stable handle position */}
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
          
          {/* Child nodes are rendered here by React Flow */}
        </div>

        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 !w-3 !h-3"
        />
        <Handle
          type="target"
          position={Position.Right}
          className="!bg-gray-400 !w-3 !h-3"
        />
      </Card>
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 