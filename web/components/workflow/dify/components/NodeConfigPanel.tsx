import { useEffect, useMemo, useRef, useState } from 'react'
import { Cascader, Modal, Select, TreeSelect } from 'antd'
import StartNodeFormConfig from './StartNodeFormConfig'
import VariableValueInput from './VariableValueInput'
import CodeEditorField from './CodeEditorField'
import { createDefaultNodeConfig, ensureNodeConfig } from '../core/node-config'
import { adaptInputConfigToStartConfig, adaptStartConfigToInputConfig } from '../core/variable-form-adapter'
import { buildWorkflowVariableOptions, buildWorkflowVariableTreeOptions, type VariableScope } from '../core/variables'
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
  type WritebackMapping,
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
const antSelectClass = 'w-full'
const sectionClass = 'space-y-2 rounded border border-gray-200 p-2'
const mappingCascaderClass = 'w-full min-w-0 [&_.ant-select-selector]:min-w-0 [&_.ant-select-selection-item]:max-w-full [&_.ant-select-selection-item]:truncate'

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

type MappingModalType = 'code' | 'http' | 'api' | 'llm'
type MappingOwner = 'code' | 'http' | 'api' | 'llm'

type ArrayMappingPair = {
  sourceField: string
  targetField: string
}

type StructuredMappingType = 'array' | 'object'

type StructuredMappingDraft = {
  mappingType: StructuredMappingType
  sourcePath: string
  targetPath: string
  pairs: ArrayMappingPair[]
}

type MappingTestResult = {
  writebacks: Array<{ targetPath: string; value: unknown }>
  mergedOutput: Record<string, unknown>
  unsupportedExpressions: string[]
}

const defaultArrayMappingDraft = (): StructuredMappingDraft => ({
  mappingType: 'array',
  sourcePath: '',
  targetPath: '',
  pairs: [{ sourceField: '', targetField: '' }],
})

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

const normalizeRetryCountInput = (value: string) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0)
    return 0
  return Math.floor(parsed)
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

const findCascaderPathByValue = (options: MappingCascaderOption[], targetValue: string): string[] => {
  if (!targetValue)
    return []
  const visit = (items: MappingCascaderOption[], trail: string[]): string[] | null => {
    for (const item of items) {
      const nextTrail = [...trail, String(item.value)]
      if (String(item.value) === targetValue)
        return nextTrail
      if (Array.isArray(item.children) && item.children.length > 0) {
        const matched = visit(item.children, nextTrail)
        if (matched)
          return matched
      }
    }
    return null
  }
  return visit(options, []) ?? []
}

