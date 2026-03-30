import type { StateCreator } from 'zustand'
import type { DifyWorkflowStore } from './types'

type HistorySlice = Pick<
  DifyWorkflowStore,
  'history' | 'historyIndex' | 'canUndo' | 'canRedo' | 'record' | 'undo' | 'redo' | 'resetHistory'
>

export const createHistorySlice: StateCreator<DifyWorkflowStore, [], [], HistorySlice> = (set, get) => ({
  history: [],
  historyIndex: -1,
  canUndo: false,
  canRedo: false,
  record: (snapshot) => {
    const state = get()
    const nextHistory = state.history.slice(0, state.historyIndex + 1)
    nextHistory.push(snapshot)
    const nextIndex = nextHistory.length - 1
    set({
      history: nextHistory,
      historyIndex: nextIndex,
      canUndo: nextIndex > 0,
      canRedo: false,
    })
  },
  undo: () => {
    const state = get()
    if (state.historyIndex <= 0) return null
    const nextIndex = state.historyIndex - 1
    const snapshot = state.history[nextIndex]
    set({
      historyIndex: nextIndex,
      canUndo: nextIndex > 0,
      canRedo: true,
    })
    return snapshot
  },
  redo: () => {
    const state = get()
    if (state.historyIndex >= state.history.length - 1) return null
    const nextIndex = state.historyIndex + 1
    const snapshot = state.history[nextIndex]
    set({
      historyIndex: nextIndex,
      canUndo: nextIndex > 0,
      canRedo: nextIndex < state.history.length - 1,
    })
    return snapshot
  },
  resetHistory: (snapshot) => {
    set({
      history: [snapshot],
      historyIndex: 0,
      canUndo: false,
      canRedo: false,
    })
  },
})
