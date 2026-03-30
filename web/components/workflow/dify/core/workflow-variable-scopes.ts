import type { WorkflowVariableScope } from './types'

const allowedScopes: WorkflowVariableScope[] = [
  'all',
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'file',
]

const scopeSet = new Set<WorkflowVariableScope>(allowedScopes)

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const normalizeWorkflowVariableScopes = (input?: unknown): Record<string, WorkflowVariableScope> => {
  if (!isObject(input))
    return {}

  const result: Record<string, WorkflowVariableScope> = {}
  Object.entries(input).forEach(([key, value]) => {
    if (!key)
      return
    if (typeof value !== 'string')
      return
    if (!scopeSet.has(value as WorkflowVariableScope))
      return
    result[key] = value as WorkflowVariableScope
  })
  return result
}
