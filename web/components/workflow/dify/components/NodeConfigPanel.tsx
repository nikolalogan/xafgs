import { useEffect, useMemo, useRef, useState } from 'react'
import { Cascader } from 'antd'
import StartNodeFormConfig from './StartNodeFormConfig'
import VariableValueInput from './VariableValueInput'
import CodeEditorField from './CodeEditorField'
import { createDefaultNodeConfig, ensureNodeConfig } from '../core/node-config'
import { extractSchemaLeafPaths } from '../core/json-schema'
import { adaptInputConfigToStartConfig, adaptStartConfigToInputConfig } from '../core/variable-form-adapter'
import { buildWorkflowVariableOptions, type VariableScope } from '../core/variables'
import {
  BlockEnum,
  type ApiRequestNodeConfig,
  type ApiRequestParamDef,
  type ApiRequestParamLocation,
  type CodeNodeConfig,
  type DifyNode,
  type EndNodeConfig,
  type HttpNodeConfig,
  type IfElseNodeConfig,
  type InputNodeConfig,
  type IterationNodeConfig,
  type LLMNodeConfig,
  type StartNodeConfig,
  type WorkflowGlobalVariable,
  type WorkflowParameter,
  type WorkflowVariableScope,
} from '../core/types'

type NodeConfigPanelProps = {
  nodes: DifyNode[]
  workflowParameters: WorkflowParameter[]
  globalVariables: WorkflowGlobalVariable[]
  workflowVariableScopes: Record<string, WorkflowVariableScope>
  llmModelOptions: Array<{ name: string; label: string }>
  defaultLLMModel: string
  defaultCodeModel: string
  activeNode: DifyNode | null
  onChange: (node: DifyNode) => void
  onChangeScopes: (scopes: Record<string, WorkflowVariableScope>) => void
  onFocusIterationRegion: (nodeId: string) => void
  onSave: () => void
}

const labelClass = 'block text-xs text-gray-500'
const inputClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
const sectionClass = 'space-y-2 rounded border border-gray-200 p-2'

type TemplateOption = {
  label: string
  value: number
}

type APIRouteDoc = {
  method: string
  path: string
  summary?: string
  auth?: string
  params?: ApiRequestParamDef[]
  responses?: Array<{
    httpStatus: number
    code: string
    contentType?: string
    description?: string
    dataShape?: string
    example?: unknown
  }>
}

type MappingCascaderOption = {
  value: string
  label: string
  children?: MappingCascaderOption[]
}

const parseJsonAny = (rawText: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  const trimmed = String(rawText || '').trim()
  if (!trimmed)
    return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'JSON 解析失败' }
  }
}

const stringifyPretty = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  }
  catch {
    return '{}'
  }
}

const extractPathsFromJson = (raw: unknown): string[] => {
  const paths: string[] = []
  const visit = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) {
      if (prefix)
        paths.push(prefix)
      return
    }

    if (Array.isArray(value)) {
      // 允许映射整个数组：data.list
      if (prefix)
        paths.push(prefix)
      // 允许映射数组元素对象：data.list[]
      if (prefix)
        paths.push(`${prefix}[]`)
      if (value.length === 0)
        return
      value.forEach((child) => {
        visit(child, prefix ? `${prefix}[]` : '$[]')
      })
      return
    }

    if (typeof value === 'object') {
      // 允许映射整个对象：data.baseInfo
      if (prefix)
        paths.push(prefix)
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0)
        return
      entries.forEach(([key, child]) => {
        visit(child, prefix ? `${prefix}.${key}` : key)
      })
      return
    }

    if (prefix)
      paths.push(prefix)
  }

  visit(raw, '')
  return [...new Set(paths)].filter(Boolean)
}

const inferSchemaFromJson = (value: unknown): Record<string, unknown> => {
  const infer = (raw: unknown): Record<string, unknown> => {
    if (raw === null)
      return { type: 'null' }
    if (Array.isArray(raw)) {
      const first = raw.length > 0 ? raw[0] : null
      return {
        type: 'array',
        items: infer(first),
      }
    }
    switch (typeof raw) {
      case 'string':
        return { type: 'string' }
      case 'number':
        return { type: 'number' }
      case 'boolean':
        return { type: 'boolean' }
      case 'object': {
        const properties: Record<string, unknown> = {}
        Object.entries(raw as Record<string, unknown>).forEach(([key, child]) => {
          properties[key] = infer(child)
        })
        return { type: 'object', properties }
      }
      default:
        return { type: 'string' }
    }
  }
  return infer(value)
}

const encodeParamValue = (value: unknown) => {
  if (value === undefined)
    return ''
  if (value === null)
    return 'null'
  if (typeof value === 'string')
    return value
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

const parseJsonObject = (rawText: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } => {
  const trimmed = String(rawText || '').trim()
  if (!trimmed)
    return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, error: '必须是 JSON 对象（例如 {"id":"1"}）' }
    return { ok: true, value: parsed as Record<string, unknown> }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'JSON 解析失败' }
  }
}

const toParamObject = (
  paramDefs: ApiRequestParamDef[],
  paramValues: Array<{ in: string; name: string; value: string }>,
  location: ApiRequestParamLocation,
) => {
  const allowed = new Set(paramDefs.filter(p => p.in === location).map(p => p.name))
  const obj: Record<string, unknown> = {}
  paramValues.forEach((item) => {
    if (item.in !== location)
      return
    if (!allowed.has(item.name))
      return
    const raw = String(item.value ?? '').trim()
    if (!raw)
      return
    try {
      obj[item.name] = JSON.parse(raw)
    }
    catch {
      obj[item.name] = item.value
    }
  })
  return obj
}

