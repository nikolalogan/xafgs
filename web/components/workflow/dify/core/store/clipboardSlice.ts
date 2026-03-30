import type { StateCreator } from 'zustand'
import type { DifyWorkflowStore } from './types'

type ClipboardSlice = Pick<DifyWorkflowStore, 'clipboard' | 'setClipboard'>

export const createClipboardSlice: StateCreator<DifyWorkflowStore, [], [], ClipboardSlice> = set => ({
  clipboard: {
    nodes: [],
    edges: [],
  },
  setClipboard: clipboard => set({ clipboard }),
})
