import { useEffect, useMemo, useRef, useState } from 'react'
import { requestAINodeGenerate, type AINodeGenerateNodeType } from '../core/ai-node-generate'
import { BlockEnum, type ApiRequestNodeConfig, type DifyNodeConfig } from '../core/types'
import type { WorkflowVariableOption } from '../core/variables'

type AINodeGenerateResult = {
  nodeType: AINodeGenerateNodeType
  generatedConfig: DifyNodeConfig
  suggestedTitle: string
  suggestedDesc: string
}

type AINodeGenerateModalProps = {
  open: boolean
  modelOptions: Array<{ name: string; label: string }>
  defaultModel: string
  activeNodeType?: string
  variableOptions: WorkflowVariableOption[]
  onClose: () => void
  onConfirm: (result: AINodeGenerateResult) => void
}

type APIRouteDoc = {
  method: string
  path: string
  summary?: string
  auth?: string
  params?: Array<{
    name: string
    in: 'path' | 'query' | 'body'
    type: string
    description?: string
    validation?: {
      required?: boolean
      enum?: string[]
      min?: number
      max?: number
      pattern?: string
    }
  }>
  responses?: Array<{
    httpStatus: number
    code: string
    contentType?: string
    description?: string
    dataShape?: string
    example?: unknown
  }>
}

const nodeTypeOptions: Array<{ value: AINodeGenerateNodeType; label: string }> = [
  { value: BlockEnum.Start, label: '开始节点' },
  { value: BlockEnum.End, label: '结束节点' },
  { value: BlockEnum.Input, label: '输入节点' },
  { value: BlockEnum.LLM, label: 'LLM 节点' },
  { value: BlockEnum.IfElse, label: '条件节点' },
  { value: BlockEnum.Iteration, label: '迭代节点' },
  { value: BlockEnum.HttpRequest, label: 'HTTP 节点' },
  { value: BlockEnum.ApiRequest, label: 'API 请求节点' },
  { value: BlockEnum.Code, label: '代码节点' },
]

const resolveAPIGroupKey = (path: string) => {
  const trimmed = String(path || '').trim()
  if (!trimmed)
    return ''
  const normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const parts = normalized.split('/').filter(Boolean)
  const withoutApi = parts[0] === 'api' ? parts.slice(1) : parts
  if (withoutApi.length === 0)
    return ''
  if (withoutApi[0] === 'workflow' && withoutApi[1])
    return `${withoutApi[0]}/${withoutApi[1]}`
  return withoutApi[0]
}

const defaultRawValueByType = (valueType: string) => {
  const normalized = String(valueType || '').toLowerCase()
  if (normalized === 'number' || normalized === 'integer')
    return '0'
  if (normalized === 'boolean')
    return 'false'
  if (normalized === 'object')
    return '{}'
  if (normalized === 'array')
    return '[]'
  return '""'
}

const extractPlaceholdersFromText = (text: string): string[] => {
  const input = String(text || '')
  const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g
  const values: string[] = []
  const seen = new Set<string>()
  let matched = pattern.exec(input)
  while (matched) {
    const key = String(matched[1] || '').trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      values.push(`{{${key}}}`)
    }
    matched = pattern.exec(input)
  }
  return values
}

const extractPathsFromExample = (raw: unknown): string[] => {
  const paths: string[] = []
  const visit = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) {
      if (prefix)
        paths.push(prefix)
      return
    }
    if (Array.isArray(value)) {
      if (prefix)
        paths.push(prefix)
      if (value.length === 0) {
        if (prefix)
          paths.push(`${prefix}[]`)
        return
      }
      value.forEach((child) => {
        visit(child, prefix ? `${prefix}[]` : '$[]')
      })
      return
    }
    if (typeof value !== 'object') {
      if (prefix)
        paths.push(prefix)
      return
    }
    if (prefix)
      paths.push(prefix)
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0)
      return
    entries.forEach(([key, child]) => {
      visit(child, prefix ? `${prefix}.${key}` : key)
    })
  }
  visit(raw, '')
  return [...new Set(paths)].filter(Boolean)
}

const getPlaceholderLeafName = (placeholder: string) => {
  const raw = String(placeholder || '').trim()
  const key = raw.replace(/^\{\{/, '').replace(/\}\}$/, '').trim()
  const parts = key.split('.').filter(Boolean)
  if (parts.length === 0)
    return ''
  return parts[parts.length - 1].toLowerCase()
}

