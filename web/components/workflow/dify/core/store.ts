import { create } from 'zustand'
import { createClipboardSlice } from './store/clipboardSlice'
import { createHistorySlice } from './store/historySlice'
import { createMenuSlice } from './store/menuSlice'
import type { DifyWorkflowStore } from './store/types'

export type {
  ClipboardState,
  DifyWorkflowStore as DifyWorkflowStoreState,
  EdgeMenuState,
  NodeMenuState,
  PanelMenuState,
  SelectionMenuState,
  Snapshot,
} from './store/types'

export const useDifyWorkflowStore = create<DifyWorkflowStore>((set, get, store) => ({
  ...createHistorySlice(set, get, store),
  ...createMenuSlice(set, get, store),
  ...createClipboardSlice(set, get, store),
}))
