import type { WorkflowParameter } from './types'

export const defaultWorkflowParameters: WorkflowParameter[] = [
  {
    name: 'query',
    label: '用户输入',
    valueType: 'string',
    required: true,
    defaultValue: '',
    jsonSchema: '',
    description: '流程主输入参数',
  },
]

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const normalizeWorkflowParameters = (input?: unknown): WorkflowParameter[] => {
  if (!Array.isArray(input))
    return defaultWorkflowParameters

  const list = input
    .filter(isObject)
    .map((item) => {
      const valueType = item.valueType
      return {
        name: typeof item.name === 'string' ? item.name : '',
        label: typeof item.label === 'string' ? item.label : '',
        valueType: valueType === 'number' || valueType === 'boolean' || valueType === 'array' || valueType === 'object' ? valueType : 'string',
        required: !!item.required,
        defaultValue: typeof item.defaultValue === 'string' ? item.defaultValue : '',
        jsonSchema: typeof item.jsonSchema === 'string' ? item.jsonSchema : '',
        description: typeof item.description === 'string' ? item.description : '',
      } satisfies WorkflowParameter
    })
    .filter(item => !!item.name.trim())

  if (!list.length)
    return defaultWorkflowParameters

  return list
}
