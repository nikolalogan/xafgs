import type { WorkflowParameter } from './types'

export const defaultWorkflowParameters: WorkflowParameter[] = [
  {
    name: 'query',
    label: '用户输入',
    valueType: 'string',
    required: false,
    defaultValue: '',
    json: '',
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
        required: false,
        defaultValue: typeof item.defaultValue === 'string' ? item.defaultValue : '',
        json: typeof item.json === 'string'
          ? item.json
          : typeof (item as { jsonSchema?: unknown }).jsonSchema === 'string'
            ? String((item as { jsonSchema?: unknown }).jsonSchema)
            : '',
        objectTypeId: typeof item.objectTypeId === 'string' ? item.objectTypeId : '',
        description: typeof item.description === 'string' ? item.description : '',
      } satisfies WorkflowParameter
    })
    .filter(item => !!item.name.trim())

  if (!list.length)
    return defaultWorkflowParameters

  return list
}
