import { extractSchemaLeafPaths } from './json-schema'
import type { WorkflowObjectType } from './types'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const normalizeWorkflowObjectTypes = (input?: unknown): WorkflowObjectType[] => {
  if (!Array.isArray(input))
    return []

  return input
    .filter(isObject)
    .map((item) => {
      return {
        id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : '',
        description: typeof item.description === 'string' ? item.description : '',
        schemaJson: typeof item.schemaJson === 'string' ? item.schemaJson : '',
        sampleJson: typeof item.sampleJson === 'string' ? item.sampleJson : '',
      } satisfies WorkflowObjectType
    })
    .filter(item => item.id.trim())
}

export const validateWorkflowObjectType = (item: WorkflowObjectType): { valid: true } | { valid: false; error: string } => {
  if (!item.id.trim())
    return { valid: false, error: '对象类型 ID 不能为空' }
  if (!item.name.trim())
    return { valid: false, error: '对象类型名称不能为空' }
  const schema = extractSchemaLeafPaths(item.schemaJson)
  if (!schema.ok)
    return { valid: false, error: `schemaJson 非法：${schema.error}` }
  if ((item.sampleJson ?? '').trim()) {
    try {
      const parsed = JSON.parse(item.sampleJson ?? '') as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { valid: false, error: 'sampleJson 必须是 JSON 对象' }
    }
    catch (error) {
      return { valid: false, error: `sampleJson 非法：${error instanceof Error ? error.message : 'JSON 解析失败'}` }
    }
  }
  return { valid: true }
}

export const buildObjectTypeMap = (objectTypes: WorkflowObjectType[]): Map<string, WorkflowObjectType> => {
  return new Map(objectTypes.map(item => [item.id, item]))
}