const pickParamPlaceholder = (
  paramName: string,
  descriptionPlaceholders: string[],
  variableOptions: WorkflowVariableOption[],
) => {
  const normalizedName = String(paramName || '').trim().toLowerCase()
  if (!normalizedName)
    return ''

  const exactFromDescription = descriptionPlaceholders.find(item => getPlaceholderLeafName(item) === normalizedName)
  if (exactFromDescription)
    return exactFromDescription

  const exactFromVariables = variableOptions.find((item) => {
    const parts = item.key.split('.').filter(Boolean)
    const leaf = parts[parts.length - 1] || ''
    return leaf.toLowerCase() === normalizedName
  })
  if (exactFromVariables)
    return exactFromVariables.placeholder

  return descriptionPlaceholders[0] || ''
}

const normalizeGeneratedAPIConfig = (
  config: DifyNodeConfig,
  selectedAPI: APIRouteDoc,
  description: string,
  variableOptions: WorkflowVariableOption[],
): DifyNodeConfig => {
  const apiConfig = (config && typeof config === 'object' ? config : {}) as Partial<ApiRequestNodeConfig>
  const descriptionPlaceholders = extractPlaceholdersFromText(description)
  const nextParams = Array.isArray(selectedAPI.params)
    ? selectedAPI.params.map(item => ({
        name: String(item.name || ''),
        in: item.in === 'path' || item.in === 'query' || item.in === 'body' ? item.in : 'query',
        type: String(item.type || 'string'),
        description: typeof item.description === 'string' ? item.description : undefined,
        validation: item.validation ?? {},
      }))
    : []

  const existingValues = new Map<string, string>()
  if (Array.isArray(apiConfig.paramValues)) {
    apiConfig.paramValues.forEach((item) => {
      const location = item?.in === 'path' || item?.in === 'query' || item?.in === 'body' ? item.in : 'query'
      const name = String(item?.name || '').trim()
      if (!name)
        return
      const key = `${location}:${name}`
      existingValues.set(key, typeof item?.value === 'string' ? item.value : '')
    })
  }

  const nextParamValues = nextParams.map((param) => {
    const key = `${param.in}:${param.name}`
    const existed = existingValues.get(key)
    if (typeof existed === 'string' && existed.trim())
      return { in: param.in, name: param.name, value: existed }
    const placeholder = pickParamPlaceholder(param.name, descriptionPlaceholders, variableOptions)
    if (placeholder)
      return { in: param.in, name: param.name, value: placeholder }
    return { in: param.in, name: param.name, value: defaultRawValueByType(param.type) }
  })

  const successStatusCode = typeof apiConfig.successStatusCode === 'number' ? apiConfig.successStatusCode : 200
  const successResponse = (selectedAPI.responses ?? []).find(item => item.httpStatus === successStatusCode)
    ?? (selectedAPI.responses ?? []).find(item => item.httpStatus === 200)
    ?? (selectedAPI.responses ?? [])[0]
  const successExample = successResponse?.example
  const successData = (successExample && typeof successExample === 'object')
    ? (successExample as Record<string, unknown>).data
    : undefined
  const dataPaths = extractPathsFromExample(successData)
  const generatedMappings = dataPaths.map(path => ({
    sourcePath: `data.${path}`,
    targetPath: '',
  }))
  const existingMappings = Array.isArray(apiConfig.writebackMappings) ? apiConfig.writebackMappings : []
  const mergedMappings = [...existingMappings]
  generatedMappings.forEach((item) => {
    const normalizedSourcePath = String(item.sourcePath || '').trim()
    if (!normalizedSourcePath)
      return
    const exists = mergedMappings.some(existing => String(existing?.sourcePath || '').trim() === normalizedSourcePath)
    if (!exists)
      mergedMappings.push(item)
  })

  return {
    route: {
      method: selectedAPI.method as ApiRequestNodeConfig['route']['method'],
      path: selectedAPI.path,
    },
    params: nextParams,
    paramValues: nextParamValues,
    timeout: typeof apiConfig.timeout === 'number' && apiConfig.timeout > 0 ? apiConfig.timeout : 30,
    successStatusCode: typeof apiConfig.successStatusCode === 'number' ? apiConfig.successStatusCode : 200,
    writebackMappings: mergedMappings,
  } satisfies ApiRequestNodeConfig
}

