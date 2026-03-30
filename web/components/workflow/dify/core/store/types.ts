import type { DifyEdge, DifyNode } from '../types'

export type Snapshot = {
  nodes: DifyNode[]
  edges: DifyEdge[]
}

export type NodeMenuState = {
  nodeId: string
  left: number
  top: number
}

export type EdgeMenuState = {
  edgeId: string
  left: number
  top: number
}

export type PanelMenuState = {
  left: number
  top: number
}

export type SelectionMenuState = {
  left: number
  top: number
}

export type ClipboardState = {
  nodes: DifyNode[]
  edges: DifyEdge[]
}

export type DifyWorkflowStore = {
  history: Snapshot[]
  historyIndex: number
  canUndo: boolean
  canRedo: boolean
  nodeMenu?: NodeMenuState
  edgeMenu?: EdgeMenuState
  panelMenu?: PanelMenuState
  selectionMenu?: SelectionMenuState
  clipboard: ClipboardState
  record: (snapshot: Snapshot) => void
  undo: () => Snapshot | null
  redo: () => Snapshot | null
  resetHistory: (snapshot: Snapshot) => void
  setNodeMenu: (menu?: NodeMenuState) => void
  setEdgeMenu: (menu?: EdgeMenuState) => void
  setPanelMenu: (menu?: PanelMenuState) => void
  setSelectionMenu: (menu?: SelectionMenuState) => void
  setClipboard: (clipboard: ClipboardState) => void
  clearMenus: () => void
}
