import { compileRule, runCompiledRule, type CompiledRule } from './rule-engine'

export type DynamicField = {
  name: string
  label: string
  type: 'text' | 'paragraph' | 'number' | 'select' | 'checkbox' | 'text-input' | 'file' | 'file-list' | 'json_object'
  required: boolean
  options: Array<{ label: string; value: string }>
  defaultValue?: unknown
  placeholder?: string
  min?: number
  max?: number
  step?: number
  multiSelect?: boolean
  visibleWhen?: string
  validateWhen?: string
}

export type DynamicFieldState = {
  item: DynamicField
  visible: boolean
  visibleError: string | null
  validateError: string | null
}

export type PreparedRule = {
  compiled: CompiledRule
  localDeps: string[]
  externalDeps: string[]
}

export type PreparedDynamicField = DynamicField & {
  visibleRule?: PreparedRule
  validateRule?: PreparedRule
}

export const splitRuleDeps = (compiled: CompiledRule, nodeId: string) => {
  const localPrefix = `${nodeId}.`
  const localDeps: string[] = []
  const externalDeps: string[] = []
  compiled.placeholders.forEach((key) => {
    if (key.startsWith(localPrefix))
      localDeps.push(key.slice(localPrefix.length))
    else
      externalDeps.push(key)
  })
  return { localDeps, externalDeps }
}

export const buildPreparedRule = (code: string | undefined, nodeId: string) => {
  const normalized = String(code || '').trim()
  if (!normalized)
    return undefined
  const compiled = compileRule(normalized)
  const { localDeps, externalDeps } = splitRuleDeps(compiled, nodeId)
  return { compiled, localDeps, externalDeps } satisfies PreparedRule
}

export const buildPreparedFields = (
  fields: DynamicField[],
  nodeId: string,
): PreparedDynamicField[] => {
  return fields.map(field => ({
    ...field,
    visibleRule: buildPreparedRule(field.visibleWhen, nodeId),
    validateRule: buildPreparedRule(field.validateWhen, nodeId),
  }))
}

export const getRuleValueByPath = (source: Record<string, unknown>, path: string): unknown => {
  const keys = path.split('.').map(item => item.trim()).filter(Boolean)
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

export const buildExternalRuleInputs = (
  fields: PreparedDynamicField[],
  runtimeVariables: Record<string, unknown>,
) => {
  const externalKeys = new Set<string>()
  fields.forEach((field) => {
    field.visibleRule?.externalDeps.forEach(dep => externalKeys.add(dep))
    field.validateRule?.externalDeps.forEach(dep => externalKeys.add(dep))
  })
  const result: Record<string, unknown> = {}
  externalKeys.forEach((key) => {
    result[key] = getRuleValueByPath(runtimeVariables, key)
  })
  return result
}

export const buildLocalRuleInputs = (
  nodeId: string,
  currentValues: Record<string, unknown>,
) => {
  const result: Record<string, unknown> = {}
  Object.entries(currentValues).forEach(([key, value]) => {
    result[`${nodeId}.${key}`] = value
  })
  return result
}

export const evaluatePreparedRule = (
  rule: PreparedRule | undefined,
  vars: Record<string, unknown>,
) => {
  if (!rule)
    return { ok: true as const, result: true }
  return runCompiledRule(rule.compiled, vars)
}

export const evaluateDynamicFieldStates = (
  fields: PreparedDynamicField[],
  ruleInputs: Record<string, unknown>,
) => {
  return fields.map((item): DynamicFieldState => {
    let visible = true
    let visibleError: string | null = null
    if (item.visibleRule) {
      const visibleResult = evaluatePreparedRule(item.visibleRule, ruleInputs)
      if (visibleResult.ok)
        visible = Boolean(visibleResult.result)
      else
        visibleError = visibleResult.error ?? '可见规则执行失败'
    }

    return {
      item,
      visible,
      visibleError,
      validateError: null,
    }
  })
}

export const evaluateDynamicFieldValidations = (
  fields: PreparedDynamicField[],
  ruleInputs: Record<string, unknown>,
) => {
  const validationMap = new Map<string, string | null>()
  fields.forEach((item) => {
    let validateError: string | null = null
    if (item.validateRule) {
      const validateResult = evaluatePreparedRule(item.validateRule, ruleInputs)
      if (validateResult.ok) {
        if (!validateResult.result)
          validateError = '结果校验未通过'
      }
      else {
        validateError = validateResult.error ?? '结果校验执行失败'
      }
    }
    validationMap.set(item.name, validateError)
  })
  return validationMap
}

export const validateDynamicInput = (
  fields: DynamicField[],
  values: Record<string, unknown>,
  fieldStates?: DynamicFieldState[],
  validateErrors?: Record<string, string | null> | Map<string, string | null>,
) => {
  const activeStates = fieldStates ?? fields.map(item => ({ item, visible: true, visibleError: null, validateError: null }))
  const normalized: Record<string, unknown> = {}
  for (const state of activeStates) {
    const field = state.item
    if (!state.visible)
      continue
    if (state.visibleError)
      return { ok: false as const, normalized, message: `${field.label || field.name}: ${state.visibleError}` }
    const validateError = validateErrors instanceof Map
      ? (validateErrors.get(field.name) ?? null)
      : (validateErrors?.[field.name] ?? state.validateError)
    if (validateError)
      return { ok: false as const, normalized, message: `${field.label || field.name}: ${validateError}` }

    const raw = values[field.name]
    const candidate = raw !== undefined ? raw : field.defaultValue

    const hasValue = (() => {
      if (field.type === 'checkbox')
        return candidate !== undefined && candidate !== null
      return String(candidate ?? '').trim() !== ''
    })()

    if (field.required && !hasValue)
      return { ok: false as const, normalized, message: `输入字段 ${field.name} 为必填` }

    if (!hasValue) {
      normalized[field.name] = candidate
      continue
    }

    if (field.type === 'number') {
      const parsed = typeof candidate === 'number' ? candidate : Number(candidate)
      if (Number.isNaN(parsed))
        return { ok: false as const, normalized, message: `输入字段 ${field.name} 需要 number` }
      normalized[field.name] = parsed
      continue
    }

    if (field.type === 'select' && field.options.length > 0) {
      const allowed = new Set(field.options.map(option => option.value))
      const valueStr = String(candidate ?? '')
      if (!allowed.has(valueStr))
        return { ok: false as const, normalized, message: `输入字段 ${field.name} 不在可选项中` }
    }

    normalized[field.name] = candidate
  }
  return { ok: true as const, normalized, message: '' }
}
