import { useCallback } from 'react'
import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from 'reactflow'
import { CUSTOM_EDGE } from '../core/constants'
import type { DifyEdge, DifyNode } from '../core/types'

type UseGraphInteractionsParams = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  setNodes: (value: DifyNode[] | ((current: DifyNode[]) => DifyNode[])) => void
  setEdges: (value: DifyEdge[] | ((current: DifyEdge[]) => DifyEdge[])) => void
  record: (snapshot: { nodes: DifyNode[]; edges: DifyEdge[] }) => void
}

export const useGraphInteractions = ({
  nodes,
  edges,
  setNodes,
  setEdges,
  record,
}: UseGraphInteractionsParams) => {
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const nextNodes = applyNodeChanges(changes, nodes) as DifyNode[]
    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
  }, [edges, nodes, record, setNodes])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const nextEdges = applyEdgeChanges(changes, edges) as DifyEdge[]
    setEdges(nextEdges)
    record({ nodes, edges: nextEdges })
  }, [edges, nodes, record, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target)
      return
    const nextEdge: DifyEdge = {
      ...(connection as DifyEdge),
      id: `e-${Date.now()}`,
      type: CUSTOM_EDGE,
    }
    const nextEdges = [...edges, nextEdge]
    setEdges(nextEdges)
    record({ nodes, edges: nextEdges })
  }, [edges, nodes, record, setEdges])

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
  }
}
