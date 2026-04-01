import {
  BlockEnum,
  type CodeNodeConfig,
  type ApiRequestNodeConfig,
  type DifyNodeConfig,
  type DifyNodeConfigMap,
  type EndNodeConfig,
  type HttpNodeConfig,
  type IfElseNodeConfig,
  type InputNodeConfig,
  type IterationNodeConfig,
  type LLMNodeConfig,
  type StartNodeConfig,
} from './types'

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const normalizeStartVariableType = (value: unknown): StartNodeConfig['variables'][number]['type'] => {
  if (value === 'text' || value === 'text-input')
    return 'text-input'
  if (value === 'paragraph')
    return 'paragraph'
  if (value === 'select')
    return 'select'
  if (value === 'number')
    return 'number'
  if (value === 'boolean' || value === 'checkbox')
    return 'checkbox'
  if (value === 'file')
    return 'file'
  if (value === 'file-list')
    return 'file-list'
  if (value === 'json_object')
    return 'json_object'
  return 'text-input'
}

const normalizeStartVariableOptions = (options: unknown): StartNodeConfig['variables'][number]['options'] => {
  if (!Array.isArray(options))
    return undefined

  const normalized = options
    .map((item) => {
      if (typeof item === 'string') {
        const value = item.trim()
        return { label: value, value }
      }
      if (!isObject(item))
        return { label: '', value: '' }
      const label = typeof item.label === 'string' ? item.label : ''
      const value = typeof item.value === 'string' ? item.value : ''
      return {
        label,
        value,
      }
    })

  return normalized
}

const normalizeStartVariableDefault = (
  type: StartNodeConfig['variables'][number]['type'],
  value: unknown,
  multiSelect?: boolean,
): string | number | boolean | undefined => {
  if (value === undefined || value === null || value === '')
    return undefined

  if (type === 'select' && multiSelect) {
    if (Array.isArray(value))
      return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).join(',')
    if (typeof value === 'string')
      return value
  }

  if (type === 'checkbox')
    return Boolean(value)
  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  return undefined
}

const normalizeStartVariableFileTypes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value))
    return undefined
  const types = value.map(item => String(item || '').trim()).filter(Boolean)
  return types.length ? types : undefined
}

const defaultStartConfig = (): StartNodeConfig => ({
  variables: [
    { name: 'query', label: '用户输入', type: 'text-input', required: true },
  ],
})

const defaultEndConfig = (): EndNodeConfig => ({
  outputs: [
    { name: 'result', source: 'llm.text' },
  ],
  templateId: undefined,
})

const defaultLLMConfig = (): LLMNodeConfig => ({
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: '你是一个有帮助的助手。',
  userPrompt: '{{query}}',
  contextEnabled: false,
})

const defaultIfElseConfig = (): IfElseNodeConfig => ({
  conditions: [
    { name: '分支1', left: 'query', operator: 'contains', right: '' },
  ],
  elseBranchName: 'else',
})

const defaultCodeConfig = (): CodeNodeConfig => ({
  language: 'javascript',
  code: 'function main(input) {\n  return { result: input }\n}',
  outputSchema: '',
  writebackMappings: [],
  outputs: ['result'],
})

