import type { WorkflowDSL, WorkflowEdge, WorkflowNode } from './workflow-types'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseNodes = (raw: unknown): WorkflowNode[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((item) => isObject(item) && typeof item.id === 'string' && isObject(item.data) && isObject(item.position)) as WorkflowNode[]
}

const parseEdges = (raw: unknown): WorkflowEdge[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((item) => isObject(item) && typeof item.id === 'string' && typeof item.source === 'string' && typeof item.target === 'string') as WorkflowEdge[]
}

export const parseWorkflowDSL = (input: string | WorkflowDSL): WorkflowDSL => {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (!isObject(value)) throw new Error('DSL 根节点必须为对象')

  const nodes = parseNodes(value.nodes)
  const edges = parseEdges(value.edges)

  if (!nodes.length) throw new Error('DSL 中 nodes 不能为空')

  return {
    nodes,
    edges,
    globalVariables: Array.isArray(value.globalVariables) ? value.globalVariables.filter(isObject) as Array<Record<string, unknown>> : undefined,
    workflowParameters: Array.isArray(value.workflowParameters) ? value.workflowParameters.filter(isObject) as Array<Record<string, unknown>> : undefined,
    workflowVariableScopes: isObject(value.workflowVariableScopes) ? (value.workflowVariableScopes as Record<string, unknown>) : undefined,
    viewport: isObject(value.viewport) ? (value.viewport as WorkflowDSL['viewport']) : { x: 0, y: 0, zoom: 1 }
  }
}

export const toWorkflowDSL = (dsl: WorkflowDSL) => JSON.stringify(dsl, null, 2)