export default function AINodeGenerateModal({
  open,
  modelOptions,
  defaultModel,
  activeNodeType,
  variableOptions,
  onClose,
  onConfirm,
}: AINodeGenerateModalProps) {
  const safeModelOptions = useMemo(
    () => (modelOptions.length > 0 ? modelOptions : [{ name: defaultModel, label: defaultModel }]),
    [defaultModel, modelOptions],
  )

  const [model, setModel] = useState(defaultModel)
  const [nodeType, setNodeType] = useState<AINodeGenerateNodeType>(BlockEnum.LLM)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [generated, setGenerated] = useState<AINodeGenerateResult | null>(null)
  const [apiRoutes, setApiRoutes] = useState<APIRouteDoc[]>([])
  const [apiRoutesError, setApiRoutesError] = useState('')
  const [selectedAPIGroup, setSelectedAPIGroup] = useState('')
  const [selectedAPIRouteKey, setSelectedAPIRouteKey] = useState('')
  const [selectedInsertVariableKey, setSelectedInsertVariableKey] = useState('')
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!open)
      return
    const fallbackModel = safeModelOptions[0]?.name || defaultModel
    const allowed = new Set(safeModelOptions.map(item => item.name))
    const nextModel = allowed.has(defaultModel) ? defaultModel : fallbackModel
    setModel(nextModel)
    setNodeType(BlockEnum.LLM)
    setDescription('')
    setLoading(false)
    setErrorText('')
    setGenerated(null)
    setSelectedAPIGroup('')
    setSelectedAPIRouteKey('')
    setSelectedInsertVariableKey('')
  }, [defaultModel, open, safeModelOptions])

  useEffect(() => {
    if (!open)
      return
    const token = typeof window !== 'undefined'
      ? (window.localStorage.getItem('sxfg_access_token')
          || window.localStorage.getItem('access_token')
          || window.localStorage.getItem('token')
          || '')
      : ''

    const run = async () => {
      try {
        const response = await fetch('/api/meta/routes?includeTraces=0', {
          method: 'GET',
          headers: {
            'content-type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
        })
        if (response.status === 401) {
          setApiRoutes([])
          setApiRoutesError('未登录或登录已过期，无法加载 API 列表。')
          return
        }
        if (response.status === 403) {
          setApiRoutes([])
          setApiRoutesError('无权限加载 API 列表（需要管理员权限）。')
          return
        }
        const payload = await response.json() as { data?: { routes?: APIRouteDoc[] }; message?: string }
        if (!response.ok || !payload.data?.routes || !Array.isArray(payload.data.routes)) {
          setApiRoutes([])
          setApiRoutesError(payload.message || '加载 API 列表失败')
          return
        }
        const normalized = payload.data.routes
          .map(route => ({
            method: String(route.method || '').toUpperCase(),
            path: String(route.path || ''),
            summary: typeof route.summary === 'string' ? route.summary : undefined,
            auth: typeof route.auth === 'string' ? route.auth : undefined,
            params: Array.isArray(route.params) ? route.params : [],
            responses: Array.isArray(route.responses) ? route.responses : [],
          }))
          .filter(route => route.method && route.path)
        setApiRoutes(normalized)
        setApiRoutesError('')
      }
      catch {
        setApiRoutes([])
        setApiRoutesError('加载 API 列表失败（网络错误）')
      }
    }
    run()
  }, [open])

  const apiGroups = useMemo(
    () => Array.from(new Set(apiRoutes.map(route => resolveAPIGroupKey(route.path)).filter(Boolean))).sort(),
    [apiRoutes],
  )
  const filteredAPIRoutes = useMemo(
    () => (selectedAPIGroup ? apiRoutes.filter(route => resolveAPIGroupKey(route.path) === selectedAPIGroup) : apiRoutes),
    [apiRoutes, selectedAPIGroup],
  )
  const selectedAPI = useMemo(() => {
    if (!selectedAPIRouteKey)
      return null
    const [method, ...pathParts] = selectedAPIRouteKey.split(' ')
    const path = pathParts.join(' ').trim()
    if (!method || !path)
      return null
    return apiRoutes.find(route => route.method === method && route.path === path) ?? null
  }, [apiRoutes, selectedAPIRouteKey])

  if (!open)
    return null

  const insertVariableToDescription = () => {
    const selected = variableOptions.find(item => item.key === selectedInsertVariableKey)
    if (!selected)
      return
    const token = selected.placeholder
    const textarea = descriptionRef.current
    if (!textarea) {
      setDescription(prev => `${prev}${token}`)
      return
    }

    const currentValue = description
    const start = textarea.selectionStart ?? currentValue.length
    const end = textarea.selectionEnd ?? currentValue.length
    const nextValue = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`
    setDescription(nextValue)

    requestAnimationFrame(() => {
      textarea.focus()
      const nextCaret = start + token.length
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">AI 生成节点配置</div>
          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700" onClick={onClose}>关闭</button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-gray-500">模型</label>
          <select
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={model}
            onChange={event => setModel(event.target.value)}
          >
            {safeModelOptions.map(item => (
              <option key={item.name} value={item.name}>{item.label || item.name}</option>
            ))}
          </select>

          <label className="block text-xs text-gray-500">节点类型</label>
          <select
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={nodeType}
            onChange={event => setNodeType(event.target.value as AINodeGenerateNodeType)}
          >
            {nodeTypeOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>

          {nodeType === BlockEnum.ApiRequest && (
            <div className="space-y-2 rounded border border-gray-200 p-2">
              <div className="text-xs font-semibold text-gray-700">API 接口选择</div>
              {!!apiRoutesError && (
                <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                  {apiRoutesError}
                </div>
              )}
              <label className="block text-xs text-gray-500">分组</label>
              <select
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={selectedAPIGroup}
                onChange={(event) => {
                  const nextGroup = event.target.value
                  setSelectedAPIGroup(nextGroup)
                  setSelectedAPIRouteKey('')
                }}
              >
                <option value="">选择分组</option>
                {apiGroups.map(group => (
                  <option key={`ai-node-api-group-${group}`} value={group}>{group}</option>
                ))}
              </select>
              <label className="block text-xs text-gray-500">接口</label>
              <select
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={selectedAPIRouteKey}
                onChange={event => setSelectedAPIRouteKey(event.target.value)}
              >
                <option value="">选择接口</option>
                {filteredAPIRoutes.map(route => (
                  <option key={`ai-node-api-route-${route.method}-${route.path}`} value={`${route.method} ${route.path}`}>
                    {route.method} {route.path}{route.summary ? ` · ${route.summary}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="block text-xs text-gray-500">需求描述</label>
          <div className="grid grid-cols-12 gap-2">
            <select
              className="col-span-10 rounded border border-gray-300 px-2 py-1.5 text-xs"
              value={selectedInsertVariableKey}
              onChange={event => setSelectedInsertVariableKey(event.target.value)}
            >
              <option value="">选择参数（插入到描述）</option>
              {variableOptions.map(option => (
                <option key={`ai-node-insert-variable-${option.key}`} value={option.key}>{option.displayLabel}</option>
              ))}
            </select>
            <button
              type="button"
              className="col-span-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
              onClick={insertVariableToDescription}
            >
              插入
            </button>
          </div>
          <textarea
            ref={descriptionRef}
            className="h-24 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="请描述要生成的节点行为与配置"
            value={description}
            onChange={event => setDescription(event.target.value)}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={loading}
              onClick={async () => {
                setErrorText('')
                setGenerated(null)
                const trimmedDescription = description.trim()
                if (!trimmedDescription) {
                  setErrorText('请先填写需求描述')
                  return
                }
                if (nodeType === BlockEnum.ApiRequest && !selectedAPI) {
                  setErrorText('API 请求节点必须先选择接口')
                  return
                }

                setLoading(true)
                try {
                  const result = await requestAINodeGenerate({
                    model,
                    nodeType,
                    description: trimmedDescription,
                    context: {
                      activeNodeType: activeNodeType || '',
                      selectedAPI: nodeType === BlockEnum.ApiRequest && selectedAPI
                        ? {
                            method: selectedAPI.method,
                            path: selectedAPI.path,
                            summary: selectedAPI.summary,
                            auth: selectedAPI.auth,
                            params: selectedAPI.params || [],
                            responses: selectedAPI.responses || [],
                          }
                        : undefined,
                    },
                  })
                  const normalizedGeneratedConfig = nodeType === BlockEnum.ApiRequest && selectedAPI
                    ? normalizeGeneratedAPIConfig(result.generatedConfig, selectedAPI, trimmedDescription, variableOptions)
                    : result.generatedConfig
                  setGenerated({
                    nodeType,
                    generatedConfig: normalizedGeneratedConfig,
                    suggestedTitle: result.suggestedTitle,
                    suggestedDesc: result.suggestedDesc,
                  })
                }
                catch (error) {
                  setErrorText(error instanceof Error ? error.message : '生成失败')
                }
                finally {
                  setLoading(false)
                }
              }}
            >
              {loading ? '生成中...' : '生成'}
            </button>
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
              disabled={!generated}
              onClick={() => {
                if (!generated)
                  return
                onConfirm(generated)
                onClose()
              }}
            >
              生成并插入
            </button>
          </div>

          {errorText && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {errorText}
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs text-gray-500">预览（JSON）</label>
            <textarea
              className="h-52 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
              readOnly
              value={generated ? JSON.stringify(generated.generatedConfig, null, 2) : ''}
              placeholder="点击“生成”后显示配置"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
