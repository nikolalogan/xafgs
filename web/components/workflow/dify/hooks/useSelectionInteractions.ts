import { useMemo } from 'react'
import type { DifyEdge, DifyNode } from '../core/types'
import { useSelectionLayout } from './useSelectionLayout'

type UseSelectionInteractionsParams = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  setNodes: (nodes: DifyNode[]) => void
  record: (snapshot: { nodes: DifyNode[]; edges: DifyEdge[] }) => void
}

export const useSelectionInteractions = ({
  nodes,
  edges,
  setNodes,
  record,
}: UseSelectionInteractionsParams) => {
  const selectedNodesCount = useMemo(() => nodes.filter(node => node.selected).length, [nodes])
  const alignSelection = useSelectionLayout({ nodes, edges, setNodes, record })

  return {
    selectedNodesCount,
    alignSelection,
  }
}
