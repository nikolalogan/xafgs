import { useCallback } from 'react'
import type { DifyEdge, DifyNode } from '../core/types'

type UseHistoryActionsParams = {
  undo: () => { nodes: DifyNode[]; edges: DifyEdge[] } | null
  redo: () => { nodes: DifyNode[]; edges: DifyEdge[] } | null
  setNodes: (nodes: DifyNode[]) => void
  setEdges: (edges: DifyEdge[]) => void
}

export const useHistoryActions = ({
  undo,
  redo,
  setNodes,
  setEdges,
}: UseHistoryActionsParams) => {
  const doUndo = useCallback(() => {
    const snapshot = undo()
    if (!snapshot) return
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
  }, [setEdges, setNodes, undo])

  const doRedo = useCallback(() => {
    const snapshot = redo()
    if (!snapshot) return
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
  }, [redo, setEdges, setNodes])

  return {
    doUndo,
    doRedo,
  }
}