const upsertParamValuesFromObject = (
  config: ApiRequestNodeConfig,
  paramDefs: ApiRequestParamDef[],
  location: ApiRequestParamLocation,
  obj: Record<string, unknown>,
) => {
  const allowed = new Set(paramDefs.filter(p => p.in === location).map(p => p.name))
  const next = config.paramValues
    .filter(item => item.in !== location)
    .slice()
  Object.entries(obj).forEach(([key, value]) => {
    if (!allowed.has(key))
      return
    next.push({
      in: location,
      name: key,
      value: encodeParamValue(value),
    })
  })
  return next
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

const buildMappingCascaderOptions = (options: Array<{ key: string; param: string; displayLabel: string }>): MappingCascaderOption[] => {
  type TreeNode = {
    value: string
    label: string
    children: Map<string, TreeNode>
  }

  const roots = new Map<string, TreeNode>()

  const ensureRoot = (rootKey: string, label: string) => {
    const existed = roots.get(rootKey)
    if (existed)
      return existed
    const node: TreeNode = { value: rootKey, label: label || rootKey, children: new Map() }
    roots.set(rootKey, node)
    return node
  }

  for (const option of options) {
    const key = String(option.key || '').trim()
    const param = String(option.param || '').trim()
    if (!key || !param)
      continue

    const segments = key.split('.').filter(Boolean)
    const nodeId = segments[0] || ''
    const baseParam = param.split('.').filter(Boolean)[0] || ''
    if (!nodeId || !baseParam)
      continue

    const rootKey = `${nodeId}.${baseParam}`
    const root = ensureRoot(rootKey, rootKey)
    if (key === rootKey) {
      root.label = String(option.displayLabel || rootKey)
      continue
    }
    if (!key.startsWith(`${rootKey}.`))
      continue

    const remainder = key.slice(rootKey.length + 1)
    const pathSegments = remainder.split('.').filter(Boolean)
    let parent = root
    let acc = rootKey
    for (const seg of pathSegments) {
      acc = `${acc}.${seg}`
      if (!parent.children.has(seg)) {
        parent.children.set(seg, {
          value: acc,
          label: seg,
          children: new Map(),
        })
      }
      parent = parent.children.get(seg)!
    }
  }

  const toOption = (node: TreeNode): MappingCascaderOption => {
    const children = [...node.children.values()]
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
      .map(toOption)
    return {
      value: node.value,
      label: node.label,
      children: children.length ? children : undefined,
    }
  }

  return [...roots.values()]
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    .map(toOption)
}

const buildMappingCascaderValue = (targetPath: string): string[] => {
  const trimmed = String(targetPath || '').trim()
  if (!trimmed)
    return []
  const parts = trimmed.split('.').filter(Boolean)
  if (parts.length <= 1)
    return [trimmed]
  const chain: string[] = []
  let acc = `${parts[0]}.${parts[1] ?? ''}`.replace(/\.$/, '')
  if (acc)
    chain.push(acc)
  for (let i = 2; i < parts.length; i += 1) {
    acc = `${acc}.${parts[i]}`
    chain.push(acc)
  }
  return chain
}

export default function NodeConfigPanel({
  nodes,
  workflowParameters,
  globalVariables,
  workflowVariableScopes,
  llmModelOptions,
  defaultLLMModel,
  defaultCodeModel,
  activeNode,
  onChange,
  onChangeScopes,
  onFocusIterationRegion,
  onSave,
}: NodeConfigPanelProps) {
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([])
  const [apiRoutes, setApiRoutes] = useState<APIRouteDoc[]>([])
  const [apiRoutesError, setApiRoutesError] = useState('')
  const [httpResponseJsonByNode, setHttpResponseJsonByNode] = useState<Record<string, string>>({})
  const [httpResponseJsonErrorByNode, setHttpResponseJsonErrorByNode] = useState<Record<string, string>>({})
  const [apiJsonDraftByNode, setApiJsonDraftByNode] = useState<Record<string, Partial<Record<ApiRequestParamLocation, string>>>>({})
  const [apiJsonErrorByNode, setApiJsonErrorByNode] = useState<Record<string, Partial<Record<ApiRequestParamLocation, string>>>>({})
  const [apiJsonInsertKeyByNode, setApiJsonInsertKeyByNode] = useState<Record<string, Partial<Record<ApiRequestParamLocation, string>>>>({})
  const apiJsonTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const variableOptions = useMemo(
    () => buildWorkflowVariableOptions(nodes, workflowParameters, globalVariables, activeNode),
    [activeNode, globalVariables, nodes, workflowParameters],
  )
  const mappingTargetOptions = useMemo(
    () => variableOptions.filter(option => option.nodeId === 'workflow' || option.nodeId === 'global'),
    [variableOptions],
  )
  const mappingTargetCascaderOptions = useMemo(
    () => buildMappingCascaderOptions(mappingTargetOptions),
    [mappingTargetOptions],
  )

  useEffect(() => {
    const token = typeof window !== 'undefined'
      ? (window.localStorage.getItem('sxfg_access_token')
          || window.localStorage.getItem('access_token')
          || window.localStorage.getItem('token')
          || '')
      : ''
    if (!token)
      return

    const run = async () => {
      try {
        const response = await fetch('/api/templates', {
          method: 'GET',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        })
        const payload = await response.json() as { data?: Array<{ id: number; name: string; templateKey: string }>; message?: string }
        if (!response.ok || !Array.isArray(payload.data)) {
          setTemplateOptions([])
          return
        }
        const options = payload.data
          .map(item => ({
            value: Number(item.id),
            label: `${item.name || item.templateKey || item.id}（ID:${item.id}）`,
          }))
          .filter(item => Number.isFinite(item.value) && item.value > 0)
        setTemplateOptions(options)
      }
      catch {
        setTemplateOptions([])
      }
    }
    run()
  }, [])

  useEffect(() => {
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
          setApiRoutesError('未登录或登录已过期，无法加载 API 列表。请重新登录后刷新页面。')
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
          .map((route) => ({
            method: String(route.method || '').toUpperCase(),
            path: String(route.path || ''),
            summary: typeof route.summary === 'string' ? route.summary : undefined,
            auth: typeof route.auth === 'string' ? route.auth : undefined,
            params: Array.isArray(route.params) ? route.params : [],
            responses: Array.isArray(route.responses) ? route.responses : [],
          }))
          .filter(item => item.method && item.path)
        setApiRoutes(normalized)
        setApiRoutesError('')
      }
      catch {
        setApiRoutes([])
        setApiRoutesError('加载 API 列表失败（网络错误）')
      }
    }
    run()
  }, [])

  const getScope = (fieldKey: string, fallback: VariableScope = 'all') => workflowVariableScopes[fieldKey] ?? fallback
  const setScope = (fieldKey: string, scope: VariableScope) => {
    onChangeScopes({
      ...workflowVariableScopes,
      [fieldKey]: scope,
    })
  }
  const llmModelSelectOptions = useMemo(() => {
    if (llmModelOptions.length > 0)
      return llmModelOptions
    return [{ name: defaultLLMModel, label: defaultLLMModel }]
  }, [defaultLLMModel, llmModelOptions])

  useEffect(() => {
    if (!activeNode)
      return

    if (activeNode.data.config)
      return

    onChange({
      ...activeNode,
      data: {
        ...activeNode.data,
        config: createDefaultNodeConfig(activeNode.data.type),
      },
    })
  }, [activeNode, onChange])

  useEffect(() => {
    if (!activeNode || activeNode.data.type !== BlockEnum.LLM)
      return
    const config = ensureNodeConfig(BlockEnum.LLM, activeNode.data.config) as LLMNodeConfig
    const optionNames = new Set(llmModelSelectOptions.map(item => item.name))
    const fallbackModel = llmModelSelectOptions[0]?.name || defaultLLMModel
    const currentModel = String(config.model || '').trim()
    const nextModel = optionNames.has(currentModel) ? currentModel : fallbackModel
    if (nextModel === config.model)
      return
    onChange({
      ...activeNode,
      data: {
        ...activeNode.data,
        config: {
          ...config,
          model: nextModel,
        },
      },
    })
  }, [activeNode, defaultLLMModel, llmModelSelectOptions, onChange])

  useEffect(() => {
    if (!activeNode || activeNode.data.type !== BlockEnum.ApiRequest)
      return
    const config = ensureNodeConfig(BlockEnum.ApiRequest, activeNode.data.config) as ApiRequestNodeConfig
    const paramDefs = Array.isArray(config.params) ? config.params : []
    const nodeId = activeNode.id
    setApiJsonDraftByNode((prev) => {
      const existing = prev[nodeId] ?? {}
      const next = { ...existing }
      ;(['path', 'query', 'body'] as ApiRequestParamLocation[]).forEach((location) => {
        if (typeof next[location] === 'string')
          return
        if (!paramDefs.some(item => item.in === location))
          return
        next[location] = stringifyPretty(toParamObject(paramDefs, config.paramValues, location))
      })
      if (next === existing)
        return prev
      return { ...prev, [nodeId]: next }
    })
    setApiJsonErrorByNode(prev => ({ ...prev, [nodeId]: {} }))
  }, [activeNode?.id, activeNode?.data.type])

  if (!activeNode) {
    return (
      <div className="col-span-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 text-sm font-semibold">节点配置</div>
        <p className="text-xs text-gray-500">点击画布中的节点后可编辑</p>
      </div>
    )
  }

  const updateNode = (nextNode: DifyNode) => onChange(nextNode)

  const updateBase = (patch: Partial<DifyNode['data']>) => {
    updateNode({
      ...activeNode,
      data: {
        ...activeNode.data,
        ...patch,
      },
    })
  }

  const renderStartConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Start, activeNode.data.config) as StartNodeConfig
    return (
      <StartNodeFormConfig
        nodeId={activeNode.id}
        config={config}
        onChange={nextConfig => updateBase({ config: nextConfig })}
        variableOptions={variableOptions}
        getScope={getScope}
        onScopeChange={setScope}
        modelOptions={llmModelSelectOptions}
        defaultModel={defaultCodeModel}
      />
    )
  }

  const renderInputConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Input, activeNode.data.config) as InputNodeConfig
    const adaptedStartConfig = adaptInputConfigToStartConfig(config)

    const handleChange = (nextConfig: StartNodeConfig) => {
      updateBase({
        config: adaptStartConfigToInputConfig(config, nextConfig),
      })
    }

    return (
      <StartNodeFormConfig
        nodeId={activeNode.id}
        sectionKey="input"
        title="输入节点表单"
        addButtonLabel="新增字段"
        allowedTypes={['text-input', 'paragraph', 'number', 'select', 'checkbox']}
        config={adaptedStartConfig}
        onChange={handleChange}
        variableOptions={variableOptions}
        getScope={getScope}
        onScopeChange={setScope}
        modelOptions={llmModelSelectOptions}
        defaultModel={defaultCodeModel}
      />
    )
  }

  const renderLLMConfig = () => {
    const config = ensureNodeConfig(BlockEnum.LLM, activeNode.data.config) as LLMNodeConfig
    const updateConfig = (nextConfig: LLMNodeConfig) => updateBase({ config: nextConfig })
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">LLM 配置</div>
        <label className={labelClass}>模型</label>
        <select className={inputClass} value={config.model} onChange={event => updateConfig({ ...config, model: event.target.value })}>
          {llmModelSelectOptions.map(item => (
            <option key={item.name} value={item.name}>{item.label || item.name}</option>
          ))}
        </select>
        <label className={labelClass}>温度</label>
        <input className={inputClass} type="number" step="0.1" min="0" max="2" value={config.temperature} onChange={event => updateConfig({ ...config, temperature: Number(event.target.value || 0) })} />
        <label className={labelClass}>最大 Token</label>
        <input className={inputClass} type="number" min="1" value={config.maxTokens} onChange={event => updateConfig({ ...config, maxTokens: Number(event.target.value || 1) })} />
        <VariableValueInput
          label="System Prompt"
          value={config.systemPrompt}
          onChange={nextValue => updateConfig({ ...config, systemPrompt: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.llm.systemPrompt`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.llm.systemPrompt`, scope)}
          allowMultiline
          rows={4}
        />
        <VariableValueInput
          label="User Prompt"
          value={config.userPrompt}
          onChange={nextValue => updateConfig({ ...config, userPrompt: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.llm.userPrompt`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.llm.userPrompt`, scope)}
          allowMultiline
          rows={4}
        />
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={config.contextEnabled} onChange={event => updateConfig({ ...config, contextEnabled: event.target.checked })} />
          启用上下文
        </label>
      </div>
    )
  }

  const renderIfElseConfig = () => {
    const config = ensureNodeConfig(BlockEnum.IfElse, activeNode.data.config) as IfElseNodeConfig
    const updateConfig = (nextConfig: IfElseNodeConfig) => updateBase({ config: nextConfig })
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">条件分支</div>
        {config.conditions.map((condition, index) => (
          <div key={`if-condition-${index}`} className="space-y-1 rounded border border-gray-200 p-2">
            <label className={labelClass}>分支名称</label>
            <input
              className={inputClass}
              value={condition.name}
              onChange={(event) => {
                const next = [...config.conditions]
                next[index] = { ...condition, name: event.target.value }
                updateConfig({ ...config, conditions: next })
              }}
            />
            <VariableValueInput
              label="变量名"
              value={condition.left}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.if.left.${index}`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.if.left.${index}`, scope)}
              onChange={(nextValue) => {
                const next = [...config.conditions]
                next[index] = { ...condition, left: nextValue }
                updateConfig({ ...config, conditions: next })
              }}
            />
            <select
              className={inputClass}
              value={condition.operator}
              onChange={(event) => {
                const next = [...config.conditions]
                next[index] = { ...condition, operator: event.target.value as IfElseNodeConfig['conditions'][number]['operator'] }
                updateConfig({ ...config, conditions: next })
              }}
            >
              <option value="contains">包含</option>
              <option value="not_contains">不包含</option>
              <option value="eq">等于</option>
              <option value="neq">不等于</option>
              <option value="gt">大于</option>
              <option value="lt">小于</option>
              <option value="empty">为空</option>
              <option value="not_empty">不为空</option>
            </select>
            <VariableValueInput
              label="比较值"
              value={condition.right}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.if.right.${index}`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.if.right.${index}`, scope)}
              onChange={(nextValue) => {
                const next = [...config.conditions]
                next[index] = { ...condition, right: nextValue }
                updateConfig({ ...config, conditions: next })
              }}
            />
            <button
              onClick={() => {
                const next = config.conditions.filter((_, idx) => idx !== index)
                updateConfig({ ...config, conditions: next })
              }}
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
            >
              删除条件
            </button>
          </div>
        ))}
        <button
          onClick={() => updateConfig({
            ...config,
            conditions: [...config.conditions, { name: `分支${config.conditions.length + 1}`, left: '', operator: 'contains', right: '' }],
          })}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
        >
          新增条件
        </button>
        <div className="rounded border border-dashed border-gray-300 p-2">
          <label className={labelClass}>Else 分支名称（兜底分支）</label>
          <input
            className={inputClass}
            value={config.elseBranchName}
            onChange={event => updateConfig({ ...config, elseBranchName: event.target.value })}
          />
        </div>
      </div>
    )
  }

  const renderCodeConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Code, activeNode.data.config) as CodeNodeConfig
    const updateConfig = (nextConfig: CodeNodeConfig) => updateBase({ config: nextConfig })
    const codeScopeKey = `${activeNode.id}.code.content`
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">代码节点</div>
        <label className={labelClass}>语言</label>
        <select
          className={inputClass}
          value={config.language}
          onChange={event => updateConfig({ ...config, language: event.target.value as CodeNodeConfig['language'] })}
        >
          <option value="javascript">JavaScript</option>
          <option value="python3">Python3</option>
        </select>
        <label className={labelClass}>代码</label>
        <CodeEditorField
          value={config.code}
          onChange={nextCode => updateConfig({ ...config, code: nextCode })}
          options={variableOptions}
          scope={getScope(codeScopeKey, 'all')}
          onScopeChange={scope => setScope(codeScopeKey, scope)}
          aiGenerateConfig={{
            nodeType: 'code',
            language: config.language,
            nodeId: activeNode.id,
            fieldName: 'code',
            modelOptions: llmModelSelectOptions,
            defaultModel: defaultCodeModel,
          }}
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">输出写入参数</div>
          <label className={labelClass}>输出 JSON Schema（可选）</label>
          <textarea
            className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            placeholder={`{\n  "type": "object",\n  "properties": {\n    "result": { "type": "string" }\n  }\n}`}
            value={config.outputSchema ?? ''}
            onChange={event => updateConfig({ ...config, outputSchema: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={() => {
                const parsed = extractSchemaLeafPaths(config.outputSchema ?? '')
                if (!parsed.ok)
                  return
                const generated = parsed.paths.map(path => ({
                  sourcePath: path,
                  targetPath: '',
                }))
                updateConfig({
                  ...config,
                  writebackMappings: generated,
                })
              }}
            >
              按 Schema 生成映射
            </button>
          </div>
          <div className="space-y-2">
            {config.writebackMappings.length === 0 && (
              <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
                请先配置输出 Schema 并点击“按 Schema 生成映射”。
              </div>
            )}
            {config.writebackMappings.map((mapping, index) => (
              <div key={`code-writeback-${index}`} className="grid grid-cols-12 gap-2">
                <div
                  className="col-span-5 truncate rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-700"
                  style={{ paddingLeft: `${8 + Math.max(0, mapping.sourcePath.split('.').length - 1) * 10}px` }}
                  title={mapping.sourcePath}
                >
                  {mapping.sourcePath}
                </div>
                <Cascader
                  className="col-span-5"
                  options={mappingTargetCascaderOptions}
                  placeholder="选择全局/流程参数"
                  value={buildMappingCascaderValue(mapping.targetPath)}
                  allowClear
                  changeOnSelect
                  showSearch
                  onChange={(value) => {
                    const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                    const next = [...config.writebackMappings]
                    next[index] = { ...mapping, targetPath: selected }
                    updateConfig({ ...config, writebackMappings: next })
                  }}
                />
                <button
                  type="button"
                  className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                  onClick={() => updateConfig({
                    ...config,
                    writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
                  })}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
        <label className={labelClass}>输出变量（逗号分隔）</label>
        <input
          className={inputClass}
          value={config.outputs.join(',')}
          onChange={(event) => updateConfig({
            ...config,
            outputs: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
          })}
        />
      </div>
    )
  }

  const renderIterationConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Iteration, activeNode.data.config) as IterationNodeConfig
    const updateConfig = (nextConfig: IterationNodeConfig) => updateBase({ config: nextConfig })
    const childTypes: Array<{ type: BlockEnum; label: string }> = [
      { type: BlockEnum.LLM, label: 'LLM' },
      { type: BlockEnum.Code, label: '代码' },
      { type: BlockEnum.HttpRequest, label: 'HTTP' },
      { type: BlockEnum.IfElse, label: '条件分支' },
      { type: BlockEnum.Input, label: '输入' },
      { type: BlockEnum.End, label: '结束' },
    ]
    const addChildNode = (type: BlockEnum) => {
      const nextIndex = config.children.nodes.length + 1
      const nextNodeId = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const nextNode = {
        id: nextNodeId,
        type: 'childNode',
        position: {
          x: 40 + (config.children.nodes.length % 3) * 240,
          y: 40 + Math.floor(config.children.nodes.length / 3) * 150,
        },
        data: {
          title: `${type}-${nextIndex}`,
          desc: '',
          type,
          config: (() => {
            const nextConfig = createDefaultNodeConfig(type)
            if (type === BlockEnum.LLM) {
              const llmConfig = nextConfig as LLMNodeConfig
              llmConfig.model = defaultLLMModel
            }
            return nextConfig
          })(),
        },
      }
      updateConfig({
        ...config,
        children: {
          ...config.children,
          nodes: [...config.children.nodes, nextNode],
        },
      })
    }
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">迭代节点</div>
        <VariableValueInput
          label="迭代输入（Array）"
          value={config.iteratorSource}
          onChange={nextValue => updateConfig({ ...config, iteratorSource: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.iteration.iteratorSource`, 'array')}
          onScopeChange={scope => setScope(`${activeNode.id}.iteration.iteratorSource`, scope)}
          placeholder="例如 {{input.items}}"
        />
        <VariableValueInput
          label="输出来源（迭代体内变量）"
          value={config.outputSource}
          onChange={nextValue => updateConfig({ ...config, outputSource: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.iteration.outputSource`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.iteration.outputSource`, scope)}
          placeholder="例如 {{code.result}}"
        />
        <label className={labelClass}>输出变量名</label>
        <input
          className={inputClass}
          value={config.outputVar}
          placeholder="results"
          onChange={event => updateConfig({ ...config, outputVar: event.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>迭代项变量名</label>
            <input
              className={inputClass}
              value={config.itemVar}
              placeholder="item"
              onChange={event => updateConfig({ ...config, itemVar: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>索引变量名</label>
            <input
              className={inputClass}
              value={config.indexVar}
              placeholder="index"
              onChange={event => updateConfig({ ...config, indexVar: event.target.value })}
            />
          </div>
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={config.isParallel}
            onChange={event => updateConfig({ ...config, isParallel: event.target.checked })}
          />
          并行模式
        </label>
        {config.isParallel && (
          <>
            <label className={labelClass}>最大并行数</label>
            <input
              className={inputClass}
              type="number"
              min="1"
              max="100"
              value={config.parallelNums}
              onChange={event => updateConfig({ ...config, parallelNums: Number(event.target.value || 1) })}
            />
          </>
        )}
        <label className={labelClass}>错误处理方式</label>
        <select
          className={inputClass}
          value={config.errorHandleMode}
          onChange={event => updateConfig({ ...config, errorHandleMode: event.target.value as IterationNodeConfig['errorHandleMode'] })}
        >
          <option value="terminated">终止执行</option>
          <option value="continue-on-error">遇错继续</option>
          <option value="remove-abnormal-output">移除异常输出</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={config.flattenOutput}
            onChange={event => updateConfig({ ...config, flattenOutput: event.target.checked })}
          />
          扁平化输出
        </label>
        <div className="rounded border border-gray-200 p-2">
          <div className="mb-1 text-xs text-gray-600">
            子流程节点：{config.children.nodes.length}，连线：{config.children.edges.length}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {childTypes.map(item => (
              <button
                key={item.type}
                onClick={() => addChildNode(item.type)}
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
              >
                + {item.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onFocusIterationRegion(activeNode.id)}
            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
          >
            定位迭代区域
          </button>
        </div>
      </div>
    )
  }

  const renderHttpConfig = () => {
    const config = ensureNodeConfig(BlockEnum.HttpRequest, activeNode.data.config) as HttpNodeConfig
    const updateConfig = (nextConfig: HttpNodeConfig) => updateBase({ config: nextConfig })
    const updateKeyValueItem = (
      key: 'query' | 'headers',
      index: number,
      patch: Partial<HttpNodeConfig['query'][number]>,
    ) => {
      const nextList = [...config[key]]
      nextList[index] = { ...nextList[index], ...patch }
      updateConfig({ ...config, [key]: nextList })
    }
    const removeKeyValueItem = (key: 'query' | 'headers', index: number) => {
      const nextList = config[key].filter((_, idx) => idx !== index)
      updateConfig({ ...config, [key]: nextList })
    }
    const addKeyValueItem = (key: 'query' | 'headers') => {
      updateConfig({
        ...config,
        [key]: [...config[key], { key: '', value: '' }],
      })
    }

    const responseJsonDraft = httpResponseJsonByNode[activeNode.id] ?? ''
    const responseJsonError = httpResponseJsonErrorByNode[activeNode.id] ?? ''
    const applyResponseJson = (mode: 'schema' | 'mappings') => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok) {
        setHttpResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: parsed.error }))
        return
      }
      setHttpResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: '' }))

      if (mode === 'schema') {
        const schema = inferSchemaFromJson(parsed.value)
        updateConfig({ ...config, outputSchema: stringifyPretty(schema) })
        return
      }

      const paths = extractPathsFromJson(parsed.value)
      const normalized = paths.map(path => ({
        sourcePath: path,
        targetPath: '',
      }))
      updateConfig({ ...config, writebackMappings: normalized })
    }

    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">HTTP 请求</div>
        <label className={labelClass}>Method</label>
        <select
          className={inputClass}
          value={config.method}
          onChange={event => updateConfig({ ...config, method: event.target.value as HttpNodeConfig['method'] })}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
        <VariableValueInput
          label="URL"
          value={config.url}
          onChange={nextValue => updateConfig({ ...config, url: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.http.url`, 'string')}
          onScopeChange={scope => setScope(`${activeNode.id}.http.url`, scope)}
          placeholder="https://api.example.com/items/{{start.query}}"
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">Query 参数</div>
          {config.query.map((item, index) => (
            <div key={`query-${index}`} className="grid grid-cols-12 gap-2">
              <input
                className={`${inputClass} col-span-5`}
                placeholder="key"
                value={item.key}
                onChange={event => updateKeyValueItem('query', index, { key: event.target.value })}
              />
              <div className="col-span-5">
                <VariableValueInput
                  value={item.value}
                  onChange={nextValue => updateKeyValueItem('query', index, { value: nextValue })}
                  options={variableOptions}
                  scope={getScope(`${activeNode.id}.http.query.${index}`, 'all')}
                  onScopeChange={scope => setScope(`${activeNode.id}.http.query.${index}`, scope)}
                />
              </div>
              <button
                className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                onClick={() => removeKeyValueItem('query', index)}
              >
                删除
              </button>
            </div>
          ))}
          <button
            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
            onClick={() => addKeyValueItem('query')}
          >
            新增 Query
          </button>
        </div>
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">Headers</div>
          {config.headers.map((item, index) => (
            <div key={`header-${index}`} className="grid grid-cols-12 gap-2">
              <input
                className={`${inputClass} col-span-5`}
                placeholder="key"
                value={item.key}
                onChange={event => updateKeyValueItem('headers', index, { key: event.target.value })}
              />
              <div className="col-span-5">
                <VariableValueInput
                  value={item.value}
                  onChange={nextValue => updateKeyValueItem('headers', index, { value: nextValue })}
                  options={variableOptions}
                  scope={getScope(`${activeNode.id}.http.headers.${index}`, 'all')}
                  onScopeChange={scope => setScope(`${activeNode.id}.http.headers.${index}`, scope)}
                />
              </div>
              <button
                className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                onClick={() => removeKeyValueItem('headers', index)}
              >
                删除
              </button>
            </div>
          ))}
          <button
            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
            onClick={() => addKeyValueItem('headers')}
          >
            新增 Header
          </button>
        </div>
        <label className={labelClass}>认证类型</label>
        <select
          className={inputClass}
          value={config.authorization.type}
          onChange={event => updateConfig({
            ...config,
            authorization: { ...config.authorization, type: event.target.value as HttpNodeConfig['authorization']['type'] },
          })}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer</option>
          <option value="api-key">API Key</option>
        </select>
        {config.authorization.type !== 'none' && (
          <div className="space-y-2">
            <VariableValueInput
              value={config.authorization.apiKey}
              placeholder={config.authorization.type === 'api-key' ? 'API Key' : 'Bearer Token'}
              onChange={nextValue => updateConfig({
                ...config,
                authorization: { ...config.authorization, apiKey: nextValue },
              })}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.http.auth.apiKey`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.http.auth.apiKey`, scope)}
            />
            {config.authorization.type === 'api-key' && (
              <input
                className={inputClass}
                placeholder="Header 名（默认 Authorization）"
                value={config.authorization.header}
                onChange={event => updateConfig({
                  ...config,
                  authorization: { ...config.authorization, header: event.target.value },
                })}
              />
            )}
          </div>
        )}
        <label className={labelClass}>Body 类型</label>
        <select
          className={inputClass}
          value={config.bodyType}
          onChange={event => updateConfig({ ...config, bodyType: event.target.value as HttpNodeConfig['bodyType'] })}
        >
          <option value="none">None</option>
          <option value="json">JSON</option>
          <option value="x-www-form-urlencoded">x-www-form-urlencoded</option>
          <option value="form-data">form-data</option>
          <option value="raw">Raw Text</option>
        </select>
        {config.bodyType !== 'none' && (
          <VariableValueInput
            value={config.body}
            onChange={nextValue => updateConfig({ ...config, body: nextValue })}
            options={variableOptions}
            scope={getScope(`${activeNode.id}.http.body`, config.bodyType === 'json' ? 'object' : 'all')}
            onScopeChange={scope => setScope(`${activeNode.id}.http.body`, scope)}
            allowMultiline
            rows={5}
          />
        )}
        <label className={labelClass}>超时（秒）</label>
        <input
          className={inputClass}
          type="number"
          min="1"
          value={config.timeout}
          onChange={event => updateConfig({ ...config, timeout: Number(event.target.value || 1) })}
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">响应写入参数</div>
          <label className={labelClass}>响应 JSON Schema（可选）</label>
          <textarea
            className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            placeholder={`{\n  "type": "object",\n  "properties": {\n    "data": { "type": "object" }\n  }\n}`}
            value={config.outputSchema ?? ''}
            onChange={event => updateConfig({ ...config, outputSchema: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={() => {
                const parsed = extractSchemaLeafPaths(config.outputSchema ?? '')
                if (!parsed.ok)
                  return
                const generated = parsed.paths.map(path => ({
                  sourcePath: path,
                  targetPath: '',
                }))
                updateConfig({
                  ...config,
                  writebackMappings: generated,
                })
              }}
            >
              按 Schema 生成映射
            </button>
          </div>

          <label className={labelClass}>响应 JSON（导入，可选）</label>
          <textarea
            className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            placeholder='{"data":{"id":1,"name":"xx"}}'
            value={responseJsonDraft}
            onChange={(event) => {
              setHttpResponseJsonByNode(prev => ({ ...prev, [activeNode.id]: event.target.value }))
            }}
          />
          {!!responseJsonError && <div className="text-xs text-rose-600">JSON 错误：{responseJsonError}</div>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={() => applyResponseJson('schema')}
            >
              从 JSON 生成 Schema
            </button>
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={() => applyResponseJson('mappings')}
            >
              按 JSON 生成映射
            </button>
          </div>

          <div className="space-y-2">
            {config.writebackMappings.length === 0 && (
              <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
                请先配置响应 Schema 并点击“按 Schema 生成映射”。
              </div>
            )}
            {config.writebackMappings.map((mapping, index) => (
              <div key={`http-writeback-${index}`} className="grid grid-cols-12 gap-2">
                <div
                  className="col-span-5 rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 whitespace-normal break-all"
                  style={{ paddingLeft: `${8 + Math.max(0, mapping.sourcePath.split('.').length - 1) * 10}px` }}
                  title={mapping.sourcePath}
                >
                  {mapping.sourcePath}
                </div>
                <Cascader
                  className="col-span-5"
                  options={mappingTargetCascaderOptions}
                  placeholder="选择全局/流程参数"
                  value={buildMappingCascaderValue(mapping.targetPath)}
                  allowClear
                  changeOnSelect
                  showSearch
                  onChange={(value) => {
                    const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                    const next = [...config.writebackMappings]
                    next[index] = { ...mapping, targetPath: selected }
                    updateConfig({ ...config, writebackMappings: next })
                  }}
                />
                <button
                  type="button"
                  className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                  onClick={() => updateConfig({
                    ...config,
                    writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
                  })}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

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

  const renderApiRequestConfig = () => {
    const config = ensureNodeConfig(BlockEnum.ApiRequest, activeNode.data.config) as ApiRequestNodeConfig
    const updateConfig = (nextConfig: ApiRequestNodeConfig) => updateBase({ config: nextConfig })

    const groupOptions = Array
      .from(new Set(apiRoutes.map(route => resolveAPIGroupKey(route.path)).filter(Boolean)))
      .sort()

    const selectedGroup = resolveAPIGroupKey(config.route.path)
    const filteredRoutes = selectedGroup
      ? apiRoutes.filter(route => resolveAPIGroupKey(route.path) === selectedGroup)
      : apiRoutes

    const selectedRoute = apiRoutes.find(route => route.method === config.route.method && route.path === config.route.path) ?? null
    const paramDefs = (selectedRoute?.params?.length ? selectedRoute.params : config.params) ?? []

    const paramValueKey = (location: ApiRequestParamLocation, name: string) => `${location}:${name}`
    const valueByKey = new Map<string, string>()
    config.paramValues.forEach((item) => {
      valueByKey.set(paramValueKey(item.in, item.name), item.value)
    })

    const upsertRoute = (route: APIRouteDoc | null) => {
      if (!route) {
        updateConfig({
          ...config,
          route: { ...config.route, path: '' },
          params: [],
          paramValues: [],
        })
        setApiJsonDraftByNode(prev => ({ ...prev, [activeNode.id]: {} }))
        setApiJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: {} }))
        return
      }

      const nextParams = Array.isArray(route.params) ? route.params : []
      const nextValues = nextParams.map((param) => {
        const key = paramValueKey(param.in as ApiRequestParamLocation, param.name)
        const existing = valueByKey.get(key) ?? ''
        return {
          in: param.in as ApiRequestParamLocation,
          name: param.name,
          value: existing,
        }
      })

      updateConfig({
        ...config,
        route: {
          method: route.method as ApiRequestNodeConfig['route']['method'],
          path: route.path,
        },
        params: nextParams,
        paramValues: nextValues,
      })

      setApiJsonDraftByNode(prev => ({
        ...prev,
        [activeNode.id]: {
          path: stringifyPretty(toParamObject(nextParams, nextValues, 'path')),
          query: stringifyPretty(toParamObject(nextParams, nextValues, 'query')),
          body: stringifyPretty(toParamObject(nextParams, nextValues, 'body')),
        },
      }))
      setApiJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: {} }))
    }

    const updateParamValue = (location: ApiRequestParamLocation, name: string, value: string) => {
      const next = config.paramValues.slice()
      const index = next.findIndex(item => item.in === location && item.name === name)
      if (index >= 0)
        next[index] = { ...next[index], value }
      else
        next.push({ in: location, name, value })
      updateConfig({ ...config, paramValues: next })
    }

    const missingRequired = paramDefs.filter((param) => {
      const required = Boolean(param.validation?.required)
      if (!required)
        return false
      const raw = valueByKey.get(paramValueKey(param.in as ApiRequestParamLocation, param.name)) ?? ''
      return !raw.trim()
    })

    const applyDraft = (location: ApiRequestParamLocation) => {
      const fallback = stringifyPretty(toParamObject(paramDefs, config.paramValues, location))
      const text = apiJsonDraftByNode[activeNode.id]?.[location] ?? fallback
      const parsed = parseJsonObject(text)
      if (!parsed.ok) {
        setApiJsonErrorByNode(prev => ({
          ...prev,
          [activeNode.id]: {
            ...(prev[activeNode.id] ?? {}),
            [location]: parsed.error,
          },
        }))
        return
      }
      setApiJsonErrorByNode(prev => ({
        ...prev,
        [activeNode.id]: {
          ...(prev[activeNode.id] ?? {}),
          [location]: '',
        },
      }))
      const nextParamValues = upsertParamValuesFromObject(config, paramDefs, location, parsed.value)
      updateConfig({ ...config, params: paramDefs, paramValues: nextParamValues })
    }

    const fillRequiredTemplate = (location: ApiRequestParamLocation) => {
      const requiredKeys = paramDefs
        .filter(item => item.in === location && item.validation?.required)
        .map(item => item.name)
      const template: Record<string, unknown> = {}
      requiredKeys.forEach((key) => {
        template[key] = ''
      })
      setApiJsonDraftByNode(prev => ({
        ...prev,
        [activeNode.id]: {
          ...(prev[activeNode.id] ?? {}),
          [location]: stringifyPretty(template),
        },
      }))
      setApiJsonErrorByNode(prev => ({
        ...prev,
        [activeNode.id]: {
          ...(prev[activeNode.id] ?? {}),
          [location]: '',
        },
      }))
    }

    const renderJsonParamSection = (title: string, location: ApiRequestParamLocation) => {
      const list = paramDefs.filter(param => param.in === location)
      if (!list.length)
        return null

      const requiredKeys = list.filter(item => item.validation?.required).map(item => item.name)
      const allowedKeys = list.map(item => item.name)
      const draft = apiJsonDraftByNode[activeNode.id]?.[location]
        ?? stringifyPretty(toParamObject(paramDefs, config.paramValues, location))
      const errorText = apiJsonErrorByNode[activeNode.id]?.[location] ?? ''
      const selectedInsertKey = apiJsonInsertKeyByNode[activeNode.id]?.[location] ?? ''
      const insertKey = `${activeNode.id}:${location}`

      const insertVariable = () => {
        const selected = variableOptions.find(option => option.key === selectedInsertKey)
        if (!selected)
          return
        const token = selected.placeholder
        const textarea = apiJsonTextareaRefs.current[insertKey]
        const currentValue = apiJsonDraftByNode[activeNode.id]?.[location]
          ?? stringifyPretty(toParamObject(paramDefs, config.paramValues, location))
        if (!textarea) {
          setApiJsonDraftByNode(prev => ({
            ...prev,
            [activeNode.id]: {
              ...(prev[activeNode.id] ?? {}),
              [location]: `${currentValue}${token}`,
            },
          }))
          return
        }

        const start = textarea.selectionStart ?? currentValue.length
        const end = textarea.selectionEnd ?? currentValue.length
        const nextValue = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`
        setApiJsonDraftByNode(prev => ({
          ...prev,
          [activeNode.id]: {
            ...(prev[activeNode.id] ?? {}),
            [location]: nextValue,
          },
        }))

        requestAnimationFrame(() => {
          textarea.focus()
          const caret = start + token.length
          textarea.setSelectionRange(caret, caret)
        })
      }

      return (
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-700">{title}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                onClick={() => fillRequiredTemplate(location)}
              >
                生成必填模板
              </button>
              <button
                type="button"
                className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                onClick={() => applyDraft(location)}
              >
                应用
              </button>
            </div>
          </div>
          {requiredKeys.length > 0 && (
            <div className="text-[11px] text-gray-500">必填：{requiredKeys.join('、')}</div>
          )}
          <div className="text-[11px] text-gray-400">可用字段：{allowedKeys.join('、')}</div>
          <div className="grid grid-cols-12 gap-2">
            <select
              className="col-span-10 rounded border border-gray-300 px-2 py-1.5 text-xs"
              value={selectedInsertKey}
              onChange={event => setApiJsonInsertKeyByNode(prev => ({
                ...prev,
                [activeNode.id]: {
                  ...(prev[activeNode.id] ?? {}),
                  [location]: event.target.value,
                },
              }))}
            >
              <option value="">选择参数（插入到 JSON）</option>
              {variableOptions.map(option => (
                <option key={`api-json-insert-${location}-${option.key}`} value={option.key}>{option.displayLabel}</option>
              ))}
            </select>
            <button
              type="button"
              className="col-span-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
              onClick={insertVariable}
            >
              插入
            </button>
          </div>
          <textarea
            ref={(el) => {
              apiJsonTextareaRefs.current[insertKey] = el
            }}
            className="h-36 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs"
            value={draft}
            placeholder='{"id":"{{workflow.id}}"}'
            onChange={(event) => {
              const nextText = event.target.value
              setApiJsonDraftByNode(prev => ({
                ...prev,
                [activeNode.id]: {
                  ...(prev[activeNode.id] ?? {}),
                  [location]: nextText,
                },
              }))
            }}
            onBlur={() => applyDraft(location)}
          />
          {!!errorText && <div className="text-xs text-rose-600">JSON 错误：{errorText}</div>}
        </div>
      )
    }

    const successExampleDataPaths = (() => {
      const success = (selectedRoute?.responses ?? []).find(item => item.httpStatus === 200) ?? (selectedRoute?.responses ?? [])[0]
      const example = success?.example as any
      const data = example?.data
      return extractPathsFromExample(data)
    })()

    const appendMappingsFromExample = () => {
      const paths = successExampleDataPaths
      if (paths.length === 0)
        return
      const generated = paths.map(path => ({ sourcePath: `data.${path}`, targetPath: '' }))
      updateConfig({ ...config, writebackMappings: [...config.writebackMappings, ...generated] })
    }

    const suggestedSourcePaths = [
      'ok',
      'statusCode',
      'httpStatus',
      'message',
      'url',
      'method',
      'data',
      'response',
      ...successExampleDataPaths.map(path => `data.${path}`),
    ]

    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">API 请求</div>
        {!!apiRoutesError && (
          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-700">
            {apiRoutesError}
          </div>
        )}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-4">
            <label className={labelClass}>分组</label>
            <select
              className={inputClass}
              value={selectedGroup}
              onChange={(event) => {
                const nextGroup = event.target.value
                const nextRoutes = apiRoutes.filter(route => resolveAPIGroupKey(route.path) === nextGroup)
                const next = nextRoutes[0] ?? null
                upsertRoute(next)
              }}
              disabled={apiRoutes.length === 0}
            >
              <option value="">选择分组</option>
              {groupOptions.map(group => (
                <option key={`api-group-${group}`} value={group}>{group}</option>
              ))}
            </select>
          </div>
          <div className="col-span-8">
            <label className={labelClass}>路由</label>
            <select
              className={inputClass}
              value={`${config.route.method} ${config.route.path}`.trim()}
              onChange={(event) => {
                const raw = event.target.value
                const [nextMethod, ...rest] = raw.split(' ')
                const nextPath = rest.join(' ').trim()
                const matched = apiRoutes.find(route => route.method === nextMethod && route.path === nextPath) ?? null
                upsertRoute(matched)
              }}
              disabled={apiRoutes.length === 0}
            >
              <option value="">选择路由</option>
              {filteredRoutes.map(route => (
                <option key={`api-route-${route.method}-${route.path}`} value={`${route.method} ${route.path}`}>
                  {route.method} {route.path}{route.summary ? ` · ${route.summary}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!!missingRequired.length && (
          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-700">
            必填参数未配置：{missingRequired.map(item => `${item.in}.${item.name}`).join('，')}
          </div>
        )}

        {renderJsonParamSection('Path 参数（JSON）', 'path')}
        {renderJsonParamSection('Query 参数（JSON）', 'query')}
        {renderJsonParamSection('Body 参数（JSON）', 'body')}

        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-6">
            <label className={labelClass}>成功 statusCode</label>
            <input
              className={inputClass}
              type="number"
              min="100"
              max="599"
              value={config.successStatusCode}
              onChange={event => updateConfig({ ...config, successStatusCode: Number(event.target.value || 200) })}
            />
          </div>
          <div className="col-span-6">
            <label className={labelClass}>超时（秒）</label>
            <input
              className={inputClass}
              type="number"
              min="1"
              value={config.timeout}
              onChange={event => updateConfig({ ...config, timeout: Number(event.target.value || 30) })}
            />
          </div>
        </div>

        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-700">响应写入参数</div>
            <div className="flex items-center gap-2">
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                value=""
                onChange={(event) => {
                  const value = String(event.target.value || '').trim()
                  if (!value)
                    return
                  updateConfig({
                    ...config,
                    writebackMappings: [...config.writebackMappings, { sourcePath: value, targetPath: '' }],
                  })
                }}
              >
                <option value="">快捷添加 sourcePath</option>
                {suggestedSourcePaths.map(item => (
                  <option key={`api-source-${item}`} value={item}>{item}</option>
                ))}
              </select>
              <button
                type="button"
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                onClick={() => updateConfig({
                  ...config,
                  writebackMappings: [...config.writebackMappings, { sourcePath: '', targetPath: '' }],
                })}
              >
                新增映射
              </button>
              <button
                type="button"
                disabled={successExampleDataPaths.length === 0}
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={appendMappingsFromExample}
              >
                从示例生成
              </button>
            </div>
          </div>
          {config.writebackMappings.length === 0 && (
            <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
              sourcePath 从节点输出读取（示例：data.id / response.data.id）。
            </div>
          )}
          {config.writebackMappings.map((mapping, index) => (
            <div key={`api-writeback-${index}`} className="grid grid-cols-12 gap-2">
              <input
                className={`${inputClass} col-span-5 font-mono text-xs`}
                placeholder="sourcePath"
                value={mapping.sourcePath}
                onChange={(event) => {
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, sourcePath: event.target.value }
                  updateConfig({ ...config, writebackMappings: next })
                }}
              />
              <Cascader
                className="col-span-5"
                options={mappingTargetCascaderOptions}
                placeholder="选择全局/流程参数"
                value={buildMappingCascaderValue(mapping.targetPath)}
                allowClear
                changeOnSelect
                showSearch
                onChange={(value) => {
                  const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, targetPath: selected }
                  updateConfig({ ...config, writebackMappings: next })
                }}
              />
              <button
                type="button"
                className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                onClick={() => updateConfig({
                  ...config,
                  writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
                })}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderEndConfig = () => {
    const config = ensureNodeConfig(BlockEnum.End, activeNode.data.config) as EndNodeConfig
    const updateConfig = (nextConfig: EndNodeConfig) => updateBase({ config: nextConfig })
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">结束节点输出</div>
        <div className="space-y-1 rounded border border-gray-200 p-2">
          <div className="text-xs text-gray-600">模板（可选，用于渲染结束页 HTML）</div>
          <select
            className={inputClass}
            value={config.templateId ? String(config.templateId) : ''}
            onChange={(event) => {
              const next = event.target.value ? Number(event.target.value) : undefined
              updateConfig({ ...config, templateId: Number.isFinite(next as number) && (next as number) > 0 ? (next as number) : undefined })
            }}
          >
            <option value="">不使用模板</option>
            {templateOptions.map(option => (
              <option key={`end-template-${option.value}`} value={String(option.value)}>{option.label}</option>
            ))}
          </select>
          {!templateOptions.length && <div className="text-[11px] text-gray-400">暂无模板（请先在“模板配置”中创建）。</div>}
        </div>
        {config.outputs.map((item, index) => (
          <div key={`end-output-${index}`} className="space-y-1 rounded border border-gray-200 p-2">
            <input
              className={inputClass}
              placeholder="输出变量名"
              value={item.name}
              onChange={(event) => {
                const next = [...config.outputs]
                next[index] = { ...item, name: event.target.value }
                updateConfig({ ...config, outputs: next })
              }}
            />
            <VariableValueInput
              label="来源变量"
              value={item.source}
              onChange={(nextValue) => {
                const next = [...config.outputs]
                next[index] = { ...item, source: nextValue }
                updateConfig({ ...config, outputs: next })
              }}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.end.source.${index}`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.end.source.${index}`, scope)}
              placeholder="选择变量或手动输入，例如 {{llm-1.text}}"
            />
            <button
              onClick={() => {
                const next = config.outputs.filter((_, idx) => idx !== index)
                updateConfig({ ...config, outputs: next })
              }}
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
            >
              删除输出
            </button>
          </div>
        ))}
        <button
          onClick={() => updateConfig({
            ...config,
            outputs: [...config.outputs, { name: '', source: '' }],
          })}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
        >
          新增输出
        </button>
      </div>
    )
  }

  const renderNodeSpecificConfig = () => {
    const nodeType = activeNode.data.type
    if (nodeType === BlockEnum.Start) return renderStartConfig()
    if (nodeType === BlockEnum.Input) return renderInputConfig()
    if (nodeType === BlockEnum.LLM) return renderLLMConfig()
    if (nodeType === BlockEnum.IfElse) return renderIfElseConfig()
    if (nodeType === BlockEnum.Iteration) return renderIterationConfig()
    if (nodeType === BlockEnum.Code) return renderCodeConfig()
    if (nodeType === BlockEnum.HttpRequest) return renderHttpConfig()
    if (nodeType === BlockEnum.ApiRequest) return renderApiRequestConfig()
    if (nodeType === BlockEnum.End) return renderEndConfig()
    return null
  }

  return (
    <div className="col-span-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 text-sm font-semibold">节点配置</div>
      <div className="space-y-2">
        <label className={labelClass}>标题</label>
        <input
          className={inputClass}
          value={activeNode.data.title}
          onChange={event => updateBase({ title: event.target.value })}
        />
        <label className={labelClass}>描述</label>
        <textarea
          className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          value={activeNode.data.desc || ''}
          onChange={event => updateBase({ desc: event.target.value })}
        />
        {renderNodeSpecificConfig()}
        <button type="button" onClick={onSave} className="w-full rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700">保存节点配置</button>
      </div>
    </div>
  )
}
