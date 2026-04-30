import { normalizeGlobalVariables } from './global-variables'
import { normalizeWorkflowObjectTypes } from './object-types'
import { normalizeWorkflowParameters } from './workflow-parameters'
import { normalizeWorkflowVariableScopes } from './workflow-variable-scopes'
import type { DifyEdge, DifyNode, DifyWorkflowDSL } from './types'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseNodes = (raw: unknown): DifyNode[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((item) => isObject(item) && typeof item.id === 'string' && isObject(item.data) && isObject(item.position)) as DifyNode[]
}

const parseEdges = (raw: unknown): DifyEdge[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((item) => isObject(item) && typeof item.id === 'string' && typeof item.source === 'string' && typeof item.target === 'string') as DifyEdge[]
}

export const parseDifyWorkflowDSL = (input: string | DifyWorkflowDSL): DifyWorkflowDSL => {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (!isObject(value)) throw new Error('DSL 根节点必须为对象')

  const nodes = parseNodes(value.nodes)
  const edges = parseEdges(value.edges)

  if (!nodes.length) throw new Error('DSL 中 nodes 不能为空')

  return {
    nodes,
    edges,
    objectTypes: normalizeWorkflowObjectTypes(value.objectTypes),
    globalVariables: normalizeGlobalVariables(value.globalVariables),
    workflowParameters: normalizeWorkflowParameters(value.workflowParameters),
    workflowVariableScopes: normalizeWorkflowVariableScopes(value.workflowVariableScopes),
    viewport: isObject(value.viewport) ? (value.viewport as DifyWorkflowDSL['viewport']) : { x: 0, y: 0, zoom: 1 },
  }
}

export const toDifyWorkflowDSL = (dsl: DifyWorkflowDSL) => JSON.stringify(dsl, null, 2)
