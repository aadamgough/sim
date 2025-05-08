import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ChevronDown, IterationCw, ListOrdered, Copy, Trash2 } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('LoopActionBar')

interface LoopActionBarProps {
  nodeId: string
  data: any
}

export function LoopActionBar({ nodeId, data }: LoopActionBarProps) {
  // State
  const [loopType, setLoopType] = useState(data?.loopType || 'for')
  const [iterations, setIterations] = useState(data?.count || 5)
  const [isEditingIterations, setIsEditingIterations] = useState(false)
  
  // Get store methods
  const { updateNodeDimensions, removeBlock } = useWorkflowStore()
  
  // Update state from props when they change
  useEffect(() => {
    if (data?.loopType && data.loopType !== loopType) {
      setLoopType(data.loopType)
    }
    if (data?.count && data.count !== iterations) {
      setIterations(data.count)
    }
  }, [data?.loopType, data?.count, loopType, iterations])
  
  // Update loop configuration in the workflow store
  const updateLoopConfig = useCallback((type?: string, count?: number) => {
    const updatedType = type || loopType
    const updatedCount = count || iterations
    
    // Update the node in the workflow store
    useWorkflowStore.setState(state => ({
      blocks: {
        ...state.blocks,
        [nodeId]: {
          ...state.blocks[nodeId],
          data: {
            ...state.blocks[nodeId].data,
            loopType: updatedType,
            count: updatedCount
          }
        }
      }
    }))
    
    logger.info('Updated loop configuration:', { 
      type: updatedType, 
      count: updatedCount,
      nodeId
    })
  }, [nodeId, loopType, iterations])
  
  // Handle loop type change
  const handleLoopTypeChange = useCallback(() => {
    const newType = loopType === 'for' ? 'forEach' : 'for'
    setLoopType(newType)
    updateLoopConfig(newType)
  }, [loopType, updateLoopConfig])
  
  // Handle iterations input change
  const handleIterationsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value)
    if (!isNaN(value) && value > 0 && value <= 100) {
      setIterations(value)
    }
  }, [])
  
  // Handle iterations input blur (save changes)
  const handleIterationsBlur = useCallback(() => {
    setIsEditingIterations(false)
    updateLoopConfig(undefined, iterations)
  }, [iterations, updateLoopConfig])
  
  // Handle delete
  const handleDelete = useCallback(() => {
    removeBlock(nodeId)
  }, [nodeId, removeBlock])
  
  // Handle duplicate (not implemented yet)
  const handleDuplicate = useCallback(() => {
    // Placeholder for future implementation
    logger.info('Duplicate not implemented for loop nodes yet')
  }, [])

  return (
    <div
      className={cn(
        'absolute -right-[142px] top-0',
        'flex flex-col items-start gap-3 p-3',
        'bg-background rounded-md shadow-sm border border-gray-200 dark:border-gray-800',
        'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
        'z-[100]'
      )}
    >
      {/* Connecting line to the loop node */}
      <div 
        className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-[7px]" 
        style={{
          width: '8px', 
          height: '2px', 
          backgroundColor: 'var(--border)',
          zIndex: 10
        }}
      />

      {/* Loop Type Toggle */}
      <div className="flex flex-col items-start w-full">
        <span className="text-xs text-muted-foreground mb-1">Loop Type</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="outline" 
              size="sm"
              className="text-xs h-7 w-full justify-between font-normal"
              onClick={handleLoopTypeChange}
            >
              <div className="flex items-center">
                {loopType === 'for' ? (
                  <IterationCw className="h-3.5 w-3.5 mr-1.5 text-[#40E0D0]" />
                ) : (
                  <ListOrdered className="h-3.5 w-3.5 mr-1.5 text-[#40E0D0]" />
                )}
                {loopType === 'for' ? 'For Loop' : 'For Each'}
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {loopType === 'for' 
              ? 'Switch to For Each (iterate over items)' 
              : 'Switch to For Loop (fixed iterations)'}
          </TooltipContent>
        </Tooltip>
      </div>
      
      {/* Iterations Control - only for 'for' loop type */}
      {loopType === 'for' && (
        <div className="flex flex-col items-start w-full">
          <span className="text-xs text-muted-foreground mb-1">Iterations</span>
          {isEditingIterations ? (
            <input
              type="number"
              value={iterations}
              min="1"
              max="100"
              className="w-full h-7 px-2 text-xs rounded border-input bg-transparent"
              onChange={handleIterationsChange}
              onBlur={handleIterationsBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleIterationsBlur()}
              autoFocus
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 w-full justify-between font-normal"
              onClick={() => setIsEditingIterations(true)}
            >
              <div className="flex items-center">
                <IterationCw className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <span>{iterations} iterations</span>
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
        </div>
      )}
      
      {/* For Each Info - only for 'forEach' loop type */}
      {loopType === 'forEach' && (
        <div className="flex flex-col items-start w-full">
          <span className="text-xs text-muted-foreground mb-1">Items Source</span>
          <div className="text-xs text-muted-foreground p-1.5 border border-dashed border-border rounded w-full">
            Items defined by input
          </div>
        </div>
      )}
      
      {/* Divider */}
      <div className="w-full h-px bg-border my-1" />
      
      {/* Actions */}
      <div className="flex justify-between w-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDuplicate}
              className="text-gray-500"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Duplicate Loop</TooltipContent>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="text-gray-500 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Delete Loop</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
} 