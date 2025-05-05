import { memo } from 'react'
import { Handle, NodeProps, Position } from 'reactflow'
import { RepeatIcon } from 'lucide-react'

export const LoopNode = memo(({ data }: NodeProps) => {
  const { label = 'Loop', loopType, condition, count, collection } = data

  return (
    <div 
      className="relative flex flex-col min-w-[300px] min-h-[200px] rounded-lg border-2 border-dashed border-gray-400 bg-background/50 p-4"
      style={{ width: 400, height: 300 }} // Fixed dimensions for the parent container
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 workflow-drag-handle cursor-move">
        <RepeatIcon className="w-5 h-5" />
        <span className="font-medium">{label}</span>
      </div>

      {/* Loop Configuration */}
      <div className="text-sm text-muted-foreground mb-4">
        {loopType === 'while' && <div>While: {condition}</div>}
        {loopType === 'count' && <div>Repeat: {count} times</div>}
        {loopType === 'foreach' && <div>For each in: {collection}</div>}
      </div>

      {/* Container for child nodes - nodes with this node's ID as parentId will appear here */}
      <div className="flex-1 border border-dashed border-gray-300 rounded-md p-2">
        {/* Child nodes are automatically rendered here by React Flow */}
      </div>

      {/* Input/Output Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-gray-400"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-gray-400"
      />
    </div>
  )
})

LoopNode.displayName = 'LoopNode' 