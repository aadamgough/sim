import { memo, useCallback, useState } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X, ChevronDown } from 'lucide-react'
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
  const { deleteElements, getNode } = useReactFlow()
  const removeBlock = useWorkflowStore((state) => state.removeBlock)
  const updateLoopType = useWorkflowStore((state) => state.updateLoopType)
  const updateLoopIterations = useWorkflowStore((state) => state.updateLoopIterations)
  const updateLoopForEachItems = useWorkflowStore((state) => state.updateLoopForEachItems)
  const updateNodeDimensions = useWorkflowStore((state) => state.updateNodeDimensions)

  // Local state
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false)
  const [inputPopoverOpen, setInputPopoverOpen] = useState(false)
  const [inputValue, setInputValue] = useState(data.count?.toString() || '5')
  const [editorValue, setEditorValue] = useState(data.collection || '')

  const onDelete = useCallback(() => {
    logger.info('Deleting loop node:', { id })
    removeBlock(id)
    deleteElements({ nodes: [{ id }] })
  }, [deleteElements, id, removeBlock])

  // Loop type management
  const getLoopLabel = () => {
    switch (data.loopType) {
      case 'for':
        return 'For loop'
      case 'forEach':
        return 'For each'
      default:
        return 'Loop'
    }
  }

  const handleLoopTypeChange = (type: 'for' | 'forEach') => {
    updateLoopType(id, type)
    setLabelPopoverOpen(false)
  }

  // Input management
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = parseInt(sanitizedValue)

    if (!isNaN(numValue)) {
      setInputValue(Math.min(50, numValue).toString())
    } else {
      setInputValue(sanitizedValue)
    }
  }

  const handleInputSave = () => {
    const value = parseInt(inputValue)
    if (!isNaN(value)) {
      const newValue = Math.min(50, Math.max(1, value))
      updateLoopIterations(id, newValue)
      setInputValue(newValue.toString())
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
    updateNodeDimensions(id, { width, height })
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
        minWidth={300} 
        minHeight={200}
        isVisible={selected}
        lineClassName="border-primary"
        handleClassName="h-3 w-3 bg-primary border-primary"
        keepAspectRatio={false}
        onResize={handleResize}
      />
      <Card 
        className={cn(
          'relative flex flex-col min-w-[300px] min-h-[200px] bg-background/50 p-4',
          'border-2 border-dashed border-gray-400',
          'transition-all duration-200',
          selected && 'ring-2 ring-primary ring-offset-2',
          'drag-target'
        )}
        style={{
          width: data.width || 800,
          height: data.height || 400,
          pointerEvents: 'all',
          borderColor: data?.state === 'valid' ? 'rgb(34, 197, 94)' : undefined,
          backgroundColor: data?.state === 'valid' ? 'rgba(34, 197, 94, 0.05)' : undefined,
          position: 'relative',
          overflow: 'visible',
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
                  'bg-background border-border text-foreground font-medium pr-1.5 pl-2.5 py-0.5 text-sm',
                  'hover:bg-accent/50 transition-colors duration-150 cursor-pointer',
                  'flex items-center gap-1'
                )}
              >
                {getInputLabel()}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Badge>
            </PopoverTrigger>
            <PopoverContent 
              className={cn('p-3', data.loopType !== 'for' ? 'w-72' : 'w-48')} 
              align="start"
            >
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {data.loopType === 'for' ? 'Loop Iterations' : 'Collection Items'}
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
          "relative min-h-[100px]"
        )}>
          {/* Child nodes are rendered here by React Flow */}
        </div>

        <Handle
          type="target"
          position={Position.Top}
          className="!bg-gray-400 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-gray-400 !w-3 !h-3"
        />
      </Card>
    </div>
  )
})

LoopNodeComponent.displayName = 'LoopNodeComponent' 