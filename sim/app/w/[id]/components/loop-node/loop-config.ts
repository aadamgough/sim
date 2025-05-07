import { RepeatIcon } from 'lucide-react'

export const LoopTool = {
  id: 'loop',
  type: 'loop',
  name: 'Loop',
  description: 'Create a Loop',
  icon: RepeatIcon,
  bgColor: '#40E0D0',
  data: {
    label: 'Loop',
    loopType: 'for',
    condition: '',
    count: 5,
    collection: '',
    width: 800,
    height: 600,
  },
  style: {
    width: 800,
    height: 600,
  },
  dragHandle: '.workflow-drag-handle',
  // Ensure React Flow knows to render this as a group
  reactFlowType: 'group'
} 