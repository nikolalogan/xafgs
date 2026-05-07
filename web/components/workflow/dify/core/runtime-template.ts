const PLACEHOLDER_ONLY_REGEXP = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/
const PLACEHOLDER_REGEXP = /\{\{\s*([^{}]+?)\s*\}\}/g

const normalizePath = (path: string) => path
  .trim()
  .replace(/^用户属性\./, 'user.')
  .replace(/^流程参数\./, 'workflow.')
  .replace(/^全局参数\./, 'global.')
  .replace(/^\$\./, '')
  .replace(/^\$/, '')
  .replace(/\[(\d+)\]/g, '.$1')

const getByPath = (source: Record<string, unknown>, rawPath: string): unknown => {
  const keys = normalizePath(rawPath).split('.').map(item => item.trim()).filter(Boolean)
  if (!keys.length)
    return undefined
  let current: unknown = source
  for (const key of keys) {
    if (current === null || current === undefined)
      return undefined
    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index))
        return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object')
      return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export const resolveRuntimeTemplateValue = (raw: unknown, variables: Record<string, unknown>): unknown => {
  if (typeof raw !== 'string')
    return raw
  const text = raw
  const trimmed = text.trim()
  if (!trimmed.includes('{{'))
    return raw

  const pureMatch = PLACEHOLDER_ONLY_REGEXP.exec(trimmed)
  if (pureMatch?.[1]) {
    const value = getByPath(variables, pureMatch[1])
    return value ?? ''
  }

  return text.replace(PLACEHOLDER_REGEXP, (_full, key) => {
    const resolved = getByPath(variables, String(key || '').trim())
    if (resolved === null || resolved === undefined)
      return ''
    if (typeof resolved === 'object')
      return JSON.stringify(resolved)
    return String(resolved)
  })
}

export const buildInitialFormValues = (
  fields: Array<{ name: string, type: string, defaultValue?: unknown }>,
  variables: Record<string, unknown>,
): Record<string, unknown> => {
  const nextInput: Record<string, unknown> = {}
  fields.forEach((field) => {
    const resolved = resolveRuntimeTemplateValue(field.defaultValue, variables)
    nextInput[field.name] = resolved ?? (field.type === 'checkbox' ? false : '')
  })
  return nextInput
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

type ResolveTemplatePreviewContextInput = {
  endNodeId?: string
  preferredEndOutput?: unknown
  outputs?: unknown
  variables?: unknown
}

export const resolveTemplatePreviewContext = (input: ResolveTemplatePreviewContextInput): Record<string, unknown> => {
  const outputs = isObject(input.outputs) ? input.outputs : {}
  const variables = isObject(input.variables) ? input.variables : {}
  const endNodeID = String(input.endNodeId || '').trim()

  const endNodeOutput = endNodeID ? outputs[endNodeID] : undefined
  const variablesEndNodeOutput = endNodeID ? variables[endNodeID] : undefined
  const outputsEnd = outputs.end

  if (isObject(endNodeOutput))
    return endNodeOutput
  if (isObject(variablesEndNodeOutput))
    return variablesEndNodeOutput
  if (isObject(outputsEnd))
    return outputsEnd
  if (isObject(input.outputs))
    return outputs
  if (isObject(input.preferredEndOutput))
    return input.preferredEndOutput
  return { output: input.outputs }
}
