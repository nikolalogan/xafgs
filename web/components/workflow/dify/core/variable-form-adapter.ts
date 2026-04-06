import type { InputNodeConfig, StartNodeConfig } from './types'

const normalizeSelectOptions = (raw: unknown): Array<{ label: string; value: string }> => {
  if (!Array.isArray(raw))
    return []
  return raw.map((option) => {
    if (option && typeof option === 'object') {
      const value = typeof (option as { value?: unknown }).value === 'string'
        ? (option as { value: string }).value
        : String((option as { value?: unknown }).value ?? '')
      const label = typeof (option as { label?: unknown }).label === 'string'
        ? (option as { label: string }).label
        : value
      return { label, value }
    }
    const value = String(option ?? '')
    return { label: value, value }
  })
}

const normalizeDefaultValue = (
  type: InputNodeConfig['fields'][number]['type'],
  value: unknown,
): string | number | boolean | undefined => {
  if (value === null || value === undefined)
    return undefined
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  if (type === 'checkbox') {
    if (typeof value === 'boolean')
      return value
    const s = String(value).trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y')
      return true
    if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === '')
      return false
    return Boolean(value)
  }
  return String(value)
}

export const adaptInputConfigToStartConfig = (inputConfig: InputNodeConfig): StartNodeConfig => {
  return {
    variables: inputConfig.fields.map(field => ({
      name: field.name,
      label: field.label,
      type: field.type === 'text' ? 'text-input' : field.type,
      required: field.required,
      options: field.type === 'select'
        ? normalizeSelectOptions((field as { options?: unknown } | undefined)?.options).map(option => ({ label: option.label, value: option.value }))
        : undefined,
      defaultValue: normalizeDefaultValue(field.type, field.defaultValue),
      visibleWhen: field.visibleWhen,
      validateWhen: field.validateWhen,
    })),
  }
}

export const adaptStartConfigToInputConfig = (
  inputConfig: InputNodeConfig,
  startConfig: StartNodeConfig,
): InputNodeConfig => {
  const fields: InputNodeConfig['fields'] = startConfig.variables.map((item) => {
    const type = item.type === 'text-input' ? 'text' : (item.type as InputNodeConfig['fields'][number]['type'])
    const options = type === 'select'
      ? (item.options ?? []).map(option => ({ label: option.label, value: option.value }))
      : undefined
    const defaultValue = item.defaultValue === undefined ? undefined : item.defaultValue

      return {
        name: item.name,
        label: item.label,
        type,
        required: item.required,
        options,
        defaultValue,
        visibleWhen: item.visibleWhen,
        validateWhen: item.validateWhen,
      }
    })

  return {
    ...inputConfig,
    fields,
  }
}
