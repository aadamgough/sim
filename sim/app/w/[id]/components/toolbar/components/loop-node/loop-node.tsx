import { memo, useCallback } from 'react'
import { Handle, NodeProps, Position, NodeResizer, useReactFlow } from 'reactflow'
import { RepeatIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('LoopNode')

export const LoopNodeComponent = memo(({ data, selected, id }: NodeProps) => {
  const { deleteElements } = useReactFlow()
  const removeBlock = useWorkflowStore((state) => state.removeBlock)

  const onDelete = useCallback(() => {
    logger.info('Deleting loop node:', { id })
    removeBlock(id)
    deleteElements({ nodes: [{ id }] })
  }, [deleteElements, id, removeBlock])

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
        onResize={(evt, { width, height }) => {
          logger.info('Loop node resized:', { id, width, height })
        }}
      />
      <Card 
        className={cn(
          'relative flex flex-col min-w-[300px] min-h-[200px] bg-background/50 p-4',
          'border-2 border-dashed border-gray-400',
          'transition-colors duration-200',
          selected && 'ring-2 ring-primary ring-offset-2',
          'drag-target',
          data?.state === 'valid' && 'border-green-500',
        )}
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
          <div className="flex items-center justify-center w-7 h-7 rounded bg-[#4A5568]">
            <RepeatIcon className="w-5 h-5 text-white" />
          </div>
          <span className="font-medium text-md">{data.label || 'Loop'}</span>
        </div>

        <div className="flex-1 border border-dashed border-gray-300 rounded-md p-2">
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