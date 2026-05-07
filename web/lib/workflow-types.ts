import type { Edge, Node, Viewport } from 'reactflow'

export type WorkflowNodeData = {
  title: string
  desc?: string
  type: 'start' | 'end' | 'llm' | 'if-else' | 'http-request' | 'api-request' | 'code' | 'input'
  config?: Record<string, unknown>
}

export type WorkflowNode = Node<WorkflowNodeData>
export type WorkflowEdge = Edge

export type WorkflowDSL = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  objectTypes?: Array<Record<string, unknown>>
  globalVariables?: Array<Record<string, unknown>>
  workflowParameters?: Array<Record<string, unknown>>
  workflowVariableScopes?: Record<string, unknown>
  viewport?: Viewport
}
