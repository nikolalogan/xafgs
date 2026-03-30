import { useDifyWorkflowStore } from '../core/store'

export const useWorkflowHistoryStore = () => {
  const canUndo = useDifyWorkflowStore(state => state.canUndo)
  const canRedo = useDifyWorkflowStore(state => state.canRedo)
  const record = useDifyWorkflowStore(state => state.record)
  const undo = useDifyWorkflowStore(state => state.undo)
  const redo = useDifyWorkflowStore(state => state.redo)
  const resetHistory = useDifyWorkflowStore(state => state.resetHistory)

  return {
    canUndo,
    canRedo,
    record,
    undo,
    redo,
    resetHistory,
  }
}

export const useWorkflowMenuStore = () => {
  const nodeMenu = useDifyWorkflowStore(state => state.nodeMenu)
  const edgeMenu = useDifyWorkflowStore(state => state.edgeMenu)
  const panelMenu = useDifyWorkflowStore(state => state.panelMenu)
  const selectionMenu = useDifyWorkflowStore(state => state.selectionMenu)
  const setNodeMenu = useDifyWorkflowStore(state => state.setNodeMenu)
  const setEdgeMenu = useDifyWorkflowStore(state => state.setEdgeMenu)
  const setPanelMenu = useDifyWorkflowStore(state => state.setPanelMenu)
  const setSelectionMenu = useDifyWorkflowStore(state => state.setSelectionMenu)
  const clearMenus = useDifyWorkflowStore(state => state.clearMenus)

  return {
    nodeMenu,
    edgeMenu,
    panelMenu,
    selectionMenu,
    setNodeMenu,
    setEdgeMenu,
    setPanelMenu,
    setSelectionMenu,
    clearMenus,
  }
}

export const useWorkflowClipboardStore = () => {
  const clipboard = useDifyWorkflowStore(state => state.clipboard)
  const setClipboard = useDifyWorkflowStore(state => state.setClipboard)

  return {
    clipboard,
    setClipboard,
  }
}
