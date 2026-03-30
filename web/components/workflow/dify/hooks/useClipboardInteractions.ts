import { useCallback } from 'react'
import type { DifyEdge, DifyNode } from '../core/types'

type ClipboardState = {
  nodes: DifyNode[]
  edges: DifyEdge[]
}

type UseClipboardInteractionsParams = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  clipboard: ClipboardState
  setNodes: (nodes: DifyNode[]) => void
  setEdges: (edges: DifyEdge[]) => void
  setClipboard: (clipboard: ClipboardState) => void
  record: (snapshot: { nodes: DifyNode[]; edges: DifyEdge[] }) => void
}

export const useClipboardInteractions = ({
  nodes,
  edges,
  clipboard,
  setNodes,
  setEdges,
  setClipboard,
  record,
}: UseClipboardInteractionsParams) => {
  const copySelection = useCallback((selectionNodeIds?: string[]) => {
    const selectedNodes = selectionNodeIds?.length
      ? nodes.filter(node => selectionNodeIds.includes(node.id))
      : nodes.filter(node => node.selected)
    if (!selectedNodes.length) return

    const selectedNodeIdsSet = new Set(selectedNodes.map(node => node.id))
    const selectedEdges = edges.filter(edge =>
      selectedNodeIdsSet.has(edge.source) && selectedNodeIdsSet.has(edge.target),
    )

    setClipboard({
      nodes: selectedNodes.map(node => ({ ...node, selected: false })),
      edges: selectedEdges.map(edge => ({ ...edge, selected: false })),
    })
  }, [edges, nodes, setClipboard])

  const pasteClipboard = useCallback((at?: { left: number; top: number }) => {
    if (!clipboard.nodes.length) return

    const minX = Math.min(...clipboard.nodes.map(node => node.position.x))
    const minY = Math.min(...clipboard.nodes.map(node => node.position.y))
    const offsetX = (at?.left ?? minX + 40) - minX
    const offsetY = (at?.top ?? minY + 40) - minY

    const idMap = new Map<string, string>()
    const now = Date.now()

    const newNodes = clipboard.nodes.map((node, index) => {
      const nextId = `${node.id}-copy-${now}-${index}`
      idMap.set(node.id, nextId)
      return {
        ...node,
        id: nextId,
        selected: true,
        position: {
          x: node.position.x + offsetX,
          y: node.position.y + offsetY,
        },
      }
    })

    const newEdges = clipboard.edges
      .filter(edge => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge, index) => ({
        ...edge,
        id: `edge-copy-${now}-${index}`,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
        selected: false,
      }))

    const nextNodes = [...nodes.map(node => ({ ...node, selected: false })), ...newNodes]
    const nextEdges = [...edges.map(edge => ({ ...edge, selected: false })), ...newEdges]

    setNodes(nextNodes)
    setEdges(nextEdges)
    record({ nodes: nextNodes, edges: nextEdges })
  }, [clipboard.edges, clipboard.nodes, edges, nodes, record, setEdges, setNodes])

  const deleteSelection = useCallback((selectionNodeIds?: string[], selectionEdgeIds?: string[]) => {
    const selectedNodes = selectionNodeIds?.length
      ? new Set(selectionNodeIds)
      : new Set(nodes.filter(node => node.selected).map(node => node.id))
    const selectedEdges = selectionEdgeIds?.length
      ? new Set(selectionEdgeIds)
      : new Set(edges.filter(edge => edge.selected).map(edge => edge.id))

    const nextNodes = nodes.filter(node => !selectedNodes.has(node.id))
    const nextEdges = edges.filter(edge =>
      !selectedEdges.has(edge.id) && !selectedNodes.has(edge.source) && !selectedNodes.has(edge.target),
    )

    setNodes(nextNodes)
    setEdges(nextEdges)
    record({ nodes: nextNodes, edges: nextEdges })
  }, [edges, nodes, record, setEdges, setNodes])

  const duplicateSelection = useCallback((selectionNodeIds?: string[]) => {
    const selectedNodes = selectionNodeIds?.length
      ? nodes.filter(node => selectionNodeIds.includes(node.id))
      : nodes.filter(node => node.selected)
    if (!selectedNodes.length) return

    const selectedNodeIdsSet = new Set(selectedNodes.map(node => node.id))
    const selectedEdges = edges.filter(edge =>
      selectedNodeIdsSet.has(edge.source) && selectedNodeIdsSet.has(edge.target),
    )

    const now = Date.now()
    const idMap = new Map<string, string>()

    const newNodes = selectedNodes.map((node, index) => {
      const nextId = `${node.id}-copy-${now}-${index}`
      idMap.set(node.id, nextId)
      return {
        ...node,
        id: nextId,
        selected: true,
        position: {
          x: node.position.x + 40,
          y: node.position.y + 40,
        },
      }
    })

    const newEdges = selectedEdges.map((edge, index) => ({
      ...edge,
      id: `edge-copy-${now}-${index}`,
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      selected: false,
    }))

    const nextNodes = [...nodes.map(node => ({ ...node, selected: false })), ...newNodes]
    const nextEdges = [...edges.map(edge => ({ ...edge, selected: false })), ...newEdges]

    setNodes(nextNodes)
    setEdges(nextEdges)
    setClipboard({
      nodes: selectedNodes.map(node => ({ ...node, selected: false })),
      edges: selectedEdges.map(edge => ({ ...edge, selected: false })),
    })
    record({ nodes: nextNodes, edges: nextEdges })
  }, [edges, nodes, record, setClipboard, setEdges, setNodes])

  return {
    copySelection,
    pasteClipboard,
    deleteSelection,
    duplicateSelection,
  }
}