const buildMappingCascaderValue = (targetPath: string, options: MappingCascaderOption[]): string[] => {
  const trimmed = String(targetPath || '').trim()
  if (!trimmed)
    return []
  const matched = findCascaderPathByValue(options, trimmed)
  if (matched.length > 0)
    return matched
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

const buildSourcePathCascaderOptions = (paths: string[]): MappingCascaderOption[] => {
  type SourceTreeNode = {
    value: string
    label: string
    children: Map<string, SourceTreeNode>
  }
  const roots = new Map<string, SourceTreeNode>()

  const ensureRoot = (segment: string, value: string) => {
    const existed = roots.get(segment)
    if (existed)
      return existed
    const node: SourceTreeNode = {
      value,
      label: segment,
      children: new Map(),
    }
    roots.set(segment, node)
    return node
  }

  paths.forEach((path) => {
    const trimmed = String(path || '').trim()
    if (!trimmed)
      return
    const segments = trimmed.split('.').filter(Boolean)
    if (segments.length === 0)
      return

    let acc = segments[0]
    let parent = ensureRoot(segments[0], acc)
    for (let index = 1; index < segments.length; index += 1) {
      const segment = segments[index]
      acc = `${acc}.${segment}`
      const existed = parent.children.get(segment)
      if (existed) {
        parent = existed
        continue
      }
      const next: SourceTreeNode = {
        value: acc,
        label: segment,
        children: new Map(),
      }
      parent.children.set(segment, next)
      parent = next
    }
  })

  const toOption = (node: SourceTreeNode): MappingCascaderOption => {
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

const buildSourcePathCascaderValue = (sourcePath: string): string[] => {
  const trimmed = String(sourcePath || '').trim()
  if (!trimmed)
    return []
  const segments = trimmed.split('.').filter(Boolean)
  if (segments.length === 0)
    return []
  const chain: string[] = []
  let acc = segments[0]
  chain.push(acc)
  for (let i = 1; i < segments.length; i += 1) {
    acc = `${acc}.${segments[i]}`
    chain.push(acc)
  }
  return chain
}

const listArrayPaths = (paths: string[]): string[] => {
  const set = new Set<string>()
  paths.forEach((path) => {
    const trimmed = String(path || '').trim()
    if (!trimmed)
      return
    let from = 0
    while (from < trimmed.length) {
      const pos = trimmed.indexOf('[]', from)
      if (pos < 0)
        break
      set.add(trimmed.slice(0, pos + 2))
      from = pos + 2
    }
  })
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

const listFieldsUnderArrayPath = (paths: string[], arrayPath: string): string[] => {
  const prefix = `${String(arrayPath || '').trim()}.`
  if (!prefix || prefix === '.')
    return []
  const set = new Set<string>()
  paths.forEach((path) => {
    const trimmed = String(path || '').trim()
    if (!trimmed.startsWith(prefix))
      return
    const remainder = trimmed.slice(prefix.length).trim()
    if (!remainder)
      return
    set.add(remainder)
  })
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

const listObjectPaths = (paths: string[]): string[] => {
  const set = new Set<string>()
  paths.forEach((path) => {
    const trimmed = String(path || '').trim()
    if (!trimmed || trimmed.includes('[]'))
      return
    const prefix = `${trimmed}.`
    const hasChild = paths.some(candidate => String(candidate || '').trim().startsWith(prefix))
    if (hasChild)
      set.add(trimmed)
  })
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

const toJsonataAccessor = (base: string, rawFieldPath: string): string => {
  const fieldPath = String(rawFieldPath || '').trim()
  if (!fieldPath)
    return base
  return fieldPath
    .split('.')
    .filter(Boolean)
    .reduce((acc, segment) => {
      const isArraySegment = segment.endsWith('[]')
      const key = isArraySegment ? segment.slice(0, -2) : segment
      const accessor = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
        ? `${acc}.${key}`
        : `${acc}["${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
      if (isArraySegment)
        return `${accessor}[0]`
      return accessor
    }, base)
}

const buildArrayMappingJsonata = (sourceArrayPath: string, pairs: ArrayMappingPair[]): string => {
  const objectFields = pairs
    .map((pair) => {
      const sourceField = String(pair.sourceField || '').trim()
      const targetField = String(pair.targetField || '').trim()
      if (!sourceField || !targetField)
        return ''
      const escapedTarget = targetField.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const accessor = toJsonataAccessor('$v', sourceField)
      return `"${escapedTarget}": ${accessor}`
    })
    .filter(Boolean)
  return `$map(${sourceArrayPath}, function($v){ { ${objectFields.join(', ')} } })`
}

const buildObjectMappingJsonata = (sourcePath: string, pairs: ArrayMappingPair[]): string => {
  const base = String(sourcePath || '').trim() || '$'
  const objectFields = pairs
    .map((pair) => {
      const sourceField = String(pair.sourceField || '').trim()
      const targetField = String(pair.targetField || '').trim()
      if (!sourceField || !targetField)
        return ''
      const escapedTarget = targetField.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const accessor = toJsonataAccessor(base, sourceField)
      return `"${escapedTarget}": ${accessor}`
    })
    .filter(Boolean)
  return `{ ${objectFields.join(', ')} }`
}

const normalizePathForLookup = (rawPath: string): string => {
  return String(rawPath || '')
    .trim()
    .replace(/^\$\./, '')
    .replace(/^\$/, '')
    .replace(/\[\]/g, '.0')
    .replace(/\[(\d+)\]/g, '.$1')
}

const getValueByPathFromUnknown = (source: unknown, rawPath: string): unknown => {
  const normalized = normalizePathForLookup(rawPath)
  if (!normalized)
    return source
  const segments = normalized.split('.').map(item => item.trim()).filter(Boolean)
  let current: unknown = source
  for (const segment of segments) {
    if (current === null || current === undefined)
      return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index))
        return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object')
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

const evaluateSimpleExpression = (expression: string, context: unknown): { ok: true; value: unknown } | { ok: false } => {
  const trimmed = String(expression || '').trim()
  if (!trimmed)
    return { ok: false }
  const arrayMatches = trimmed.match(/\[\]/g) ?? []
  if (arrayMatches.length > 1)
    return { ok: false }
  if (arrayMatches.length === 0) {
    return { ok: true, value: getValueByPathFromUnknown(context, trimmed) }
  }
  const index = trimmed.indexOf('[]')
  if (index < 0)
    return { ok: false }
  const arrayPath = trimmed.slice(0, index + 2)
  const fieldPath = trimmed.slice(index + 2).replace(/^\./, '')
  const sourceArray = getValueByPathFromUnknown(context, arrayPath.slice(0, -2))
  if (!Array.isArray(sourceArray))
    return { ok: true, value: [] }
  if (!fieldPath)
    return { ok: true, value: sourceArray }
  return {
    ok: true,
    value: sourceArray.map((item) => {
      const v = getValueByPathFromUnknown(item, fieldPath)
      return v === undefined ? '' : v
    }),
  }
}

const setValueByTargetPath = (target: Record<string, unknown>, rawPath: string, value: unknown) => {
  const trimmed = String(rawPath || '').trim()
  if (!trimmed)
    return
  const normalized = normalizePathForLookup(trimmed.endsWith('[]') ? trimmed.slice(0, -2) : trimmed)
  const segments = normalized.split('.').map(item => item.trim()).filter(Boolean)
  if (segments.length === 0)
    return

  let current: Record<string, unknown> = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    const existing = current[key]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing))
      current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
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
  const [codeResponseJsonByNode, setCodeResponseJsonByNode] = useState<Record<string, string>>({})
  const [codeResponseJsonErrorByNode, setCodeResponseJsonErrorByNode] = useState<Record<string, string>>({})
  const [httpResponseJsonByNode, setHttpResponseJsonByNode] = useState<Record<string, string>>({})
  const [httpResponseJsonErrorByNode, setHttpResponseJsonErrorByNode] = useState<Record<string, string>>({})
  const [llmResponseJsonByNode, setLlmResponseJsonByNode] = useState<Record<string, string>>({})
  const [llmResponseJsonErrorByNode, setLlmResponseJsonErrorByNode] = useState<Record<string, string>>({})
  const [apiJsonDraftByNode, setApiJsonDraftByNode] = useState<Record<string, Partial<Record<ApiRequestParamLocation, string>>>>({})
  const [apiJsonErrorByNode, setApiJsonErrorByNode] = useState<Record<string, Partial<Record<ApiRequestParamLocation, string>>>>({})
  const [apiJsonInsertKeyByNode, setApiJsonInsertKeyByNode] = useState<Record<string, Partial<Record<ApiRequestParamLocation, string>>>>({})
  const [mappingModalType, setMappingModalType] = useState<MappingModalType | null>(null)
  const [arrayMappingDraftByOwner, setArrayMappingDraftByOwner] = useState<Record<string, StructuredMappingDraft>>({})
  const [arrayMappingErrorByOwner, setArrayMappingErrorByOwner] = useState<Record<string, string>>({})
  const [mappingTestInputByOwner, setMappingTestInputByOwner] = useState<Record<string, string>>({})
  const [mappingTestResultByOwner, setMappingTestResultByOwner] = useState<Record<string, MappingTestResult | null>>({})
  const [mappingTestErrorByOwner, setMappingTestErrorByOwner] = useState<Record<string, string>>({})
  const apiJsonTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const variableOptions = useMemo(
    () => buildWorkflowVariableOptions(nodes, workflowParameters, globalVariables, activeNode),
    [activeNode, globalVariables, nodes, workflowParameters],
  )
  const mappingTargetOptions = useMemo(
    () => variableOptions.filter(option => option.nodeId === 'workflow' || option.nodeId === 'global'),
    [variableOptions],
  )
  const variableTreeOptions = useMemo(
    () => buildWorkflowVariableTreeOptions(variableOptions),
    [variableOptions],
  )
  const mappingTargetCascaderOptions = useMemo(
    () => buildMappingCascaderOptions(mappingTargetOptions),
    [mappingTargetOptions],
  )

  const buildMappingOwnerKey = (owner: MappingOwner) => `${activeNode?.id || 'none'}:${owner}`

  const getArrayDraft = (owner: MappingOwner): StructuredMappingDraft => {
    const key = buildMappingOwnerKey(owner)
    return arrayMappingDraftByOwner[key] ?? defaultArrayMappingDraft()
  }

  const setArrayDraft = (owner: MappingOwner, updater: (prev: StructuredMappingDraft) => StructuredMappingDraft) => {
    const key = buildMappingOwnerKey(owner)
    setArrayMappingDraftByOwner((prev) => {
      const current = prev[key] ?? defaultArrayMappingDraft()
      const next = updater(current)
      return { ...prev, [key]: next }
    })
  }

  const setArrayDraftError = (owner: MappingOwner, message: string) => {
    const key = buildMappingOwnerKey(owner)
    setArrayMappingErrorByOwner(prev => ({ ...prev, [key]: message }))
  }

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

  useEffect(() => {
    setMappingModalType(null)
  }, [activeNode?.id, activeNode?.data.type])

  useEffect(() => {
    if (!activeNode)
      return
    const owner: MappingOwner | null = activeNode.data.type === BlockEnum.HttpRequest
      ? 'http'
      : activeNode.data.type === BlockEnum.ApiRequest
        ? 'api'
        : activeNode.data.type === BlockEnum.LLM
          ? 'llm'
        : null
    if (!owner)
      return

    const config = activeNode.data.type === BlockEnum.HttpRequest
      ? ensureNodeConfig(BlockEnum.HttpRequest, activeNode.data.config) as HttpNodeConfig
      : activeNode.data.type === BlockEnum.ApiRequest
        ? ensureNodeConfig(BlockEnum.ApiRequest, activeNode.data.config) as ApiRequestNodeConfig
        : ensureNodeConfig(BlockEnum.LLM, activeNode.data.config) as LLMNodeConfig
    const matched = [...(config.writebackMappings ?? [])]
      .reverse()
      .find(item => item?.arrayMapping && item.arrayMapping.sourceArrayPath && item.arrayMapping.targetArrayPath)
    if (!matched?.arrayMapping)
      return
    const key = `${activeNode.id}:${owner}`
    setArrayMappingDraftByOwner(prev => ({
      ...prev,
      [key]: {
        mappingType: matched.arrayMapping?.mappingType === 'object' ? 'object' : 'array',
        sourcePath: matched.arrayMapping?.sourceArrayPath || '',
        targetPath: matched.arrayMapping?.targetArrayPath || '',
        pairs: matched.arrayMapping?.pairs?.length
          ? matched.arrayMapping.pairs.map(pair => ({
              sourceField: pair.sourceField || '',
              targetField: pair.targetField || '',
            }))
          : [{ sourceField: '', targetField: '' }],
      },
    }))
  }, [activeNode])

  if (!activeNode) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.35)]">
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

  const getWritebackExpression = (mapping: { expression?: string; sourcePath?: string }) => String(mapping.expression || mapping.sourcePath || '')

  const renderArrayMappingBuilder = (
    owner: MappingOwner,
    mappings: WritebackMapping[],
    onChangeMappings: (next: WritebackMapping[]) => void,
    sourcePaths: string[],
  ) => {
    const draft = getArrayDraft(owner)
    const ownerKey = buildMappingOwnerKey(owner)
    const sourceContainerPaths = draft.mappingType === 'array' ? listArrayPaths(sourcePaths) : listObjectPaths(sourcePaths)
    const sourceFieldPaths = listFieldsUnderArrayPath(sourcePaths, draft.sourcePath)
    const targetSourcePaths = mappingTargetOptions.map(item => item.key)
    const targetContainerPaths = draft.mappingType === 'array' ? listArrayPaths(targetSourcePaths) : listObjectPaths(targetSourcePaths)
    const targetFieldPaths = listFieldsUnderArrayPath(targetSourcePaths, draft.targetPath)
    const errorText = arrayMappingErrorByOwner[ownerKey] ?? ''

    const addArrayMapping = () => {
      const sourcePath = String(draft.sourcePath || '').trim()
      const targetPath = String(draft.targetPath || '').trim()
      const pairs = draft.pairs
        .map(item => ({
          sourceField: String(item.sourceField || '').trim(),
          targetField: String(item.targetField || '').trim(),
        }))
        .filter(item => item.sourceField || item.targetField)
      if (!sourcePath || !targetPath) {
        setArrayDraftError(owner, draft.mappingType === 'array' ? '请先选择源数组与目标数组。' : '请先选择源对象与目标对象。')
        return
      }
      if (draft.mappingType === 'array' && (!sourcePath.endsWith('[]') || !targetPath.endsWith('[]'))) {
        setArrayDraftError(owner, '数组模式仅支持单层数组路径（需以 [] 结尾）。')
        return
      }
      if (draft.mappingType === 'object' && (sourcePath.endsWith('[]') || targetPath.endsWith('[]'))) {
        setArrayDraftError(owner, '对象模式不支持数组路径（不能以 [] 结尾）。')
        return
      }
      if (pairs.length === 0) {
        setArrayDraftError(owner, '请至少添加一条字段配对。')
        return
      }
      if (pairs.some(item => !item.sourceField || !item.targetField)) {
        setArrayDraftError(owner, '字段配对不能为空。')
        return
      }
      const hasInvalidTargetArray = pairs.some(item => item.targetField.includes('[]'))
      if (hasInvalidTargetArray) {
        setArrayDraftError(owner, '目标字段不支持数组路径（请映射到同层字段）。')
        return
      }
      const hasTooDeepSourceArray = pairs.some((item) => {
        const matches = item.sourceField.match(/\[\]/g) ?? []
        return matches.length > 1
      })
      if (hasTooDeepSourceArray) {
        setArrayDraftError(owner, '源字段最多支持一层子数组（如 guarantor[].itName）。')
        return
      }
      const duplicatedTargets = pairs
        .map(item => item.targetField)
        .filter((value, index, list) => list.indexOf(value) !== index)
      if (duplicatedTargets.length > 0) {
        setArrayDraftError(owner, `目标字段重复：${[...new Set(duplicatedTargets)].join('、')}`)
        return
      }

      const expression = draft.mappingType === 'array'
        ? buildArrayMappingJsonata(sourcePath, pairs)
        : buildObjectMappingJsonata(sourcePath, pairs)
      const nextMapping: WritebackMapping = {
        mode: 'value',
        expression,
        targetPath,
        sourcePath: '',
        arrayMapping: {
          mappingType: draft.mappingType,
          sourceArrayPath: sourcePath,
          targetArrayPath: targetPath,
          pairs,
        },
      }
      onChangeMappings([...mappings, nextMapping])
      setArrayDraftError(owner, '')
    }

    return (
      <div className="space-y-2 rounded border border-emerald-200 bg-emerald-50/40 p-2">
        <div className="text-xs font-semibold text-emerald-800">结构字段配对</div>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-12 md:col-span-4">
            <div className="mb-1 text-[11px] text-gray-600">配对模式</div>
            <Select
              className={antSelectClass}
              value={draft.mappingType}
              options={[
                { value: 'array', label: '数组对象映射（a[] → b[]）' },
                { value: 'object', label: '对象映射（a → b）' },
              ]}
              onChange={(value) => {
                const mappingType = value === 'object' ? 'object' as const : 'array' as const
                setArrayDraft(owner, prev => ({
                  ...prev,
                  mappingType,
                  sourcePath: '',
                  targetPath: '',
                  pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                }))
                setArrayDraftError(owner, '')
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-12 md:col-span-6">
            <div className="mb-1 text-[11px] text-gray-600">{draft.mappingType === 'array' ? '源数组' : '源对象'}</div>
            <Cascader
              className={mappingCascaderClass}
              options={buildSourcePathCascaderOptions(sourceContainerPaths)}
              placeholder={draft.mappingType === 'array' ? '选择源数组（如 data.list[]）' : '选择源对象（如 data.baseInfo）'}
              value={buildSourcePathCascaderValue(draft.sourcePath)}
              allowClear
              changeOnSelect
              showSearch
              onChange={(value) => {
                const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                setArrayDraft(owner, prev => ({
                  ...prev,
                  sourcePath: selected,
                  pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                }))
              }}
            />
          </div>
          <div className="col-span-12 md:col-span-6">
            <div className="mb-1 text-[11px] text-gray-600">{draft.mappingType === 'array' ? '目标数组' : '目标对象'}</div>
            <Cascader
              className={mappingCascaderClass}
              options={buildSourcePathCascaderOptions(targetContainerPaths)}
              placeholder={draft.mappingType === 'array' ? '选择目标数组（如 workflow.entp.tags[]）' : '选择目标对象（如 workflow.entp.financeSnapshot）'}
              value={buildSourcePathCascaderValue(draft.targetPath)}
              allowClear
              changeOnSelect
              showSearch
              onChange={(value) => {
                const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                setArrayDraft(owner, prev => ({ ...prev, targetPath: selected }))
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {draft.pairs.map((pair, index) => (
            <div key={`${ownerKey}-pair-${index}`} className="grid grid-cols-12 gap-2">
              <div className="col-span-12 md:col-span-5">
                <Select
                  className={antSelectClass}
                  value={pair.sourceField}
                  placeholder="源字段"
                  options={sourceFieldPaths.map(field => ({ value: field, label: field }))}
                  onChange={(value) => {
                    setArrayDraft(owner, (prev) => {
                      const nextPairs = prev.pairs.slice()
                      nextPairs[index] = { ...nextPairs[index], sourceField: value }
                      return { ...prev, pairs: nextPairs }
                    })
                  }}
                />
              </div>
              <div className="col-span-12 md:col-span-1 text-center text-xs text-gray-400 md:py-2">→</div>
              <div className="col-span-12 md:col-span-5">
                <Select
                  className={antSelectClass}
                  value={pair.targetField}
                  placeholder="目标字段"
                  options={targetFieldPaths.map(field => ({ value: field, label: field }))}
                  onChange={(value) => {
                    setArrayDraft(owner, (prev) => {
                      const nextPairs = prev.pairs.slice()
                      nextPairs[index] = { ...nextPairs[index], targetField: value }
                      return { ...prev, pairs: nextPairs }
                    })
                  }}
                />
              </div>
              <button
                type="button"
                className="col-span-12 md:col-span-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={draft.pairs.length <= 1}
                onClick={() => {
                  setArrayDraft(owner, (prev) => ({
                    ...prev,
                    pairs: prev.pairs.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }}
              >
                删
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
            onClick={() => {
              setArrayDraft(owner, (prev) => ({
                ...prev,
                pairs: [...prev.pairs, { sourceField: '', targetField: '' }],
              }))
            }}
          >
            新增字段配对
          </button>
          <button
            type="button"
            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
            onClick={addArrayMapping}
          >
            生成映射
          </button>
        </div>
        {!!errorText && <div className="text-xs text-rose-600">{errorText}</div>}
      </div>
    )
  }

  const renderMappingTester = (owner: MappingOwner, mappings: WritebackMapping[]) => {
    const ownerKey = buildMappingOwnerKey(owner)
    const draft = mappingTestInputByOwner[ownerKey] ?? ''
    const result = mappingTestResultByOwner[ownerKey] ?? null
    const error = mappingTestErrorByOwner[ownerKey] ?? ''

    const runTest = () => {
      const parsed = parseJsonAny(draft)
      if (!parsed.ok) {
        setMappingTestErrorByOwner(prev => ({ ...prev, [ownerKey]: `响应 JSON 解析失败：${parsed.error}` }))
        setMappingTestResultByOwner(prev => ({ ...prev, [ownerKey]: null }))
        return
      }
      const writebacks: Array<{ targetPath: string; value: unknown }> = []
      const mergedOutput: Record<string, unknown> = {}
      const unsupportedExpressions: string[] = []
      for (const mapping of mappings) {
        const targetPath = String(mapping.targetPath || '').trim()
        if (!targetPath)
          continue
        if (mapping.arrayMapping && mapping.arrayMapping.sourceArrayPath && mapping.arrayMapping.targetArrayPath) {
          const sourcePath = String(mapping.arrayMapping.sourceArrayPath || '').trim()
          const mappingType = mapping.arrayMapping.mappingType === 'object' ? 'object' : 'array'
          const pairs = Array.isArray(mapping.arrayMapping.pairs) ? mapping.arrayMapping.pairs : []
          if (mappingType === 'object') {
            const sourceObject = getValueByPathFromUnknown(parsed.value, sourcePath)
            const root = (sourceObject && typeof sourceObject === 'object') ? sourceObject : {}
            const item: Record<string, unknown> = {}
            pairs.forEach((pair) => {
              const sourceField = String(pair.sourceField || '').trim()
              const targetField = String(pair.targetField || '').trim()
              if (!sourceField || !targetField)
                return
              const val = getValueByPathFromUnknown(root, sourceField)
              item[targetField] = val === undefined ? '' : val
            })
            writebacks.push({ targetPath, value: item })
            setValueByTargetPath(mergedOutput, targetPath, item)
          }
          else {
            const sourceArray = getValueByPathFromUnknown(parsed.value, sourcePath.slice(0, -2))
            const rows = Array.isArray(sourceArray)
              ? sourceArray.map((row) => {
                  const item: Record<string, unknown> = {}
                  pairs.forEach((pair) => {
                    const sourceField = String(pair.sourceField || '').trim()
                    const targetField = String(pair.targetField || '').trim()
                    if (!sourceField || !targetField)
                      return
                    const val = getValueByPathFromUnknown(row, sourceField)
                    item[targetField] = val === undefined ? '' : val
                  })
                  return item
                })
              : []
            writebacks.push({ targetPath, value: rows })
            setValueByTargetPath(mergedOutput, targetPath, rows)
          }
          continue
        }

        const evaluated = evaluateSimpleExpression(String(mapping.expression || ''), parsed.value)
        if (!evaluated.ok) {
          unsupportedExpressions.push(String(mapping.expression || ''))
          continue
        }
        writebacks.push({ targetPath, value: evaluated.value })
        setValueByTargetPath(mergedOutput, targetPath, evaluated.value)
      }
      setMappingTestErrorByOwner(prev => ({ ...prev, [ownerKey]: '' }))
      setMappingTestResultByOwner(prev => ({
        ...prev,
        [ownerKey]: {
          writebacks,
          mergedOutput,
          unsupportedExpressions,
        },
      }))
    }

    return (
      <div className="space-y-2 rounded border border-blue-200 bg-blue-50/30 p-2">
        <div className="text-xs font-semibold text-blue-800">映射测试</div>
        <textarea
          className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
          placeholder="粘贴响应 JSON 后点击“测试映射”"
          value={draft}
          onChange={(event) => {
            const value = event.target.value
            setMappingTestInputByOwner(prev => ({ ...prev, [ownerKey]: value }))
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
            onClick={runTest}
          >
            测试映射
          </button>
        </div>
        {!!error && <div className="text-xs text-rose-600">{error}</div>}
        {result && (
          <div className="space-y-2">
            {result.unsupportedExpressions.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                以下表达式暂不支持本地测试（可正常保存运行）：{result.unsupportedExpressions.join('；')}
              </div>
            )}
            <div className="text-[11px] text-gray-600">写回结果预览</div>
            <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-gray-700">{stringifyPretty(result.mergedOutput)}</pre>
          </div>
        )}
      </div>
    )
  }

  const renderMappingZoomButton = (type: MappingModalType) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
      onClick={() => setMappingModalType(type)}
      title="放大编辑映射关系"
      aria-label="放大编辑映射关系"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M3.5 2.75A.75.75 0 0 1 4.25 2h4a.75.75 0 0 1 0 1.5H6.06l3.22 3.22a.75.75 0 0 1-1.06 1.06L5 4.56v2.19a.75.75 0 0 1-1.5 0v-4Zm13 0A.75.75 0 0 0 15.75 2h-4a.75.75 0 0 0 0 1.5h2.19l-3.22 3.22a.75.75 0 0 0 1.06 1.06L15 4.56v2.19a.75.75 0 0 0 1.5 0v-4Zm-13 14.5A.75.75 0 0 0 4.25 18h4a.75.75 0 0 0 0-1.5H6.06l3.22-3.22a.75.75 0 0 0-1.06-1.06L5 15.44v-2.19a.75.75 0 0 0-1.5 0v4Zm13 0a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1 0-1.5h2.19l-3.22-3.22a.75.75 0 0 1 1.06-1.06L15 15.44v-2.19a.75.75 0 0 1 1.5 0v4Z" />
      </svg>
      放大
    </button>
  )

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
      <div className="space-y-2">
        <VariableValueInput
          label="提示词"
          value={config.prompt ?? ''}
          onChange={nextValue => updateBase({ config: { ...config, prompt: nextValue } })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.input.prompt`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.input.prompt`, scope)}
          allowMultiline
          rows={4}
          placeholder="请输入提示词（可插入参数）"
        />
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
      </div>
    )
  }

  const renderLLMConfig = () => {
    const config = ensureNodeConfig(BlockEnum.LLM, activeNode.data.config) as LLMNodeConfig
    const updateConfig = (nextConfig: LLMNodeConfig) => updateBase({ config: nextConfig })
    const responseJsonDraft = llmResponseJsonByNode[activeNode.id] ?? ''
    const responseJsonError = llmResponseJsonErrorByNode[activeNode.id] ?? ''
    const applyResponseJson = () => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok) {
        setLlmResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: parsed.error }))
        return
      }
      setLlmResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: '' }))
      const paths = extractPathsFromJson(parsed.value)
      const normalized = paths.map(path => ({
        expression: path,
        targetPath: '',
      }))
      updateConfig({ ...config, writebackMappings: normalized })
    }
    const responseJsonPaths = (() => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok)
        return [] as string[]
      return extractPathsFromJson(parsed.value)
    })()
    const suggestedSourcePaths = [...new Set([
      '$',
      ...responseJsonPaths,
    ])]
    const sourcePathCascaderOptions = buildSourcePathCascaderOptions(suggestedSourcePaths)
    const renderWritebackMappings = (showZoomButton: boolean) => (
      <div className="space-y-2">
        {renderArrayMappingBuilder('llm', config.writebackMappings, next => updateConfig({ ...config, writebackMappings: next }), suggestedSourcePaths)}
        {config.writebackMappings.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
            仅 JSON 输出支持映射；可先粘贴 JSON 后点击“按 JSON 生成映射”。
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-gray-400">
            映射源以 LLM JSON 输出根对象为基准（如 a.b、data.list[]）。
          </div>
          {showZoomButton && renderMappingZoomButton('llm')}
        </div>
        {config.writebackMappings.map((mapping, index) => (
          <div key={`llm-writeback-${index}`} className="grid grid-cols-12 gap-2">
            <div className="col-span-12 md:col-span-5 min-w-0 space-y-1">
              <Cascader
                className={mappingCascaderClass}
                options={sourcePathCascaderOptions}
                placeholder="选择 JSONata 表达式"
                value={buildSourcePathCascaderValue(getWritebackExpression(mapping))}
                allowClear
                changeOnSelect
                showSearch
                onChange={(value) => {
                  const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                  if (selected === getWritebackExpression(mapping))
                    return
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression: selected }
                  updateConfig({ ...config, writebackMappings: next })
                  if (selected) {
                    setArrayDraft('llm', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
              />
              <input
                className={`${inputClass} font-mono text-xs`}
                placeholder="手动输入 JSONata 表达式"
                value={getWritebackExpression(mapping)}
                onChange={(event) => {
                  const expression = event.target.value
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression }
                  updateConfig({ ...config, writebackMappings: next })
                  if (String(expression || '').trim()) {
                    const selected = String(expression || '').trim()
                    setArrayDraft('llm', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
              />
            </div>
            <Cascader
              className={`col-span-12 md:col-span-5 ${mappingCascaderClass}`}
              options={mappingTargetCascaderOptions}
              placeholder="选择全局/流程参数"
              value={buildMappingCascaderValue(mapping.targetPath || '', mappingTargetCascaderOptions)}
              allowClear
              changeOnSelect
              showSearch
              onChange={(value) => {
                const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                if (selected === (mapping.targetPath || ''))
                  return
                const next = [...config.writebackMappings]
                next[index] = { ...mapping, mode: selected ? 'value' : mapping.mode, targetPath: selected }
                updateConfig({ ...config, writebackMappings: next })
              }}
            />
            <button
              type="button"
              aria-label="删除映射"
              title="删除映射"
              className="col-span-12 md:col-span-2 md:min-w-[44px] md:shrink-0 inline-flex items-center justify-center rounded bg-red-50 px-2 py-1 text-red-600"
              onClick={() => updateConfig({
                ...config,
                writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
              })}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M8.75 2.5a1.25 1.25 0 0 0-1.25 1.25V5H5a.75.75 0 0 0 0 1.5h.5v8.25A2.25 2.25 0 0 0 7.75 17h4.5a2.25 2.25 0 0 0 2.25-2.25V6.5H15a.75.75 0 0 0 0-1.5h-2.5V3.75A1.25 1.25 0 0 0 11.25 2.5h-2.5ZM11 5V4h-2v1h2Zm-3 1.5a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6A.75.75 0 0 1 8 6.5Zm4 .75a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0v-6Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
        {!showZoomButton && renderMappingTester('llm', config.writebackMappings)}
      </div>
    )
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">LLM 配置</div>
        <label className={labelClass}>模型</label>
        <Select className={antSelectClass} value={config.model} options={llmModelSelectOptions.map(item => ({ value: item.name, label: item.label || item.name }))} onChange={value => updateConfig({ ...config, model: value })} />
        <label className={labelClass}>温度</label>
        <input className={inputClass} type="number" step="0.1" min="0" max="2" value={config.temperature} onChange={event => updateConfig({ ...config, temperature: Number(event.target.value || 0) })} />
        <label className={labelClass}>最大 Token</label>
        <input className={inputClass} type="number" min="1" value={config.maxTokens} onChange={event => updateConfig({ ...config, maxTokens: Number(event.target.value || 1) })} />
        <label className={labelClass}>重试次数</label>
        <input className={inputClass} type="number" min="0" step="1" value={config.retryCount ?? 0} onChange={event => updateConfig({ ...config, retryCount: normalizeRetryCountInput(event.target.value) })} />
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
        <label className={labelClass}>输出结果类型</label>
        <Select
          className={antSelectClass}
          value={config.outputType}
          options={[{ value: 'string', label: 'string' }, { value: 'json', label: 'json' }]}
          onChange={(value) => updateConfig({
            ...config,
            outputType: value === 'json' ? 'json' : 'string',
          })}
        />
        <label className={labelClass}>输出变量名</label>
        <input
          className={inputClass}
          value={config.outputVar}
          placeholder="result"
          onChange={event => updateConfig({ ...config, outputVar: event.target.value })}
        />
        <div className="text-[11px] text-gray-500">
          兼容旧流程：始终保留 <code>text</code> 别名，可继续使用 <code>{`{{${activeNode.id}.text}}`}</code>。
        </div>
        {config.outputType === 'json' && (
          <div className="space-y-2 rounded border border-gray-200 p-2">
            <div className="text-xs font-semibold text-gray-700">JSON 输出映射</div>
            <label className={labelClass}>LLM 输出 JSON（导入，可选）</label>
            <textarea
              className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
              placeholder='{"data":{"id":1}}'
              value={responseJsonDraft}
              onChange={(event) => {
                setLlmResponseJsonByNode(prev => ({ ...prev, [activeNode.id]: event.target.value }))
              }}
            />
            {!!responseJsonError && <div className="text-xs text-rose-600">JSON 错误：{responseJsonError}</div>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                onClick={applyResponseJson}
              >
                按 JSON 生成映射
              </button>
            </div>
            {renderWritebackMappings(true)}
          </div>
        )}
        <Modal
          open={mappingModalType === 'llm'}
          onCancel={() => setMappingModalType(null)}
          footer={null}
          title="映射关系（LLM 节点）"
          width="80vw"
          style={{ maxWidth: 1400 }}
        >
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {renderWritebackMappings(false)}
          </div>
        </Modal>
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
            <Select
              className={antSelectClass}
              value={condition.operator}
              options={[
                { value: 'contains', label: '包含' },
                { value: 'not_contains', label: '不包含' },
                { value: 'eq', label: '等于' },
                { value: 'neq', label: '不等于' },
                { value: 'gt', label: '大于' },
                { value: 'lt', label: '小于' },
                { value: 'empty', label: '为空' },
                { value: 'not_empty', label: '不为空' },
              ]}
              onChange={(value) => {
                const next = [...config.conditions]
                next[index] = { ...condition, operator: value as IfElseNodeConfig['conditions'][number]['operator'] }
                updateConfig({ ...config, conditions: next })
              }}
            />
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
    const responseJsonDraft = codeResponseJsonByNode[activeNode.id] ?? ''
    const responseJsonError = codeResponseJsonErrorByNode[activeNode.id] ?? ''
    const applyResponseJson = () => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok) {
        setCodeResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: parsed.error }))
        return
      }
      setCodeResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: '' }))

      const paths = extractPathsFromJson(parsed.value)
      const normalized = paths.map(path => ({
        expression: path,
        targetPath: '',
      }))
      updateConfig({ ...config, writebackMappings: normalized })
    }

    const responseJsonPaths = (() => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok)
        return [] as string[]
      return extractPathsFromJson(parsed.value)
    })()
    const suggestedSourcePaths = [...new Set([
      '$',
      ...responseJsonPaths,
    ])]
    const sourcePathCascaderOptions = buildSourcePathCascaderOptions(suggestedSourcePaths)
    const renderWritebackMappings = (showZoomButton: boolean) => (
      <div className="space-y-2">
        {renderArrayMappingBuilder('code', config.writebackMappings, next => updateConfig({ ...config, writebackMappings: next }), suggestedSourcePaths)}
        {config.writebackMappings.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
            可粘贴输出 JSON 后点击“按 JSON 生成映射”，或直接手工配置映射。
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
      
          {showZoomButton && renderMappingZoomButton('code')}
        </div>
        {config.writebackMappings.map((mapping, index) => (
          <div key={`code-writeback-${index}`} className="grid grid-cols-12 gap-2">
            <div className="col-span-12 md:col-span-5 min-w-0 space-y-1">
              <Cascader
                className={mappingCascaderClass}
                options={sourcePathCascaderOptions}
                placeholder="选择 JSONata 表达式"
                value={buildSourcePathCascaderValue(getWritebackExpression(mapping))}
                allowClear
                changeOnSelect
                showSearch
                onChange={(value) => {
                  const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                  if (selected === getWritebackExpression(mapping))
                    return
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression: selected }
                  updateConfig({ ...config, writebackMappings: next })
                  if (selected) {
                    setArrayDraft('code', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
              />
              <input
                className={`${inputClass} font-mono text-xs`}
                placeholder="手动输入 JSONata 表达式"
                value={getWritebackExpression(mapping)}
                onChange={(event) => {
                  const expression = event.target.value
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression }
                  updateConfig({ ...config, writebackMappings: next })
                  if (String(expression || '').trim()) {
                    const selected = String(expression || '').trim()
                    setArrayDraft('code', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
              />
            </div>
            <Cascader
              className={`col-span-12 md:col-span-5 ${mappingCascaderClass}`}
              options={mappingTargetCascaderOptions}
              placeholder="选择全局/流程参数"
              value={buildMappingCascaderValue(mapping.targetPath || '', mappingTargetCascaderOptions)}
              allowClear
              changeOnSelect
              showSearch
              onChange={(value) => {
                const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                if (selected === (mapping.targetPath || ''))
                  return
                const next = [...config.writebackMappings]
                next[index] = { ...mapping, mode: selected ? 'value' : mapping.mode, targetPath: selected }
                updateConfig({ ...config, writebackMappings: next })
              }}
            />
            <button
              type="button"
              aria-label="删除映射"
              title="删除映射"
              className="col-span-12 md:col-span-2 md:min-w-[44px] md:shrink-0 inline-flex items-center justify-center rounded bg-red-50 px-2 py-1 text-red-600"
              onClick={() => updateConfig({
                ...config,
                writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
              })}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M8.75 2.5a1.25 1.25 0 0 0-1.25 1.25V5H5a.75.75 0 0 0 0 1.5h.5v8.25A2.25 2.25 0 0 0 7.75 17h4.5a2.25 2.25 0 0 0 2.25-2.25V6.5H15a.75.75 0 0 0 0-1.5h-2.5V3.75A1.25 1.25 0 0 0 11.25 2.5h-2.5ZM11 5V4h-2v1h2Zm-3 1.5a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6A.75.75 0 0 1 8 6.5Zm4 .75a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0v-6Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
        {!showZoomButton && renderMappingTester('code', config.writebackMappings)}
      </div>
    )

    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">代码节点</div>
        <label className={labelClass}>语言</label>
        <Select
          className={antSelectClass}
          value={config.language}
          options={[{ value: 'javascript', label: 'JavaScript' }, { value: 'python3', label: 'Python3' }]}
          onChange={value => updateConfig({ ...config, language: value as CodeNodeConfig['language'] })}
        />
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
          <label className={labelClass}>输出 JSON（导入，可选）</label>
          <textarea
            className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            placeholder='{"result":{"id":1,"name":"xx"}}'
            value={responseJsonDraft}
            onChange={(event) => {
              setCodeResponseJsonByNode(prev => ({ ...prev, [activeNode.id]: event.target.value }))
            }}
          />
          {!!responseJsonError && <div className="text-xs text-rose-600">JSON 错误：{responseJsonError}</div>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={applyResponseJson}
            >
              按 JSON 生成映射
            </button>
          </div>
          {renderWritebackMappings(true)}
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
        <Modal
          open={mappingModalType === 'code'}
          onCancel={() => setMappingModalType(null)}
          footer={null}
          title="映射关系（代码节点）"
          width="80vw"
          style={{ maxWidth: 1400 }}
        >
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {renderWritebackMappings(false)}
          </div>
        </Modal>
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
        <Select
          className={antSelectClass}
          value={config.errorHandleMode}
          options={[
            { value: 'terminated', label: '终止执行' },
            { value: 'continue-on-error', label: '遇错继续' },
            { value: 'remove-abnormal-output', label: '移除异常输出' },
          ]}
          onChange={value => updateConfig({ ...config, errorHandleMode: value as IterationNodeConfig['errorHandleMode'] })}
        />
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
    const applyResponseJson = () => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok) {
        setHttpResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: parsed.error }))
        return
      }
      setHttpResponseJsonErrorByNode(prev => ({ ...prev, [activeNode.id]: '' }))

      const paths = extractPathsFromJson(parsed.value)
      const normalized = paths.map(path => ({
        expression: path,
        targetPath: '',
      }))
      updateConfig({ ...config, writebackMappings: normalized })
    }

    const responseJsonPaths = (() => {
      const parsed = parseJsonAny(responseJsonDraft)
      if (!parsed.ok)
        return [] as string[]
      return extractPathsFromJson(parsed.value)
    })()
    const suggestedSourcePaths = [...new Set([
      '$',
      'status',
      'ok',
      'body',
      'raw',
      ...responseJsonPaths,
    ])]
    const sourcePathCascaderOptions = buildSourcePathCascaderOptions(suggestedSourcePaths)
    const renderWritebackMappings = (showZoomButton: boolean) => (
      <div className="space-y-2">
        {renderArrayMappingBuilder('http', config.writebackMappings, next => updateConfig({ ...config, writebackMappings: next }), suggestedSourcePaths)}
        {config.writebackMappings.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
            可粘贴响应 JSON 后点击“按 JSON 生成映射”，或直接手工配置映射。
          </div>
        )}
        <div className="flex items-center justify-between gap-2">

          {showZoomButton && renderMappingZoomButton('http')}
        </div>
        {config.writebackMappings.map((mapping, index) => (
          <div key={`http-writeback-${index}`} className="grid grid-cols-12 gap-2">
            <div className="col-span-12 md:col-span-5 min-w-0 space-y-1">
              <Cascader
                className={mappingCascaderClass}
                options={sourcePathCascaderOptions}
                    placeholder="选择 JSONata 表达式"
                    value={buildSourcePathCascaderValue(getWritebackExpression(mapping))}
                allowClear
                changeOnSelect
                showSearch
                onChange={(value) => {
                  const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                  if (selected === getWritebackExpression(mapping))
                    return
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression: selected }
                  updateConfig({ ...config, writebackMappings: next })
                  if (selected) {
                    setArrayDraft('http', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
                  />
                  <input
                    className={`${inputClass} font-mono text-xs`}
                    placeholder="手动输入 JSONata 表达式"
                    value={getWritebackExpression(mapping)}
                    onChange={(event) => {
                      const expression = event.target.value
                      const next = [...config.writebackMappings]
                      next[index] = { ...mapping, expression }
                      updateConfig({ ...config, writebackMappings: next })
                      if (String(expression || '').trim()) {
                        const selected = String(expression || '').trim()
                        setArrayDraft('http', prev => ({
                          ...prev,
                          mappingType: selected.endsWith('[]') ? 'array' : 'object',
                          sourcePath: selected,
                          pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                        }))
                      }
                    }}
                  />
            </div>
            <Cascader
              className={`col-span-12 md:col-span-5 ${mappingCascaderClass}`}
              options={mappingTargetCascaderOptions}
              placeholder="选择全局/流程参数"
              value={buildMappingCascaderValue(mapping.targetPath || '', mappingTargetCascaderOptions)}
              allowClear
              changeOnSelect
              showSearch
              onChange={(value) => {
                const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                if (selected === (mapping.targetPath || ''))
                  return
                const next = [...config.writebackMappings]
                next[index] = { ...mapping, mode: selected ? 'value' : mapping.mode, targetPath: selected }
                updateConfig({ ...config, writebackMappings: next })
              }}
            />
            <button
              type="button"
              aria-label="删除映射"
              title="删除映射"
              className="col-span-12 md:col-span-2 md:min-w-[44px] md:shrink-0 inline-flex items-center justify-center rounded bg-red-50 px-2 py-1 text-red-600"
              onClick={() => updateConfig({
                ...config,
                writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
              })}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M8.75 2.5a1.25 1.25 0 0 0-1.25 1.25V5H5a.75.75 0 0 0 0 1.5h.5v8.25A2.25 2.25 0 0 0 7.75 17h4.5a2.25 2.25 0 0 0 2.25-2.25V6.5H15a.75.75 0 0 0 0-1.5h-2.5V3.75A1.25 1.25 0 0 0 11.25 2.5h-2.5ZM11 5V4h-2v1h2Zm-3 1.5a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6A.75.75 0 0 1 8 6.5Zm4 .75a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0v-6Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
        {!showZoomButton && renderMappingTester('http', config.writebackMappings)}
      </div>
    )

    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">HTTP 请求</div>
        <label className={labelClass}>Method</label>
        <Select
          className={antSelectClass}
          value={config.method}
          options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(item => ({ value: item, label: item }))}
          onChange={value => updateConfig({ ...config, method: value as HttpNodeConfig['method'] })}
        />
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
        <Select
          className={antSelectClass}
          value={config.authorization.type}
          options={[
            { value: 'none', label: 'None' },
            { value: 'bearer', label: 'Bearer' },
            { value: 'api-key', label: 'API Key' },
          ]}
          onChange={value => updateConfig({
            ...config,
            authorization: { ...config.authorization, type: value as HttpNodeConfig['authorization']['type'] },
          })}
        />
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
        <Select
          className={antSelectClass}
          value={config.bodyType}
          options={[
            { value: 'none', label: 'None' },
            { value: 'json', label: 'JSON' },
            { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
            { value: 'form-data', label: 'form-data' },
            { value: 'raw', label: 'Raw Text' },
          ]}
          onChange={value => updateConfig({ ...config, bodyType: value as HttpNodeConfig['bodyType'] })}
        />
        {config.bodyType !== 'none' && (
          <VariableValueInput
            value={config.body}
            onChange={nextValue => updateConfig({ ...config, body: nextValue })}
            options={variableOptions}
            scope={getScope(`${activeNode.id}.http.body`, config.bodyType === 'json' ? 'object' : 'all')}
            onScopeChange={scope => setScope(`${activeNode.id}.http.body`, scope)}
            allowMultiline
            rows={5}
            commitOnBlur={config.bodyType === 'json'}
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
        <label className={labelClass}>重试次数</label>
        <input
          className={inputClass}
          type="number"
          min="0"
          step="1"
          value={config.retryCount ?? 0}
          onChange={event => updateConfig({ ...config, retryCount: normalizeRetryCountInput(event.target.value) })}
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">响应写入参数</div>
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
              onClick={applyResponseJson}
            >
              按 JSON 生成映射
            </button>
          </div>

          {renderWritebackMappings(true)}
        </div>
        <Modal
          open={mappingModalType === 'http'}
          onCancel={() => setMappingModalType(null)}
          footer={null}
          title="映射关系（HTTP 节点）"
          width="80vw"
          style={{ maxWidth: 1400 }}
        >
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {renderWritebackMappings(false)}
          </div>
        </Modal>
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
            <TreeSelect
              className="col-span-10 w-full"
              value={selectedInsertKey || undefined}
              placeholder="选择参数（插入到 JSON）"
              showSearch
              treeData={variableTreeOptions}
              treeDefaultExpandAll
              popupMatchSelectWidth={false}
              filterTreeNode={(input, treeNode) => String(treeNode.title || '').toLowerCase().includes(input.toLowerCase())}
              onChange={value => setApiJsonInsertKeyByNode(prev => ({
                ...prev,
                [activeNode.id]: {
                  ...(prev[activeNode.id] ?? {}),
                  [location]: String(value || ''),
                },
              }))}
            />
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
    const successExamplePaths = (() => {
      const success = (selectedRoute?.responses ?? []).find(item => item.httpStatus === config.successStatusCode)
        ?? (selectedRoute?.responses ?? []).find(item => item.httpStatus === 200)
        ?? (selectedRoute?.responses ?? [])[0]
      return extractPathsFromExample(success?.example)
    })()

    const appendMappingsFromExample = () => {
      const paths = successExampleDataPaths
      if (paths.length === 0)
        return
      const generated = paths.map(path => ({ expression: `data.${path}`, targetPath: '' }))
      updateConfig({ ...config, writebackMappings: [...config.writebackMappings, ...generated] })
    }

    const suggestedSourcePaths = [...new Set([
      'ok',
      'statusCode',
      'httpStatus',
      'message',
      'url',
      'method',
      'data',
      'response',
      ...successExamplePaths,
      ...successExampleDataPaths.map(path => `data.${path}`),
    ])]
    const sourcePathCascaderOptions = buildSourcePathCascaderOptions(suggestedSourcePaths)
    const renderWritebackMappings = (showZoomButton: boolean) => (
      <div className="space-y-2">
        {renderArrayMappingBuilder('api', config.writebackMappings, next => updateConfig({ ...config, writebackMappings: next }), suggestedSourcePaths)}
        {config.writebackMappings.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
            使用 JSONata expression 从节点输出读取（示例：data.id / body.data.id）。
          </div>
        )}
        <div className="flex items-center justify-between gap-2">

          {showZoomButton && renderMappingZoomButton('api')}
        </div>
        {config.writebackMappings.map((mapping, index) => (
          <div key={`api-writeback-${index}`} className="grid grid-cols-12 gap-2">
            <div className="col-span-12 md:col-span-5 min-w-0 space-y-1">
              <Cascader
                className={mappingCascaderClass}
                options={sourcePathCascaderOptions}
                placeholder="选择 JSONata 表达式"
                value={buildSourcePathCascaderValue(getWritebackExpression(mapping))}
                allowClear
                changeOnSelect
                showSearch
                onChange={(value) => {
                  const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                  if (selected === getWritebackExpression(mapping))
                    return
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression: selected }
                  updateConfig({ ...config, writebackMappings: next })
                  if (selected) {
                    setArrayDraft('api', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
              />
              <input
                className={`${inputClass} font-mono text-xs`}
                placeholder="手动输入 JSONata 表达式"
                value={getWritebackExpression(mapping)}
                onChange={(event) => {
                  const expression = event.target.value
                  const next = [...config.writebackMappings]
                  next[index] = { ...mapping, expression }
                  updateConfig({ ...config, writebackMappings: next })
                  if (String(expression || '').trim()) {
                    const selected = String(expression || '').trim()
                    setArrayDraft('api', prev => ({
                      ...prev,
                      mappingType: selected.endsWith('[]') ? 'array' : 'object',
                      sourcePath: selected,
                      pairs: prev.pairs.length ? prev.pairs : [{ sourceField: '', targetField: '' }],
                    }))
                  }
                }}
              />
            </div>
            <Cascader
              className={`col-span-12 md:col-span-5 ${mappingCascaderClass}`}
              options={mappingTargetCascaderOptions}
              placeholder="选择全局/流程参数"
              value={buildMappingCascaderValue(mapping.targetPath || '', mappingTargetCascaderOptions)}
              allowClear
              changeOnSelect
              showSearch
              onChange={(value) => {
                const selected = Array.isArray(value) && value.length ? String(value[value.length - 1] || '') : ''
                if (selected === (mapping.targetPath || ''))
                  return
                const next = [...config.writebackMappings]
                next[index] = { ...mapping, mode: selected ? 'value' : mapping.mode, targetPath: selected }
                updateConfig({ ...config, writebackMappings: next })
              }}
            />
            <button
              type="button"
              aria-label="删除映射"
              title="删除映射"
              className="col-span-12 md:col-span-2 md:min-w-[44px] md:shrink-0 inline-flex items-center justify-center rounded bg-red-50 px-2 py-1 text-red-600"
              onClick={() => updateConfig({
                ...config,
                writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
              })}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path fillRule="evenodd" d="M8.75 2.5a1.25 1.25 0 0 0-1.25 1.25V5H5a.75.75 0 0 0 0 1.5h.5v8.25A2.25 2.25 0 0 0 7.75 17h4.5a2.25 2.25 0 0 0 2.25-2.25V6.5H15a.75.75 0 0 0 0-1.5h-2.5V3.75A1.25 1.25 0 0 0 11.25 2.5h-2.5ZM11 5V4h-2v1h2Zm-3 1.5a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6A.75.75 0 0 1 8 6.5Zm4 .75a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0v-6Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
        {!showZoomButton && renderMappingTester('api', config.writebackMappings)}
      </div>
    )

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
            <Select
              className={antSelectClass}
              value={selectedGroup}
              placeholder="选择分组"
              options={groupOptions.map(group => ({ value: group, label: group }))}
              onChange={(nextGroup) => {
                const nextRoutes = apiRoutes.filter(route => resolveAPIGroupKey(route.path) === nextGroup)
                const next = nextRoutes[0] ?? null
                upsertRoute(next)
              }}
              disabled={apiRoutes.length === 0}
            />
          </div>
          <div className="col-span-8">
            <label className={labelClass}>路由</label>
            <Select
              className={antSelectClass}
              value={`${config.route.method} ${config.route.path}`.trim()}
              placeholder="选择路由"
              showSearch
              options={filteredRoutes.map(route => ({
                value: `${route.method} ${route.path}`,
                label: `${route.method} ${route.path}${route.summary ? ` · ${route.summary}` : ''}`,
              }))}
              onChange={(raw) => {
                const [nextMethod, ...rest] = raw.split(' ')
                const nextPath = rest.join(' ').trim()
                const matched = apiRoutes.find(route => route.method === nextMethod && route.path === nextPath) ?? null
                upsertRoute(matched)
              }}
              disabled={apiRoutes.length === 0}
            />
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
          <div className="col-span-6">
            <label className={labelClass}>重试次数</label>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="1"
              value={config.retryCount ?? 0}
              onChange={event => updateConfig({ ...config, retryCount: normalizeRetryCountInput(event.target.value) })}
            />
          </div>
        </div>

        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-700">响应写入参数</div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select
                className="max-w-full min-w-[180px]"
                size="small"
                value={undefined}
                placeholder="快捷添加表达式"
                options={suggestedSourcePaths.map(item => ({ value: item, label: item }))}
                onChange={(value) => {
                  const trimmed = String(value || '').trim()
                  if (!trimmed)
                    return
                  updateConfig({
                    ...config,
                    writebackMappings: [...config.writebackMappings, { expression: trimmed, targetPath: '' }],
                  })
                }}
              />
              <button
                type="button"
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                onClick={() => updateConfig({
                  ...config,
                  writebackMappings: [...config.writebackMappings, { expression: '', targetPath: '' }],
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
          {renderWritebackMappings(true)}
        </div>
        <Modal
          open={mappingModalType === 'api'}
          onCancel={() => setMappingModalType(null)}
          footer={null}
          title="映射关系（API 请求节点）"
          width="80vw"
          style={{ maxWidth: 1400 }}
        >
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {renderWritebackMappings(false)}
          </div>
        </Modal>
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
          <Select
            className={antSelectClass}
            value={config.templateId ? String(config.templateId) : ''}
            placeholder="不使用模板"
            options={templateOptions.map(option => ({ value: String(option.value), label: option.label }))}
            allowClear
            onChange={(value) => {
              const next = value ? Number(value) : undefined
              updateConfig({ ...config, templateId: Number.isFinite(next as number) && (next as number) > 0 ? (next as number) : undefined })
            }}
          />
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

  const renderJoinModeConfig = () => {
    if (activeNode.data.type === BlockEnum.Start)
      return null
    const rawConfig = activeNode.data.config
    const current = rawConfig && typeof rawConfig === 'object' && (rawConfig as { joinMode?: unknown }).joinMode === 'any'
      ? 'any'
      : 'all'
    return (
      <div className="space-y-1 rounded border border-gray-200 p-2">
        <div className="text-xs text-gray-600">多入边汇聚策略</div>
        <Select
          className={antSelectClass}
          value={current}
          options={[
            { value: 'all', label: '等待全部上游（all）' },
            { value: 'any', label: '任一上游到达即执行（any）' },
          ]}
          onChange={(value) => {
            const base = ensureNodeConfig(activeNode.data.type as never, activeNode.data.config as never) as Record<string, unknown>
            updateBase({
              config: {
                ...base,
                joinMode: value === 'any' ? 'any' : 'all',
              } as never,
            })
          }}
        />

      </div>
    )
  }

  const renderFanOutModeConfig = () => {
    if (activeNode.data.type === BlockEnum.End)
      return null
    const rawConfig = activeNode.data.config
    const current = rawConfig && typeof rawConfig === 'object' && (rawConfig as { fanOutMode?: unknown }).fanOutMode === 'parallel'
      ? 'parallel'
      : 'sequential'
    return (
      <div className="space-y-1 rounded border border-gray-200 p-2">
        <div className="text-xs text-gray-600">多后续执行策略</div>
        <Select
          className={antSelectClass}
          value={current}
          options={[
            { value: 'sequential', label: '顺序执行（sequential）' },
            { value: 'parallel', label: '并行执行（parallel）' },
          ]}
          onChange={(value) => {
            const base = ensureNodeConfig(activeNode.data.type as never, activeNode.data.config as never) as Record<string, unknown>
            updateBase({
              config: {
                ...base,
                fanOutMode: value === 'parallel' ? 'parallel' : 'sequential',
              } as never,
            })
          }}
        />
       
      </div>
    )
  }

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.35)]">
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
        {renderJoinModeConfig()}
        {renderFanOutModeConfig()}
        {renderNodeSpecificConfig()}
        <button type="button" onClick={onSave} className="w-full rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700">保存节点配置</button>
      </div>
    </div>
  )
}
