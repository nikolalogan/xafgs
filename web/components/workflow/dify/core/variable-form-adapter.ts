import type { InputNodeConfig, StartNodeConfig } from './types'

export const adaptInputConfigToStartConfig = (inputConfig: InputNodeConfig): StartNodeConfig => {
  return {
    variables: inputConfig.fields.map(field => ({
      name: field.name,
      label: field.label,
      type: field.type === 'text' ? 'text-input' : field.type,
      required: field.required,
      options: field.type === 'select'
        ? field.options.map(option => ({ label: option, value: option }))
        : undefined,
      defaultValue: field.defaultValue || undefined,
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
      ? (item.options ?? []).map(option => option.value).filter(Boolean)
      : []
    const defaultValue = item.defaultValue === undefined || item.defaultValue === null
      ? ''
      : String(item.defaultValue)

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
