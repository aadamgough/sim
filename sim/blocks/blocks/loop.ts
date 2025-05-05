import '@xyflow/react/dist/style.css';
import { RepeatIcon } from 'lucide-react'
import { BlockConfig, BlockIcon } from '../types'
import { createElement } from 'react'

const rfStyle = {
  backgroundColor: '#D0C0F7',
};

// Create a proper BlockIcon component
const LoopIcon: BlockIcon = (props) => createElement(RepeatIcon, props)

export const LoopConfig: BlockConfig = {
  type: 'loop',
  name: 'Loop',
  description: 'Create a loop container',
  longDescription: 'A visual container that allows you to create loops by placing blocks inside it. Any blocks placed inside this shell will be executed repeatedly based on the loop configuration.',
  category: 'blocks',
  bgColor: '#4A5568',
  icon: LoopIcon,
  subBlocks: [
    {
      id: 'loopType',
      title: 'Loop Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'While Condition', id: 'while' },
        { label: 'Fixed Count', id: 'count' },
        { label: 'For Each Item', id: 'foreach' }
      ]
    },
    {
      id: 'condition',
      title: 'Condition',
      type: 'condition-input',
      layout: 'full',
      placeholder: 'Enter loop condition'
    },
    {
      id: 'count',
      title: 'Number of Iterations',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 5'
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter array or collection to iterate over'
    }
  ],
  tools: {
    access: [],
  },
  inputs: {
    loopType: { type: 'string', required: true },
    condition: { type: 'string', required: false },
    count: { type: 'number', required: false },
    collection: { type: 'json', required: false }
  },
  outputs: {
    response: {
      type: {
        iterations: 'number',
        result: 'json'
      }
    }
  },
  hideFromToolbar: false
}
