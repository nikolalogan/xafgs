import { useCallback, type MutableRefObject } from 'react'
import { CUSTOM_NODE } from '../core/constants'
import { createDefaultNodeConfig } from '../core/node-config'
import { BlockEnum, type DifyEdge, type DifyNode, type LLMNodeConfig } from '../core/types'

type UseNodeActionsParams = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  activeNode: DifyNode | null
  idRef: MutableRefObject<number>
  nodeTypeLabel: Record<BlockEnum, string>
  defaultLLMModel: string
  setNodes: (nodes: DifyNode[]) => void
  record: (snapshot: { nodes: DifyNode[]; edges: DifyEdge[] }) => void
}

export const useNodeActions = ({
  nodes,
  edges,
  activeNode,
  idRef,
  nodeTypeLabel,
  defaultLLMModel,
  setNodes,
  record,
}: UseNodeActionsParams) => {
  const addNode = useCallback((type: BlockEnum, preferredPosition?: { x: number; y: number }) => {
    // Keep a single Start/End node to match Dify-style workflows.
    if (type === BlockEnum.Start || type === BlockEnum.End) {
      const existing = nodes.find(node => node.data.type === type)
      if (existing)
        return existing
    }

    const id = `node-${idRef.current++}`
    const nextConfig = createDefaultNodeConfig(type)
    if (type === BlockEnum.LLM) {
      const llmConfig = nextConfig as LLMNodeConfig
      llmConfig.model = defaultLLMModel
    }

    const nextNode: DifyNode = {
      id,
      type: CUSTOM_NODE,
      position: preferredPosition ?? { x: 220 + (nodes.length % 5) * 180, y: 90 + (nodes.length % 4) * 120 },
      data: {
        title: type === BlockEnum.Start || type === BlockEnum.End
          ? nodeTypeLabel[type]
          : `${nodeTypeLabel[type]}-${idRef.current}`,
        desc: '',
        type,
        config: nextConfig,
      },
    }

    const nextNodes = [...nodes, nextNode]
    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
    return nextNode
  }, [defaultLLMModel, edges, idRef, nodeTypeLabel, nodes, record, setNodes])

  const saveNode = useCallback(() => {
    if (!activeNode) return
    const nextNodes = nodes.map(item => (item.id === activeNode.id ? activeNode : item))
    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
  }, [activeNode, edges, nodes, record, setNodes])

  return {
    addNode,
    saveNode,
  }
}