const createDefaultIterationChildren = (): IterationNodeConfig['children'] => ({
  nodes: [
    {
      id: 'iter-start',
      type: 'childNode',
      position: { x: 36, y: 40 },
      data: {
        title: '迭代开始',
        desc: '迭代子流程入口',
        type: BlockEnum.Start,
        config: defaultStartConfig(),
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
})

const defaultIterationConfig = (): IterationNodeConfig => ({
  iteratorSource: '',
  outputSource: '',
  outputVar: 'results',
  itemVar: 'item',
  indexVar: 'index',
  isParallel: false,
  parallelNums: 10,
  errorHandleMode: 'terminated',
  flattenOutput: true,
  children: createDefaultIterationChildren(),
})

const defaultHttpConfig = (): HttpNodeConfig => ({
  method: 'GET',
  url: '',
  query: [],
  headers: [],
  bodyType: 'none',
  body: '',
  timeout: 30,
  authorization: {
    type: 'none',
    apiKey: '',
    header: 'Authorization',
  },
  outputSchema: '',
  writebackMappings: [],
})

const defaultApiRequestConfig = (): ApiRequestNodeConfig => ({
  route: {
    method: 'GET',
    path: '',
  },
  params: [],
  paramValues: [],
  timeout: 30,
  successStatusCode: 200,
  writebackMappings: [],
})

const defaultInputConfig = (): InputNodeConfig => ({
  fields: [
    {
      name: 'input',
      label: '输入内容',
      type: 'text',
      required: true,
      options: [],
      defaultValue: '',
    },
  ],
})

const defaultFactories: { [K in BlockEnum]: () => DifyNodeConfigMap[K] } = {
  [BlockEnum.Start]: defaultStartConfig,
  [BlockEnum.End]: defaultEndConfig,
  [BlockEnum.LLM]: defaultLLMConfig,
  [BlockEnum.IfElse]: defaultIfElseConfig,
  [BlockEnum.Iteration]: defaultIterationConfig,
  [BlockEnum.Code]: defaultCodeConfig,
  [BlockEnum.HttpRequest]: defaultHttpConfig,
  [BlockEnum.ApiRequest]: defaultApiRequestConfig,
  [BlockEnum.Input]: defaultInputConfig,
}

export const createDefaultNodeConfig = <K extends BlockEnum>(type: K): DifyNodeConfigMap[K] => {
  return defaultFactories[type]()
}

export const ensureNodeConfig = <K extends BlockEnum>(
  type: K,
  config?: DifyNodeConfig,
): DifyNodeConfigMap[K] => {
  if (type === BlockEnum.Start) {
    const fallback = defaultStartConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const start = config as Partial<StartNodeConfig>
    const normalizedVariables = Array.isArray(start.variables)
      ? start.variables.map((item) => {
          const normalizedType = normalizeStartVariableType(item?.type)
          return {
            ...item,
            type: normalizedType,
            options: normalizeStartVariableOptions(item?.options),
            multiSelect: typeof item?.multiSelect === 'boolean' ? item.multiSelect : false,
            placeholder: typeof item?.placeholder === 'string' ? item.placeholder : undefined,
            visibleWhen: typeof item?.visibleWhen === 'string' ? item.visibleWhen : undefined,
            validateWhen: typeof item?.validateWhen === 'string' ? item.validateWhen : undefined,
            defaultValue: normalizeStartVariableDefault(
              normalizedType,
              (item as { default?: unknown; defaultValue?: unknown } | undefined)?.defaultValue
                ?? (item as { default?: unknown; defaultValue?: unknown } | undefined)?.default,
              typeof item?.multiSelect === 'boolean' ? item.multiSelect : false,
            ),
            maxLength: typeof item?.maxLength === 'number' ? item.maxLength : undefined,
            min: typeof item?.min === 'number' ? item.min : undefined,
            max: typeof item?.max === 'number' ? item.max : undefined,
            step: typeof item?.step === 'number' ? item.step : undefined,
            fileTypes: normalizeStartVariableFileTypes(item?.fileTypes),
            maxFiles: typeof item?.maxFiles === 'number' ? item.maxFiles : undefined,
            jsonSchema: typeof item?.jsonSchema === 'string' ? item.jsonSchema : undefined,
          }
        })
      : fallback.variables
    return {
      ...fallback,
      variables: normalizedVariables,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.Input) {
    const fallback = defaultInputConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const input = config as Partial<InputNodeConfig>
    const normalizedFields = Array.isArray(input.fields)
      ? input.fields.map(field => ({
          ...field,
          visibleWhen: typeof field?.visibleWhen === 'string' ? field.visibleWhen : undefined,
          validateWhen: typeof field?.validateWhen === 'string' ? field.validateWhen : undefined,
        }))
      : fallback.fields
    return {
      ...fallback,
      fields: normalizedFields,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.LLM) {
    const fallback = defaultLLMConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const llm = config as Partial<LLMNodeConfig>
    return {
      ...fallback,
      ...llm,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.IfElse) {
    const fallback = defaultIfElseConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const condition = config as Partial<IfElseNodeConfig>
    const normalizedConditions = Array.isArray(condition.conditions)
      ? condition.conditions.map((item, index) => ({
          name: typeof item?.name === 'string' && item.name.trim() ? item.name : `分支${index + 1}`,
          left: typeof item?.left === 'string' ? item.left : '',
          operator: item?.operator ?? 'contains',
          right: typeof item?.right === 'string' ? item.right : '',
        }))
      : fallback.conditions
    return {
      ...fallback,
      conditions: normalizedConditions,
      elseBranchName: typeof condition.elseBranchName === 'string' && condition.elseBranchName.trim()
        ? condition.elseBranchName
        : fallback.elseBranchName,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.Code) {
    const fallback = defaultCodeConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const code = config as Partial<CodeNodeConfig>
    return {
      ...fallback,
      ...code,
      outputSchema: typeof code.outputSchema === 'string' ? code.outputSchema : fallback.outputSchema,
      writebackMappings: Array.isArray(code.writebackMappings)
        ? code.writebackMappings.map(item => ({
            sourcePath: typeof item?.sourcePath === 'string' ? item.sourcePath : '',
            targetPath: typeof item?.targetPath === 'string' ? item.targetPath : '',
          }))
        : fallback.writebackMappings,
      outputs: Array.isArray(code.outputs) ? code.outputs : fallback.outputs,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.Iteration) {
    const fallback = defaultIterationConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const iteration = config as Partial<IterationNodeConfig>
    const normalizedChildren = {
      ...fallback.children,
      ...(isObject(iteration.children) ? iteration.children : {}),
      nodes: Array.isArray(iteration.children?.nodes) ? iteration.children.nodes : fallback.children.nodes,
      edges: Array.isArray(iteration.children?.edges) ? iteration.children.edges : fallback.children.edges,
    }
    if (normalizedChildren.nodes.length === 0)
      normalizedChildren.nodes = createDefaultIterationChildren().nodes

    return {
      ...fallback,
      ...iteration,
      itemVar: typeof iteration.itemVar === 'string' && iteration.itemVar.trim() ? iteration.itemVar : fallback.itemVar,
      indexVar: typeof iteration.indexVar === 'string' && iteration.indexVar.trim() ? iteration.indexVar : fallback.indexVar,
      parallelNums: typeof iteration.parallelNums === 'number' ? iteration.parallelNums : fallback.parallelNums,
      children: normalizedChildren,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.HttpRequest) {
    const fallback = defaultHttpConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const http = config as Partial<HttpNodeConfig>
    return {
      ...fallback,
      ...http,
      query: Array.isArray(http.query) ? http.query : fallback.query,
      headers: Array.isArray(http.headers) ? http.headers : fallback.headers,
      outputSchema: typeof http.outputSchema === 'string' ? http.outputSchema : fallback.outputSchema,
      writebackMappings: Array.isArray(http.writebackMappings)
        ? http.writebackMappings.map(item => ({
            sourcePath: typeof item?.sourcePath === 'string' ? item.sourcePath : '',
            targetPath: typeof item?.targetPath === 'string' ? item.targetPath : '',
          }))
        : fallback.writebackMappings,
      authorization: {
        ...fallback.authorization,
        ...(isObject(http.authorization) ? http.authorization : {}),
      },
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.ApiRequest) {
    const fallback = defaultApiRequestConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const api = config as Partial<ApiRequestNodeConfig>
    const route = isObject(api.route) ? api.route as Partial<ApiRequestNodeConfig['route']> : {}
    return {
      ...fallback,
      ...api,
      route: {
        ...fallback.route,
        ...route,
        method: (route.method === 'GET' || route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH' || route.method === 'DELETE')
          ? route.method
          : fallback.route.method,
        path: typeof route.path === 'string' ? route.path : fallback.route.path,
      },
      params: Array.isArray(api.params)
        ? api.params.map((item) => {
            const def = isObject(item) ? item as Record<string, unknown> : {}
            const validation = isObject(def.validation) ? def.validation as Record<string, unknown> : {}
            return {
              name: typeof def.name === 'string' ? def.name : '',
              in: def.in === 'path' || def.in === 'query' || def.in === 'body' ? (def.in as 'path' | 'query' | 'body') : 'query',
              type: typeof def.type === 'string' ? def.type : 'string',
              description: typeof def.description === 'string' ? def.description : undefined,
              validation: {
                required: typeof validation.required === 'boolean' ? validation.required : undefined,
                enum: Array.isArray(validation.enum) ? validation.enum.map(v => String(v)) : undefined,
                min: typeof validation.min === 'number' ? validation.min : undefined,
                max: typeof validation.max === 'number' ? validation.max : undefined,
                pattern: typeof validation.pattern === 'string' ? validation.pattern : undefined,
              },
            }
          })
        : fallback.params,
      paramValues: Array.isArray(api.paramValues)
        ? api.paramValues.map((item) => {
            const entry = isObject(item) ? item as Record<string, unknown> : {}
            const inValue = entry.in
            return {
              name: typeof entry.name === 'string' ? entry.name : '',
              in: inValue === 'path' || inValue === 'query' || inValue === 'body' ? (inValue as 'path' | 'query' | 'body') : 'query',
              value: typeof entry.value === 'string' ? entry.value : '',
            }
          })
        : fallback.paramValues,
      timeout: typeof api.timeout === 'number' ? api.timeout : fallback.timeout,
      successStatusCode: typeof api.successStatusCode === 'number' ? api.successStatusCode : fallback.successStatusCode,
      writebackMappings: Array.isArray(api.writebackMappings)
        ? api.writebackMappings.map(item => ({
            sourcePath: typeof item?.sourcePath === 'string' ? item.sourcePath : '',
            targetPath: typeof item?.targetPath === 'string' ? item.targetPath : '',
          }))
        : fallback.writebackMappings,
    } as DifyNodeConfigMap[K]
  }

  if (type === BlockEnum.End) {
    const fallback = defaultEndConfig()
    if (!config || !isObject(config))
      return fallback as DifyNodeConfigMap[K]
    const end = config as Partial<EndNodeConfig>
    const rawTemplateId = (end as { templateId?: unknown } | undefined)?.templateId
    const normalizedTemplateId = (() => {
      if (rawTemplateId === undefined || rawTemplateId === null || rawTemplateId === '' || rawTemplateId === 0)
        return undefined
      if (typeof rawTemplateId === 'number')
        return Number.isFinite(rawTemplateId) && rawTemplateId > 0 ? rawTemplateId : undefined
      const parsed = Number(String(rawTemplateId))
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    })()
    return {
      ...fallback,
      outputs: Array.isArray(end.outputs) ? end.outputs : fallback.outputs,
      templateId: normalizedTemplateId,
    } as DifyNodeConfigMap[K]
  }

  return createDefaultNodeConfig(type)
}
