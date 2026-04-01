import type { Edge as ReactFlowEdge, Node as ReactFlowNode, Viewport } from 'reactflow'

export enum BlockEnum {
  Start = 'start',
  End = 'end',
  LLM = 'llm',
  IfElse = 'if-else',
  Iteration = 'iteration',
  Code = 'code',
  HttpRequest = 'http-request',
  ApiRequest = 'api-request',
  Input = 'input',
}

export enum NodeRunningStatus {
  Idle = 'idle',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Exception = 'exception',
}

export type StartNodeConfig = {
  variables: Array<{
    name: string
    label: string
    type: 'text-input' | 'paragraph' | 'select' | 'number' | 'checkbox' | 'file' | 'file-list' | 'json_object'
    required: boolean
    placeholder?: string
    defaultValue?: string | number | boolean
    maxLength?: number
    min?: number
    max?: number
    step?: number
    fileTypes?: string[]
    maxFiles?: number
    jsonSchema?: string
    multiSelect?: boolean
    visibleWhen?: string
    validateWhen?: string
    options?: Array<{
      label: string
      value: string
    }>
  }>
}

export type EndNodeConfig = {
  outputs: Array<{
    name: string
    source: string
  }>
  templateId?: number
}

export type LLMNodeConfig = {
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  userPrompt: string
  contextEnabled: boolean
}

export type IfElseNodeConfig = {
  conditions: Array<{
    name: string
    left: string
    operator: 'contains' | 'not_contains' | 'eq' | 'neq' | 'gt' | 'lt' | 'empty' | 'not_empty'
    right: string
  }>
  elseBranchName: string
}

export type CodeNodeConfig = {
  language: 'javascript' | 'python3'
  code: string
  outputSchema?: string
  writebackMappings: Array<{
    sourcePath: string
    targetPath: string
  }>
  outputs: string[]
}

export type IterationNodeConfig = {
  iteratorSource: string
  outputSource: string
  outputVar: string
  itemVar: string
  indexVar: string
  isParallel: boolean
  parallelNums: number
  errorHandleMode: 'terminated' | 'continue-on-error' | 'remove-abnormal-output'
  flattenOutput: boolean
  children: {
    nodes: Array<{
      id: string
      type: string
      position: { x: number; y: number }
      data: {
        title: string
        desc?: string
        type: BlockEnum
        config?: DifyNodeConfig
      }
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      type?: string
      sourceHandle?: string
      targetHandle?: string
    }>
    viewport?: Viewport
  }
}

export type HttpNodeConfig = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  query: Array<{ key: string; value: string }>
  headers: Array<{ key: string; value: string }>
  bodyType: 'none' | 'json' | 'raw' | 'x-www-form-urlencoded' | 'form-data'
  body: string
  timeout: number
  authorization: {
    type: 'none' | 'bearer' | 'api-key'
    apiKey: string
    header: string
  }
  outputSchema?: string
  writebackMappings: Array<{
    sourcePath: string
    targetPath: string
  }>
}

export type ApiRequestParamLocation = 'path' | 'query' | 'body'

export type ApiRequestParamDef = {
  name: string
  in: ApiRequestParamLocation
  type: string
  description?: string
  validation?: {
    required?: boolean
    enum?: string[]
    min?: number
    max?: number
    pattern?: string
  }
}

export type ApiRequestParamValue = {
  name: string
  in: ApiRequestParamLocation
  value: string
}

export type ApiRequestNodeConfig = {
  route: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
  }
  params: ApiRequestParamDef[]
  paramValues: ApiRequestParamValue[]
  timeout: number
  successStatusCode: number
  writebackMappings: Array<{
    sourcePath: string
    targetPath: string
  }>
}

export type InputNodeConfig = {
  fields: Array<{
    name: string
    label: string
    type: 'text' | 'paragraph' | 'number' | 'select'
    required: boolean
    options: string[]
    defaultValue: string
    visibleWhen?: string
    validateWhen?: string
  }>
}

export type DifyNodeConfigMap = {
  [BlockEnum.Start]: StartNodeConfig
  [BlockEnum.End]: EndNodeConfig
  [BlockEnum.LLM]: LLMNodeConfig
  [BlockEnum.IfElse]: IfElseNodeConfig
  [BlockEnum.Iteration]: IterationNodeConfig
  [BlockEnum.Code]: CodeNodeConfig
  [BlockEnum.HttpRequest]: HttpNodeConfig
  [BlockEnum.ApiRequest]: ApiRequestNodeConfig
  [BlockEnum.Input]: InputNodeConfig
}

export type DifyNodeConfig = DifyNodeConfigMap[BlockEnum]

export type WorkflowGlobalVariable = {
  name: string
  valueType: 'string' | 'number' | 'boolean' | 'array' | 'object'
  defaultValue?: string
  json?: string
  description: string
}

export type WorkflowParameter = {
  name: string
  label: string
  valueType: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required: boolean
  defaultValue: string
  json?: string
  description: string
}

export type WorkflowVariableScope = 'all' | 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file'

export type DifyNodeData = {
  title: string
  desc?: string
  type: BlockEnum
  config?: DifyNodeConfig
  _iterationRole?: 'container' | 'child'
  _iterationParentId?: string
  _iterationChildId?: string
  _runningStatus?: NodeRunningStatus
  _connectedSourceHandleIds?: string[]
  _connectedTargetHandleIds?: string[]
}

export type DifyEdgeData = {
  _iterationParentId?: string
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus
  _forceStroke?: string
  _connectedNodeIsHovering?: boolean
  _waitingRun?: boolean
}

export type DifyNode = ReactFlowNode<DifyNodeData>
export type DifyEdge = ReactFlowEdge<DifyEdgeData>

export type DifyWorkflowDSL = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  globalVariables?: WorkflowGlobalVariable[]
  workflowParameters?: WorkflowParameter[]
  workflowVariableScopes?: Record<string, WorkflowVariableScope>
  viewport?: Viewport
}
