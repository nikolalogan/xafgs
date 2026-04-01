import type { WorkflowGlobalVariable } from './types'

export const defaultGlobalVariables: WorkflowGlobalVariable[] = [
  {
    name: 'user_id',
    valueType: 'string',
    defaultValue: '',
    json: '',
    description: '当前请求用户 ID',
  },
  {
    name: 'app_id',
    valueType: 'string',
    defaultValue: '',
    json: '',
    description: '当前应用 ID',
  },
  {
    name: 'workflow_id',
    valueType: 'string',
    defaultValue: '',
    json: '',
    description: '当前工作流 ID',
  },
  {
    name: 'workflow_run_id',
    valueType: 'string',
    defaultValue: '',
    json: '',
    description: '当前工作流运行 ID',
  },
  {
    name: 'timestamp',
    valueType: 'number',
    defaultValue: '',
    json: '',
    description: '触发时间戳（秒）',
  },
]

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const normalizeGlobalVariables = (input?: unknown): WorkflowGlobalVariable[] => {
  if (!Array.isArray(input))
    return defaultGlobalVariables

  const list = input
    .filter(isObject)
    .map((item) => {
      const valueType = item.valueType
      return {
        name: typeof item.name === 'string' ? item.name : '',
        valueType: valueType === 'number' || valueType === 'boolean' || valueType === 'array' || valueType === 'object' ? valueType : 'string',
        defaultValue: typeof item.defaultValue === 'string' ? item.defaultValue : '',
        json: typeof item.json === 'string'
          ? item.json
          : typeof (item as { jsonSchema?: unknown }).jsonSchema === 'string'
            ? String((item as { jsonSchema?: unknown }).jsonSchema)
            : '',
        description: typeof item.description === 'string' ? item.description : '',
      } satisfies WorkflowGlobalVariable
    })
    .filter(item => !!item.name.trim())

  if (!list.length)
    return defaultGlobalVariables

  return list
}
