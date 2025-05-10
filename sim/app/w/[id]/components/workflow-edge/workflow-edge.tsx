import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from 'reactflow'

export const WorkflowEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  source,
  target,
}: EdgeProps) => {
  const isHorizontal = sourcePosition === 'right' || sourcePosition === 'left'

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: isHorizontal ? 30 : 20,
  })

  const isSelected = id === data?.selectedEdgeId
  const isWithinLoop = data?.isWithinLoop
  const isLoopStartEdge = data?.isLoopStartEdge
  
  // Determine if this edge is connected to a loop node
  const isLoopNodeEdge = target && target.includes('loop') || source && source.includes('loop')

  // Use a different color for loop start edges
  const edgeColor = isLoopStartEdge ? '#40E0D0' : isSelected ? '#475569' : '#94a3b8'
  const edgeWidth = isLoopStartEdge ? 2.5 : 2
  
  // Handle deletion click with preserve parent-child relationships 
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (data?.onDelete) {
      data.onDelete(id);
    }
  };
  
  return (
    <>
      <BaseEdge
        path={edgePath}
        data-testid="workflow-edge"
        data-edge-id={id}
        data-is-within-loop={isWithinLoop ? 'true' : 'false'}
        data-is-loop-start={isLoopStartEdge ? 'true' : 'false'}
        data-loop-connected={isLoopNodeEdge ? 'true' : 'false'}
        style={{
          strokeWidth: edgeWidth,
          stroke: edgeColor,
          strokeDasharray: '5,5',
          // Prevent z-index changes for loop node edges that would cause positioning issues
          zIndex: isLoopNodeEdge ? 0 : (isWithinLoop ? 100 : -10),
        }}
        interactionWidth={20}
      />
      <animate
        attributeName="stroke-dashoffset"
        from="10"
        to="0"
        dur="1s"
        repeatCount="indefinite"
      />

      {isSelected && (
        <EdgeLabelRenderer>
          <div
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-[#FAFBFC] nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1000,
            }}
            onClick={handleDeleteClick}
          >
            <X className="h-5 w-5 text-red-500 hover:text-red-600" />
          </div>
        </EdgeLabelRenderer> 
      )}
    </>
  )
}
