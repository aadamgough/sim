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
    loopType: 'while',
    condition: '',
    count: 1,
    collection: '',
  },
  style: {
    width: 800,
    height: 400,
  },
  dragHandle: '.workflow-drag-handle',
  // Additional properties for workflow store
} 