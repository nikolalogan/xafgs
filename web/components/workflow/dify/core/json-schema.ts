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

export const validateParameterJsonDefault = (
  valueType: 'array' | 'object',
  rawDefaultValue: string,
  rawJson?: string,
): { valid: true } | { valid: false; error: string } => {
  if (!rawDefaultValue.trim())
    return { valid: true }

  const parsedDefault = parseJson(rawDefaultValue)
  if (!parsedDefault.ok)
    return { valid: false, error: `默认值 JSON 非法：${parsedDefault.error}` }

  const actualType = getTypeOfValue(parsedDefault.value)
  if (actualType !== valueType)
    return { valid: false, error: `默认值类型错误，期望 ${valueType}，实际 ${actualType}` }

  if (!rawJson?.trim())
    return { valid: true }

  const parsedStructure = parseJson(rawJson)
  if (!parsedStructure.ok)
    return { valid: false, error: `结构 JSON 非法：${parsedStructure.error}` }

  return { valid: true }
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

export const extractJsonLeafPaths = (rawJson: string): { ok: true; paths: string[] } | { ok: false; error: string } => {
  const parsed = parseJson(rawJson)
  if (!parsed.ok)
    return { ok: false, error: parsed.error }

  const collect = (value: JsonValue, prefix: string): string[] => {
    if (value === null)
      return [prefix || '$']
    if (Array.isArray(value)) {
      if (value.length === 0)
        return [prefix ? `${prefix}[]` : '$[]']
      const children = value.flatMap(child => collect(child, `${prefix}[]`))
      return [prefix ? `${prefix}[]` : '$[]', ...children]
    }

    if (typeof value !== 'object')
      return [prefix || '$']

    const obj = value as Record<string, JsonValue>
    const keys = Object.keys(obj)
    if (!keys.length)
      return [prefix || '$']
    return [
      ...(prefix ? [prefix] : []),
      ...keys.flatMap((key) => collect(obj[key], prefix ? `${prefix}.${key}` : key)),
    ]
  }

	const rawPaths = collect(parsed.value, '')
	const paths = [...new Set(
		rawPaths
			.map((path) => {
				if (path === '$')
					return ''
				return path.replace(/^\$\./, '').replace(/^\$/, '')
			})
			.filter(Boolean),
	)]

  return { ok: true, paths }
}
