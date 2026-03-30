import { useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import type { DifyEdge, DifyNode } from '../core/types'

type UseContextMenuInteractionsParams = {
  canvasContainerRef: RefObject<HTMLDivElement | null>
  selectedNodesCount: number
  clearMenus: () => void
  setNodeMenu: (menu?: { nodeId: string; left: number; top: number }) => void
  setEdgeMenu: (menu?: { edgeId: string; left: number; top: number }) => void
  setPanelMenu: (menu?: { left: number; top: number }) => void
  setSelectionMenu: (menu?: { left: number; top: number }) => void
}

export const useContextMenuInteractions = ({
  canvasContainerRef,
  selectedNodesCount,
  clearMenus,
  setNodeMenu,
  setEdgeMenu,
  setPanelMenu,
  setSelectionMenu,
}: UseContextMenuInteractionsParams) => {
  const getMenuPosition = useCallback((clientX: number, clientY: number) => {
    const rect = canvasContainerRef.current?.getBoundingClientRect()
    if (!rect)
      return { left: clientX, top: clientY }

    return {
      left: clientX - rect.left,
      top: clientY - rect.top,
    }
  }, [canvasContainerRef])

  const handleNodeContextMenu = useCallback((event: ReactMouseEvent, node: DifyNode) => {
    event.preventDefault()
    const position = getMenuPosition(event.clientX, event.clientY)
    clearMenus()
    setNodeMenu({ nodeId: node.id, ...position })
  }, [clearMenus, getMenuPosition, setNodeMenu])

  const handleEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: DifyEdge) => {
    event.preventDefault()
    const position = getMenuPosition(event.clientX, event.clientY)
    clearMenus()
    setEdgeMenu({ edgeId: edge.id, ...position })
  }, [clearMenus, getMenuPosition, setEdgeMenu])

  const handlePaneContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    const position = getMenuPosition(event.clientX, event.clientY)
    clearMenus()

    if (selectedNodesCount > 1)
      setSelectionMenu(position)
    else
      setPanelMenu(position)
  }, [clearMenus, getMenuPosition, selectedNodesCount, setPanelMenu, setSelectionMenu])

  return {
    handleNodeContextMenu,
    handleEdgeContextMenu,
    handlePaneContextMenu,
  }
}
