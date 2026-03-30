type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (raw: string): { ok: true; value: JsonValue } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(raw) as JsonValue }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'JSON 解析失败' }
  }
}

const getTypeOfValue = (value: JsonValue): 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' => {
  if (value === null)
    return 'null'
  if (Array.isArray(value))
    return 'array'
  switch (typeof value) {
    case 'boolean': return 'boolean'
    case 'number': return 'number'
    case 'string': return 'string'
    default: return 'object'
  }
}

const validateWithSchema = (value: JsonValue, schema: Record<string, unknown>, path: string): string | null => {
  const type = schema.type
  if (typeof type === 'string') {
    const actualType = getTypeOfValue(value)
    if (type !== actualType) {
      return `${path} 类型不匹配，期望 ${type}，实际 ${actualType}`
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) {
    return `${path} 不在 enum 允许范围内`
  }

  if (Array.isArray(value)) {
    if (isObject(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateWithSchema(value[index], schema.items, `${path}[${index}]`)
        if (error)
          return error
      }
    }
    return null
  }

  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter(item => typeof item === 'string') as string[] : []
    for (const requiredKey of required) {
      if (!(requiredKey in value))
        return `${path}.${requiredKey} 为必填`
    }
    if (isObject(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (!(key in value))
          continue
        if (!isObject(childSchema))
          continue
        const childError = validateWithSchema(value[key] as JsonValue, childSchema, `${path}.${key}`)
        if (childError)
          return childError
      }
    }
  }

  return null
}

export const validateParameterJsonDefault = (
  valueType: 'array' | 'object',
  rawDefaultValue: string,
  rawSchema?: string,
): { valid: true } | { valid: false; error: string } => {
  if (!rawDefaultValue.trim())
    return { valid: true }

  const parsedDefault = parseJson(rawDefaultValue)
  if (!parsedDefault.ok)
    return { valid: false, error: `默认值 JSON 非法：${parsedDefault.error}` }

  const actualType = getTypeOfValue(parsedDefault.value)
  if (actualType !== valueType)
    return { valid: false, error: `默认值类型错误，期望 ${valueType}，实际 ${actualType}` }

  if (!rawSchema?.trim())
    return { valid: true }

  const parsedSchema = parseJson(rawSchema)
  if (!parsedSchema.ok)
    return { valid: false, error: `JSON Schema 非法：${parsedSchema.error}` }

  if (!isObject(parsedSchema.value))
    return { valid: false, error: 'JSON Schema 顶层必须为对象' }

  const schemaType = parsedSchema.value.type
  if (typeof schemaType === 'string' && schemaType !== valueType)
    return { valid: false, error: `JSON Schema.type 必须为 ${valueType}` }

  const schemaError = validateWithSchema(parsedDefault.value, parsedSchema.value, '$')
  if (schemaError)
    return { valid: false, error: `默认值未通过 Schema 校验：${schemaError}` }

  return { valid: true }
}

export const inferWorkflowParamFromSchema = (
  rawSchema: string,
): { ok: true; patch: { valueType?: 'array' | 'object'; label?: string; description?: string } } | { ok: false; error: string } => {
  const parsed = parseJson(rawSchema)
  if (!parsed.ok)
    return { ok: false, error: parsed.error }
  if (!isObject(parsed.value))
    return { ok: false, error: 'JSON Schema 顶层必须为对象' }

  const type = parsed.value.type
  if (type !== 'array' && type !== 'object')
    return { ok: false, error: '仅支持 type=object 或 type=array 的 Schema' }

  return {
    ok: true,
    patch: {
      valueType: type,
      label: typeof parsed.value.title === 'string' ? parsed.value.title : undefined,
      description: typeof parsed.value.description === 'string' ? parsed.value.description : undefined,
    },
  }
}

export const extractSchemaLeafPaths = (rawSchema: string): { ok: true; paths: string[] } | { ok: false; error: string } => {
  const parsed = parseJson(rawSchema)
  if (!parsed.ok)
    return { ok: false, error: parsed.error }
  if (!isObject(parsed.value))
    return { ok: false, error: 'JSON Schema 顶层必须为对象' }

  const collect = (schema: Record<string, unknown>, prefix: string): string[] => {
    const type = schema.type
    if (type === 'object' && isObject(schema.properties)) {
      const entries = Object.entries(schema.properties)
      if (entries.length === 0)
        return [prefix || '$']
      return entries.flatMap(([key, child]) => {
        if (!isObject(child))
          return [`${prefix ? `${prefix}.` : ''}${key}`]
        return collect(child, `${prefix ? `${prefix}.` : ''}${key}`)
      })
    }
    if (type === 'array') {
      if (isObject(schema.items))
        return collect(schema.items, `${prefix}[]`)
      return [prefix ? `${prefix}[]` : '$[]']
    }
    return [prefix || '$']
  }

  const paths = [...new Set(collect(parsed.value, ''))]
  return { ok: true, paths }
}
