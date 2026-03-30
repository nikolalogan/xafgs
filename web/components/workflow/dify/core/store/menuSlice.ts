import type { StateCreator } from 'zustand'
import type { DifyWorkflowStore } from './types'

type MenuSlice = Pick<
  DifyWorkflowStore,
  | 'nodeMenu'
  | 'edgeMenu'
  | 'panelMenu'
  | 'selectionMenu'
  | 'setNodeMenu'
  | 'setEdgeMenu'
  | 'setPanelMenu'
  | 'setSelectionMenu'
  | 'clearMenus'
>

export const createMenuSlice: StateCreator<DifyWorkflowStore, [], [], MenuSlice> = set => ({
  nodeMenu: undefined,
  edgeMenu: undefined,
  panelMenu: undefined,
  selectionMenu: undefined,
  setNodeMenu: menu => set({ nodeMenu: menu }),
  setEdgeMenu: menu => set({ edgeMenu: menu }),
  setPanelMenu: menu => set({ panelMenu: menu }),
  setSelectionMenu: menu => set({ selectionMenu: menu }),
  clearMenus: () => set({
    nodeMenu: undefined,
    edgeMenu: undefined,
    panelMenu: undefined,
    selectionMenu: undefined,
  }),
})
