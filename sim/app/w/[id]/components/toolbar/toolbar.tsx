'use client'

import { useMemo, useState } from 'react'
import { PanelLeftClose, PanelRight, PanelRightClose, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebarStore } from '@/stores/sidebar/store'
import { getAllBlocks, getBlocksByCategory } from '@/blocks'
import { BlockCategory } from '@/blocks/types'
import { ToolbarBlock } from './components/toolbar-block/toolbar-block'
import { ToolbarTabs } from './components/toolbar-tabs/toolbar-tabs'
import { LoopTool } from './components/loop-node/loop-config'
import { Separator } from '@/components/ui/separator'

// Custom component for the Loop Tool
const LoopToolbarItem = () => {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify(LoopTool))
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors hover:bg-accent/50 cursor-pointer active:cursor-grabbing"
    >
      <div
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
        style={{ backgroundColor: LoopTool.bgColor }}
      >
        <LoopTool.icon className="text-white transition-transform duration-200 group-hover:scale-110 w-[22px] h-[22px]" />
      </div>
      <div className="flex flex-col gap-1 mb-[-2px]">
        <h3 className="font-medium leading-none">{LoopTool.name}</h3>
        <p className="text-sm text-muted-foreground leading-snug">{LoopTool.description}</p>
      </div>
    </div>
  )
}

export function Toolbar() {
  const [activeTab, setActiveTab] = useState<BlockCategory>('blocks')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { isCollapsed: isSidebarCollapsed } = useSidebarStore()

  const blocks = useMemo(() => {
    const filteredBlocks = !searchQuery.trim() ? getBlocksByCategory(activeTab) : getAllBlocks()

    return filteredBlocks.filter((block) => {
      if (block.type === 'starter' || block.hideFromToolbar) return false

      return (
        !searchQuery.trim() ||
        block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [searchQuery, activeTab])

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsCollapsed(false)}
            className={`fixed transition-left duration-200 ${isSidebarCollapsed ? 'left-20' : 'left-64'} bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground hover:text-foreground hover:bg-accent border`}
          >
            <PanelRight className="h-5 w-5" />
            <span className="sr-only">Open Toolbar</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Open Toolbar</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      className={`fixed transition-left duration-200 ${isSidebarCollapsed ? 'left-14' : 'left-60'} top-16 z-10 h-[calc(100vh-4rem)] w-60 border-r bg-background sm:block`}
    >
      <div className="flex flex-col h-full">
        <div className="px-4 pt-4 pb-1 sticky top-0 bg-background z-20">
          <div className="relative">
            <Search className="absolute left-3 top-[50%] h-4 w-4 -translate-y-[50%] text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="pl-9 rounded-md"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>
        </div>

        {!searchQuery && (
          <div className="sticky top-[72px] bg-background z-20">
            <ToolbarTabs activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
        )}

        <ScrollArea className="h-[calc(100%-4rem)]">
          <div className="p-4 pb-20">
            <div className="flex flex-col gap-3">
              {blocks.map((block) => (
                <ToolbarBlock key={block.type} config={block} />
              ))}
            </div>

            {/* Loop Tool Section */}
            <Separator className="my-4" />
            <div className="flex flex-col gap-3">
              <LoopToolbarItem />
            </div>
          </div>
        </ScrollArea>

        <div className="absolute left-0 right-0 bottom-0 h-16 bg-background border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsCollapsed(true)}
                className="absolute right-4 bottom-[18px] flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <PanelLeftClose className="h-5 w-5" />
                <span className="sr-only">Close Toolbar</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Close Toolbar</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
