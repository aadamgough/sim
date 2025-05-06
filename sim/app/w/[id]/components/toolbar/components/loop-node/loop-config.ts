import { RepeatIcon } from 'lucide-react'

export const LoopTool = {
  id: 'loop',
  type: 'loop',
  name: 'Loop',
  description: 'Create a Loop',
  icon: RepeatIcon,
  bgColor: '#4A5568',
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
  storeData: {
    iterations: 5,
    loopType: 'for',
    nodes: [],
  }
} 