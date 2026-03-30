import type { WorkflowDSL, WorkflowNode } from '../workflow-types'

type GraphSnapshot = {
  nodeMap: Map<string, WorkflowNode>
  outgoing: Map<string, string[]>
  incomingCount: Map<string, number>
}

const cloneIncomingCount = (source: Map<string, number>) => {
  const next = new Map<string, number>()
  source.forEach((value, key) => next.set(key, value))
  return next
}

const buildGraphSnapshot = (dsl: WorkflowDSL): GraphSnapshot => {
  const nodeMap = new Map<string, WorkflowNode>()
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()

  dsl.nodes.forEach((node) => {
    nodeMap.set(node.id, node)
    outgoing.set(node.id, [])
    incomingCount.set(node.id, 0)
  })

  dsl.edges.forEach((edge) => {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target))
      return
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
  })

  return { nodeMap, outgoing, incomingCount }
}

export const buildExecutionPlan = (dsl: WorkflowDSL): string[] => {
  const graph = buildGraphSnapshot(dsl)
  const incoming = cloneIncomingCount(graph.incomingCount)
  const queue = [...dsl.nodes.filter(node => (incoming.get(node.id) ?? 0) === 0).map(node => node.id)]
  const ordered: string[] = []

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current)
      continue
    ordered.push(current)
    const nextNodes = graph.outgoing.get(current) ?? []
    nextNodes.forEach((nextNodeId) => {
      const nextCount = (incoming.get(nextNodeId) ?? 0) - 1
      incoming.set(nextNodeId, nextCount)
      if (nextCount === 0)
        queue.push(nextNodeId)
    })
  }

  if (ordered.length !== dsl.nodes.length) {
    const missing = dsl.nodes.map(node => node.id).filter(nodeId => !ordered.includes(nodeId))
    return [...ordered, ...missing]
  }
  return ordered
}
