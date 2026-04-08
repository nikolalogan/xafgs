'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Checkbox, Collapse, Empty, Form, Input, InputNumber, Modal, Select, Tabs, message } from 'antd'
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
import 'reactflow/dist/style.css'
import { CUSTOM_EDGE, CUSTOM_NODE } from '../core/constants'
import { ensureNodeConfig } from '../core/node-config'
import { edgeTypes, nodeTypes } from '../config/workflowPreset'
import { validateWorkflow } from '../core/validation'
import { BlockEnum, NodeRunningStatus, type DifyEdge, type DifyNode, type IterationNodeConfig, type WorkflowGlobalVariable, type WorkflowParameter } from '../core/types'

type RuntimeNodeStatus = 'pending' | 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'skipped'

type ExecutionNodeState = {
  nodeId: string
  status: RuntimeNodeStatus
  startedAt?: string
  endedAt?: string
  error?: string
}

type ExecutionWaitingInput = {
  nodeId: string
  nodeTitle: string
  schema: Record<string, unknown>
}

type WorkflowExecution = {
  id: string
  status: 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'
  nodeStates: Record<string, ExecutionNodeState>
  variables: Record<string, unknown>
  events?: Array<{
    id: string
    type: string
    at: string
    payload?: Record<string, unknown>
  }>
  waitingInput?: ExecutionWaitingInput
  error?: string
  updatedAt: string
}

type DynamicField = {
  name: string
  label: string
  type: 'text' | 'paragraph' | 'number' | 'select' | 'checkbox'
  required: boolean
  options: Array<{ label: string; value: string }>
  defaultValue?: unknown
}

type WorkflowRunPageProps = {
  workflowId?: number
  nodes: DifyNode[]
  edges: DifyEdge[]
  globalVariables?: WorkflowGlobalVariable[]
  workflowParameters?: WorkflowParameter[]
  autoRun?: boolean
}

type TemplateDetailDTO = {
  id: number
  name: string
  templateKey: string
  outputType: 'text' | 'html'
  content: string
  defaultContextJson: Record<string, unknown>
}

type TemplatePreviewResponse = {
  rendered: string
}

type UserConfigDTO = {
  warningAccount: string
  warningPassword: string
  aiBaseUrl: string
  aiApiKey: string
}

const ITERATION_CHILD_NODE_PREFIX = 'iter-child::'
const ITERATION_CHILD_EDGE_PREFIX = 'iter-edge::'
const ITERATION_CONTAINER_MIN_WIDTH = 760
const ITERATION_CONTAINER_MIN_HEIGHT = 420
const ITERATION_CONTAINER_PADDING_X = 24
const ITERATION_CONTAINER_PADDING_Y = 56
const ITERATION_CHILD_NODE_ESTIMATED_WIDTH = 240
const ITERATION_CHILD_NODE_ESTIMATED_HEIGHT = 130

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const clonePlainValue = <T,>(value: T): T => {
  if (value === undefined)
    return value
  try {
    if (typeof structuredClone === 'function')
      return structuredClone(value)
  }
  catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
  return JSON.parse(JSON.stringify(value)) as T
}
const buildChildNodeId = (parentId: string, childId: string) => `${ITERATION_CHILD_NODE_PREFIX}${parentId}::${childId}`
const buildChildEdgeId = (parentId: string, childEdgeId: string) => `${ITERATION_CHILD_EDGE_PREFIX}${parentId}::${childEdgeId}`
const cloneNodeForPreview = (node: DifyNode): DifyNode => ({
  ...node,
  position: { ...node.position },
  style: node.style ? { ...node.style } : undefined,
  data: {
    ...node.data,
    config: node.data.config ? clonePlainValue(node.data.config) : node.data.config,
  },
})
const cloneEdgeForPreview = (edge: DifyEdge): DifyEdge => ({
  ...edge,
  type: CUSTOM_EDGE,
  data: edge.data ? clonePlainValue(edge.data) : edge.data,
})
const buildIterationContainerLayout = (children: IterationNodeConfig['children']['nodes']) => {
  const maxX = children.reduce((acc, item) => Math.max(acc, item.position.x), 0)
  const maxY = children.reduce((acc, item) => Math.max(acc, item.position.y), 0)
  return {
    width: Math.max(ITERATION_CONTAINER_MIN_WIDTH, maxX + ITERATION_CONTAINER_PADDING_X * 2 + ITERATION_CHILD_NODE_ESTIMATED_WIDTH),
    height: Math.max(ITERATION_CONTAINER_MIN_HEIGHT, maxY + ITERATION_CONTAINER_PADDING_Y + ITERATION_CHILD_NODE_ESTIMATED_HEIGHT),
    paddingX: ITERATION_CONTAINER_PADDING_X,
    paddingY: ITERATION_CONTAINER_PADDING_Y,
  }
}

const statusTextMap: Record<RuntimeNodeStatus, string> = {
  pending: '未执行',
  running: '执行中',
  waiting_input: '等待输入',
  succeeded: '成功',
  failed: '失败',
  skipped: '跳过',
}

const statusClassMap: Record<RuntimeNodeStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-700',
  waiting_input: 'bg-blue-100 text-blue-700',
  succeeded: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  skipped: 'bg-slate-100 text-slate-700',
}

const getNodePreviewStyle = (status: RuntimeNodeStatus | undefined) => {
  if (status === 'succeeded')
    return { border: '1.5px solid #10b981', background: '#ecfdf5' }
  if (status === 'failed')
    return { border: '1.5px solid #f43f5e', background: '#fff1f2' }
  if (status === 'running')
    return { border: '1.5px solid #3b82f6', background: '#eff6ff' }
  if (status === 'waiting_input')
    return { border: '1.5px solid #3b82f6', background: '#eff6ff' }
  if (status === 'skipped')
    return { border: '1.5px solid #64748b', background: '#f8fafc' }
  return { border: '1px solid #d1d5db', background: '#ffffff' }
}

const normalizeStartFields = (nodes: DifyNode[]): DynamicField[] => {
  const startNode = nodes.find(node => String(node.data.type).toLowerCase() === BlockEnum.Start)
  if (!startNode)
    return []

  const config = ensureNodeConfig(BlockEnum.Start, startNode.data.config)
  const raw = Array.isArray(config.variables) ? config.variables : []
  const normalizeOptions = (options: unknown) => {
    if (!Array.isArray(options))
      return []
    return options.map((option) => {
      if (typeof option === 'string') {
        const value = option
        return { label: value, value }
      }
      if (isObject(option)) {
        const value = typeof option.value === 'string' ? option.value : String(option.value ?? '')
        const label = typeof option.label === 'string' ? option.label : value
        return { label, value }
      }
      const value = String(option ?? '')
      return { label: value, value }
    }).filter(item => item.value)
  }
  return raw.map(item => ({
    name: item.name,
    label: item.label,
    type: item.type === 'paragraph'
      ? 'paragraph'
      : item.type === 'number'
        ? 'number'
        : item.type === 'select'
          ? 'select'
          : item.type === 'checkbox'
            ? 'checkbox'
            : 'text',
    required: Boolean(item.required),
    options: normalizeOptions(item.options),
    defaultValue: item.defaultValue,
  }) satisfies DynamicField).filter(field => field.name)
}

const normalizeWaitingFields = (schema?: Record<string, unknown>): DynamicField[] => {
  if (!schema || !Array.isArray(schema.fields))
    return []
  return schema.fields.map((item) => {
    const entry = isObject(item) ? item : {}
    const normalizeOptions = (options: unknown) => {
      if (!Array.isArray(options))
        return []
      return options.map((option) => {
        if (typeof option === 'string') {
          const value = option
          return { label: value, value }
        }
        if (isObject(option)) {
          const value = typeof option.value === 'string' ? option.value : String(option.value ?? '')
          const label = typeof option.label === 'string' ? option.label : value
          return { label, value }
        }
        const value = String(option ?? '')
        return { label: value, value }
      }).filter(item => item.value)
    }
    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      label: typeof entry.label === 'string' ? entry.label : '',
      type: entry.type === 'paragraph' ? 'paragraph' : entry.type === 'number' ? 'number' : entry.type === 'select' ? 'select' : entry.type === 'checkbox' ? 'checkbox' : 'text',
      required: Boolean(entry.required),
      options: normalizeOptions(entry.options),
      defaultValue: entry.defaultValue,
    } satisfies DynamicField
  }).filter(field => field.name)
}

const isNodeEntered = (status?: RuntimeNodeStatus) => status === 'running'
  || status === 'waiting_input'
  || status === 'succeeded'
  || status === 'failed'

const renderJson = (value: unknown) => {
  if (value === undefined)
    return '-'
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

const normalizeLogPath = (path: string) => path
  .trim()
  .replace(/^用户属性\./, 'user.')
  .replace(/^流程参数\./, 'workflow.')
  .replace(/^全局参数\./, 'global.')
  .replace(/^\$\./, '')
  .replace(/^\$/, '')
  .replace(/\[(\d+)\]/g, '.$1')

const getLogValueByPath = (source: Record<string, unknown>, path: string): unknown => {
  const keys = normalizeLogPath(path).split('.').map(item => item.trim()).filter(Boolean)
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

const renderRuntimeTemplate = (value: string, variables: Record<string, unknown>) => {
  return String(value || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, rawKey) => {
    const key = String(rawKey || '').trim()
    if (!key)
      return ''
    const resolved = getLogValueByPath(variables, key)
    if (resolved === undefined || resolved === null)
      return ''
    if (typeof resolved === 'object')
      return JSON.stringify(resolved)
    return String(resolved)
  })
}

const renderHttpConfigForLog = (
  config: Record<string, unknown>,
  variables?: Record<string, unknown>,
) => {
  const context = variables ?? {}
  const renderValue = (raw: unknown) => typeof raw === 'string' ? renderRuntimeTemplate(raw, context) : raw
  const renderPairs = (raw: unknown) => Array.isArray(raw)
    ? raw.map((item) => {
        const entry = isObject(item) ? item : {}
        return {
          ...entry,
          key: typeof entry.key === 'string' ? entry.key : '',
          value: renderValue(entry.value),
        }
      })
    : []

  const authorization = isObject(config.authorization) ? config.authorization : {}
  return {
    method: config.method,
    url: renderValue(config.url),
    query: renderPairs(config.query),
    headers: renderPairs(config.headers),
    bodyType: config.bodyType,
    body: renderValue(config.body),
    authorization: {
      ...authorization,
      apiKey: renderValue(authorization.apiKey),
    },
  }
}

const buildEndConfiguredOutput = (node: DifyNode, variables: Record<string, unknown> | undefined, fallbackNodeOutput: unknown) => {
  if (node.data.type !== BlockEnum.End)
    return fallbackNodeOutput
  const config = ensureNodeConfig(BlockEnum.End, node.data.config) as { outputs?: Array<{ name?: string; source?: string }> }
  const outputs = Array.isArray(config.outputs) ? config.outputs : []
  if (outputs.length === 0)
    return {}
  const context = variables ?? {}
  const result: Record<string, unknown> = {}
  outputs.forEach((item) => {
    const name = String(item?.name || '').trim()
    if (!name)
      return
    const source = String(item?.source || '').trim()
    if (source) {
      const resolved = getLogValueByPath(context, source)
      result[name] = resolved === undefined ? null : resolved
      return
    }
    if (isObject(fallbackNodeOutput) && name in fallbackNodeOutput) {
      result[name] = (fallbackNodeOutput as Record<string, unknown>)[name]
      return
    }
    result[name] = null
  })
  return result
}

const validateDynamicInput = (
  fields: DynamicField[],
  values: Record<string, unknown>,
) => {
  const normalized: Record<string, unknown> = {}
  for (const field of fields) {
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

const userConfigFields = [
  { key: 'warningAccount', label: '预警通账号', hash: '#warningAccount' },
  { key: 'warningPassword', label: '预警通密码', hash: '#warningPassword' },
  { key: 'aiBaseUrl', label: 'AI 服务商地址', hash: '#aiBaseUrl' },
  { key: 'aiApiKey', label: 'AI APIKey', hash: '#aiApiKey' },
] as const

type UserConfigFieldKey = typeof userConfigFields[number]['key']

const detectRequiredUserConfigKeys = (dsl: unknown): UserConfigFieldKey[] => {
  let raw = ''
  try {
    raw = JSON.stringify(dsl) || ''
  }
  catch {
    raw = ''
  }
  if (!raw)
    return []

  const required = new Set<UserConfigFieldKey>()
  userConfigFields.forEach((field) => {
    const placeholder = new RegExp(`\\{\\{\\s*user\\.${field.key}\\s*\\}\\}`, 'i')
    const bare = new RegExp(`["']\\s*user\\.${field.key}\\s*["']`, 'i')
    if (placeholder.test(raw) || bare.test(raw))
      required.add(field.key)
  })
  return [...required]
}

export default function WorkflowRunPage({ workflowId, nodes, edges, globalVariables = [], workflowParameters = [], autoRun = false }: WorkflowRunPageProps) {
  return <WorkflowRunPageInner workflowId={workflowId} nodes={nodes} edges={edges} globalVariables={globalVariables} workflowParameters={workflowParameters} autoRun={autoRun} />
}

function WorkflowRunPageInner({ workflowId, nodes, edges, globalVariables = [], workflowParameters = [], autoRun = false }: WorkflowRunPageProps) {
  const router = useRouter()
  const [execution, setExecution] = useState<WorkflowExecution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [previewCollapsed, setPreviewCollapsed] = useState(true)
  const [focusedNodeId, setFocusedNodeId] = useState('')
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({})
  const [visibleNodeIds, setVisibleNodeIds] = useState<string[]>([])
  const visibleNodeIdsRef = useRef<string[]>([])
  const focusedNodeIdRef = useRef('')
  const nodeCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const startFields = useMemo(() => normalizeStartFields(nodes), [nodes])
  const [startInput, setStartInput] = useState<Record<string, unknown>>({})
  const waitingFields = useMemo(() => normalizeWaitingFields(execution?.waitingInput?.schema), [execution?.waitingInput?.schema])
  const [waitingInput, setWaitingInput] = useState<Record<string, unknown>>({})
  const [autoRunTriggered, setAutoRunTriggered] = useState(false)
  const [endRendered, setEndRendered] = useState<Record<string, { html: string; outputType: 'text' | 'html'; templateName: string; executionId: string }>>({})
  const [endRenderLoading, setEndRenderLoading] = useState<Record<string, boolean>>({})
  const [endRenderError, setEndRenderError] = useState<Record<string, string>>({})
  const [endRenderedHeights, setEndRenderedHeights] = useState<Record<string, number>>({})
  const [nodeOutputExpandedById, setNodeOutputExpandedById] = useState<Record<string, boolean>>({})
  const iframeResizeObserversRef = useRef<Record<string, ResizeObserver>>({})
  const executionPollingIdRef = useRef<string>('')

  const injectNoScrollStyleForIframe = (rawHtml: string) => {
    const style = `
<style>
  /* 目标：让文档高度可随内容增长，从而通过 scrollHeight 计算出真实高度，避免截断 */
  html, body {
    margin: 0;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* 兜底：避免常见的“固定高度/滚动容器”导致 scrollHeight 失真或内容被裁剪 */
  #__next, #app, #root, .app, .page, .container, .content, .main, .wrap {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }
  *[style*="height:100vh"], *[style*="height: 100vh"], *[style*="min-height:100vh"], *[style*="min-height: 100vh"] {
    height: auto !important;
    min-height: 0 !important;
  }
  *[style*="overflow:hidden"], *[style*="overflow: hidden"], *[style*="overflow:auto"], *[style*="overflow: auto"], *[style*="overflow:scroll"], *[style*="overflow: scroll"] {
    overflow: visible !important;
  }
  *[style*="max-height"], *[style*="max-height:"] {
    max-height: none !important;
  }
</style>
`
    if (/<\/head>/i.test(rawHtml))
      return rawHtml.replace(/<\/head>/i, `${style}</head>`)
    if (/<html[\s>]/i.test(rawHtml))
      return rawHtml.replace(/<html[\s>]/i, match => `${match}\n<head>${style}</head>`)
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>${style}</head><body>${rawHtml}</body></html>`
  }

  useEffect(() => {
    visibleNodeIdsRef.current = visibleNodeIds
  }, [visibleNodeIds])

  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId
  }, [focusedNodeId])

  useEffect(() => {
    if (!focusedNodeId)
      return
    if (typeof window === 'undefined')
      return
    const element = nodeCardRefs.current[focusedNodeId]
    if (!element)
      return
    window.requestAnimationFrame(() => {
      try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      catch {
      }
    })
  }, [focusedNodeId])

  useEffect(() => {
    const cached = typeof window !== 'undefined'
      ? (window.localStorage.getItem('sxfg_access_token')
          || window.localStorage.getItem('access_token')
          || window.localStorage.getItem('token')
          || '')
      : ''
    if (cached)
      setAuthToken(cached)
  }, [])

  useEffect(() => {
    const nextInput: Record<string, unknown> = {}
    startFields.forEach((field) => {
      nextInput[field.name] = field.defaultValue ?? (field.type === 'checkbox' ? false : '')
    })
    setStartInput(nextInput)
  }, [startFields])

  useEffect(() => {
    const nextInput: Record<string, unknown> = {}
    waitingFields.forEach((field) => {
      nextInput[field.name] = field.defaultValue ?? (field.type === 'checkbox' ? false : '')
    })
    setWaitingInput(nextInput)
  }, [waitingFields])

  useEffect(() => {
    setEndRendered({})
    setEndRenderLoading({})
    setEndRenderError({})
    setEndRenderedHeights({})
    setAutoRunTriggered(false)
  }, [nodes, edges])

  useEffect(() => {
    return () => {
      Object.values(iframeResizeObserversRef.current).forEach((observer) => {
        try {
          observer.disconnect()
        }
        catch {
        }
      })
      iframeResizeObserversRef.current = {}
    }
  }, [])

  const nodeMap = useMemo(() => {
    return new Map(nodes.map(node => [node.id, node]))
  }, [nodes])

  const orderedNodeIds = useMemo(() => nodes.map(node => node.id), [nodes])

  const enteredNodeIds = useMemo(() => {
    if (!execution)
      return []
    const entered = new Set<string>()
    Object.entries(execution.nodeStates ?? {}).forEach(([nodeId, state]) => {
      if (!state)
        return
      if (isNodeEntered(state.status))
        entered.add(nodeId)
    })
    return orderedNodeIds.filter(nodeId => entered.has(nodeId))
  }, [execution, orderedNodeIds])

  useEffect(() => {
    if (!execution)
      return
    if (typeof window === 'undefined')
      return

    visibleNodeIds.forEach((nodeId) => {
      const node = nodeMap.get(nodeId)
      if (!node || node.data.type !== BlockEnum.End)
        return
      const state = execution.nodeStates?.[nodeId]
      if (!state)
        return
      if (state.status !== 'succeeded' && execution.status !== 'completed')
        return
      const rawOutput = execution.variables?.[nodeId]
      const output = buildEndConfiguredOutput(node, execution.variables, rawOutput)
      void renderEndTemplateIfNeeded(node, output)
    })
  }, [execution, nodeMap, visibleNodeIds])

  const executedNodeSequence = useMemo(() => {
    if (!execution)
      return []
    const events = Array.isArray(execution.events) ? execution.events : []
    const sorted = [...events].sort((a, b) => {
      const at = a?.at ? new Date(a.at).getTime() : Number.MAX_SAFE_INTEGER
      const bt = b?.at ? new Date(b.at).getTime() : Number.MAX_SAFE_INTEGER
      return at - bt
    })
    const sequence: string[] = []
    const seen = new Set<string>()
    sorted.forEach((event) => {
      if (!event || typeof event.type !== 'string')
        return
      if (!event.type.startsWith('node.'))
        return
      if (event.type === 'node.skipped')
        return
      const nodeId = typeof event.payload?.nodeId === 'string' ? event.payload.nodeId : ''
      if (!nodeId)
        return
      const status = execution.nodeStates?.[nodeId]?.status
      if (status === 'skipped')
        return
      if (seen.has(nodeId))
        return
      seen.add(nodeId)
      sequence.push(nodeId)
    })
    enteredNodeIds.forEach((nodeId) => {
      if (seen.has(nodeId))
        return
      seen.add(nodeId)
      sequence.push(nodeId)
    })
    return sequence
  }, [enteredNodeIds, execution])

  useEffect(() => {
    if (!execution) {
      setVisibleNodeIds([])
      setFocusedNodeId('')
      setOpenPanels({})
      return
    }

    const existing = new Set(visibleNodeIdsRef.current)
    const pending = executedNodeSequence.filter(nodeId => !existing.has(nodeId))
    if (pending.length === 0)
      return

    const stepMs = pending.length <= 12 ? 180 : 80
    let cursor = 0
    const timer = window.setInterval(() => {
      const nodeId = pending[cursor]
      if (!nodeId) {
        window.clearInterval(timer)
        return
      }
      setVisibleNodeIds(prev => (prev.includes(nodeId) ? prev : [...prev, nodeId]))
      setFocusedNodeId(nodeId)
      setOpenPanels((prev) => {
        const next = { ...prev }
        const prevFocused = focusedNodeIdRef.current
        if (prevFocused)
          next[prevFocused] = false
        next[nodeId] = true
        return next
      })
      cursor += 1
      if (cursor >= pending.length)
        window.clearInterval(timer)
    }, stepMs)

    return () => window.clearInterval(timer)
  }, [executedNodeSequence, execution?.id, execution?.updatedAt])

  useEffect(() => {
    if (!execution?.id || execution.status !== 'running') {
      executionPollingIdRef.current = ''
      return
    }
    executionPollingIdRef.current = execution.id
    let cancelled = false
    const currentExecutionId = execution.id
    const token = resolveAuthToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token)
      headers.Authorization = `Bearer ${token}`

    const syncExecution = async () => {
      if (cancelled)
        return
      try {
        const response = await fetch(`/api/workflow/executions/${currentExecutionId}`, {
          method: 'GET',
          credentials: 'include',
          headers,
        })
        if (response.status === 401) {
          router.push('/?redirect=/app/workflow')
          return
        }
        const payload = await response.json() as { data?: WorkflowExecution }
        if (!response.ok || !payload.data)
          return
        if (cancelled || executionPollingIdRef.current !== currentExecutionId)
          return
        setExecution(payload.data)
      }
      catch {
      }
    }

    void syncExecution()
    const timer = window.setInterval(() => {
      void syncExecution()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [execution?.id, execution?.status, router])

  const runtimeDsl = useMemo(() => {
    return {
      nodes: nodes.map(node => ({
        id: node.id,
        type: CUSTOM_NODE,
        position: node.position,
        data: {
          title: node.data.title,
          desc: node.data.desc,
          type: node.data.type,
          config: node.data.config,
        },
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: CUSTOM_EDGE,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
      globalVariables,
      workflowParameters,
      viewport: { x: 0, y: 0, zoom: 1 },
    }
  }, [edges, globalVariables, nodes, workflowParameters])

  const renderPreviewGraph = useMemo(() => {
    const mergedNodes: DifyNode[] = []
    const mergedEdges: DifyEdge[] = edges.map(cloneEdgeForPreview)

    nodes.forEach((node) => {
      if (node.data.type !== BlockEnum.Iteration) {
        mergedNodes.push(cloneNodeForPreview(node))
        return
      }

      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      const layout = buildIterationContainerLayout(config.children.nodes)

      mergedNodes.push({
        ...cloneNodeForPreview(node),
        style: {
          ...(node.style ?? {}),
          width: layout.width,
          height: layout.height,
        },
        data: {
          ...node.data,
          _iterationRole: 'container',
        },
      })

      config.children.nodes.forEach((childNode) => {
        mergedNodes.push({
          id: buildChildNodeId(node.id, childNode.id),
          type: CUSTOM_NODE,
          parentNode: node.id,
          extent: 'parent',
          position: {
            x: layout.paddingX + childNode.position.x,
            y: layout.paddingY + childNode.position.y,
          },
          data: {
            ...childNode.data,
            title: childNode.data.title || `${childNode.data.type}-${childNode.id}`,
            config: childNode.data.config ?? ensureNodeConfig(childNode.data.type, undefined),
            _iterationRole: 'child',
            _iterationParentId: node.id,
            _iterationChildId: childNode.id,
          },
          draggable: false,
          selectable: false,
        } as DifyNode)
      })

      config.children.edges.forEach((edge) => {
        mergedEdges.push({
          id: buildChildEdgeId(node.id, edge.id),
          source: buildChildNodeId(node.id, edge.source),
          target: buildChildNodeId(node.id, edge.target),
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: CUSTOM_EDGE,
          data: {
            _iterationParentId: node.id,
          },
        })
      })
    })

    return {
      nodes: mergedNodes,
      edges: mergedEdges,
    }
  }, [edges, nodes])

  const previewNodes = useMemo(() => {
    return renderPreviewGraph.nodes.map((node) => {
      const status = execution?.nodeStates?.[node.id]?.status
      return {
        ...node,
        style: {
          ...(node.style ?? {}),
          ...getNodePreviewStyle(status),
        },
      }
    })
  }, [execution?.nodeStates, renderPreviewGraph.nodes])

  const previewEdges = useMemo(() => {
    const nodeStates = execution?.nodeStates ?? {}
    const nodeMap = new Map(renderPreviewGraph.nodes.map(node => [node.id, node]))
    const outgoingEdgesMap = new Map<string, DifyEdge[]>()
    renderPreviewGraph.edges.forEach((edge) => {
      outgoingEdgesMap.set(edge.source, [...(outgoingEdgesMap.get(edge.source) ?? []), edge])
    })
    const branchHandleByNode = new Map<string, string>()
    ;(execution?.events ?? []).forEach((event) => {
      if (event.type !== 'node.branch' || !event.payload)
        return
      const nodeId = typeof event.payload.nodeId === 'string' ? event.payload.nodeId : ''
      const handleId = typeof event.payload.handleId === 'string' ? event.payload.handleId : ''
      if (!nodeId || !handleId)
        return
      branchHandleByNode.set(nodeId, handleId)
    })
    const mapNodeStatus = (nodeId: string) => {
      const status = nodeStates[nodeId]?.status
      if (status === 'succeeded')
        return NodeRunningStatus.Succeeded
      if (status === 'failed')
        return NodeRunningStatus.Failed
      if (status === 'running' || status === 'waiting_input')
        return NodeRunningStatus.Running
      return NodeRunningStatus.Idle
    }
    const isTraversedEdge = (edge: DifyEdge) => {
      const sourceStatus = nodeStates[edge.source]?.status
      const targetStatus = nodeStates[edge.target]?.status
      if (!isNodeEntered(sourceStatus) || !isNodeEntered(targetStatus))
        return false

      const sourceNodeType = nodeMap.get(edge.source)?.data.type
      if (sourceNodeType !== BlockEnum.IfElse)
        return true

      const outgoingEdges = outgoingEdgesMap.get(edge.source) ?? []
      const chosenHandle = branchHandleByNode.get(edge.source)
      if (chosenHandle) {
        const hasHandleEdge = outgoingEdges.some(item => item.sourceHandle)
        if (hasHandleEdge)
          return edge.sourceHandle === chosenHandle
      }

      if (outgoingEdges.some(item => item.sourceHandle))
        return false

      const enteredOutgoingEdges = outgoingEdges.filter(item => isNodeEntered(nodeStates[item.target]?.status))
      if (enteredOutgoingEdges.length > 0)
        return enteredOutgoingEdges.some(item => item.id === edge.id)

      return outgoingEdges[0]?.id === edge.id
    }
    return renderPreviewGraph.edges.map(edge => ({
      ...edge,
      type: CUSTOM_EDGE,
      data: {
        ...(edge.data ?? {}),
        _forceStroke: (() => {
          if (!execution)
            return '#98A2B3'
          if (!isTraversedEdge(edge))
            return '#98A2B3'
          const targetStatus = nodeStates[edge.target]?.status
          if (targetStatus === 'failed')
            return '#F04438'
          const sourceStatus = nodeStates[edge.source]?.status
          if (sourceStatus === 'running' || sourceStatus === 'waiting_input' || targetStatus === 'running' || targetStatus === 'waiting_input')
            return '#2970FF'
          return '#12B76A'
        })(),
        _sourceRunningStatus: (() => {
          return isTraversedEdge(edge) ? mapNodeStatus(edge.source) : NodeRunningStatus.Idle
        })(),
        _targetRunningStatus: (() => {
          return isTraversedEdge(edge) ? mapNodeStatus(edge.target) : NodeRunningStatus.Idle
        })(),
      },
    }))
  }, [execution?.events, execution?.nodeStates, renderPreviewGraph.edges, renderPreviewGraph.nodes])

  const previewGraph = useMemo(() => ({
    nodes: clonePlainValue(previewNodes),
    edges: clonePlainValue(previewEdges),
  }), [previewEdges, previewNodes])

  const validateBeforeRun = () => {
    const issues = validateWorkflow(nodes, edges, workflowParameters)
    const errors = issues.filter(item => item.level === 'error')
    if (errors.length === 0)
      return true
    const head = errors.slice(0, 4).map(item => `- ${item.title}：${item.message}`).join('\n')
    setError(`错误检查未通过（${errors.length}项）：\n${head}`)
    return false
  }

  const hasMissingRequiredStartInput = useMemo(() => {
    if (!startFields.length)
      return false
    return startFields.some((field) => {
      if (!field.required)
        return false
      const value = startInput[field.name]
      if (field.type === 'checkbox')
        return value === undefined || value === null
      return String(value ?? '').trim() === ''
    })
  }, [startFields, startInput])

  const resolveAuthToken = () => {
    const current = authToken.trim()
    if (current)
      return current
    if (typeof window === 'undefined')
      return ''
    return (window.localStorage.getItem('sxfg_access_token')
      || window.localStorage.getItem('access_token')
      || window.localStorage.getItem('token')
      || '').trim()
  }

  const renderEndTemplateIfNeeded = async (node: DifyNode, output: unknown) => {
    if (!execution)
      return
    if (node.data.type !== BlockEnum.End)
      return
    const endConfig = ensureNodeConfig(BlockEnum.End, node.data.config) as { templateId?: number }
    const templateId = Number(endConfig.templateId)
    if (!Number.isFinite(templateId) || templateId <= 0)
      return
    if (endRendered[node.id]?.executionId === execution.id)
      return
    if (endRenderLoading[node.id])
      return

    const token = resolveAuthToken()
    if (!token)
      return

    setEndRenderLoading(prev => ({ ...prev, [node.id]: true }))
    setEndRenderError(prev => ({ ...prev, [node.id]: '' }))
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      }

      const detailResponse = await fetch(`/api/templates/${templateId}`, {
        method: 'GET',
        headers,
        credentials: 'include',
      })
      const detailPayload = await detailResponse.json() as { data?: TemplateDetailDTO; message?: string }
      if (detailResponse.status === 401) {
        router.push('/?redirect=/app/workflow')
        return
      }
      if (!detailResponse.ok || !detailPayload.data)
        throw new Error(detailPayload.message || '加载模板失败')

      const detail = detailPayload.data
      const runtimeContext = (() => {
        if (isObject(output))
          return output
        return { output }
      })()

      const previewResponse = await fetch('/api/templates/preview', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          content: detail.content,
          contextJson: runtimeContext,
        }),
      })
      const previewPayload = await previewResponse.json() as { data?: TemplatePreviewResponse; message?: string }
      if (!previewResponse.ok || !previewPayload.data)
        throw new Error(previewPayload.message || '渲染模板失败')

      const normalizedHtml = detail.outputType === 'text'
        ? (previewPayload.data?.rendered || '')
        : injectNoScrollStyleForIframe(previewPayload.data?.rendered || '')

      setEndRendered(prev => ({
        ...prev,
        [node.id]: {
          html: normalizedHtml,
          outputType: detail.outputType === 'text' ? 'text' : 'html',
          templateName: detail.name || detail.templateKey || String(detail.id),
          executionId: execution.id,
        },
      }))
      setEndRenderedHeights(prev => ({ ...prev, [node.id]: 0 }))
    }
    catch (requestError) {
      setEndRenderError(prev => ({ ...prev, [node.id]: requestError instanceof Error ? requestError.message : '渲染模板失败' }))
    }
    finally {
      setEndRenderLoading(prev => ({ ...prev, [node.id]: false }))
    }
  }

  const runWorkflow = async () => {
    if (!workflowId || workflowId <= 0) {
      setError('请先保存工作流后再运行')
      return
    }
    if (!validateBeforeRun())
      return
    const requiredKeys = detectRequiredUserConfigKeys(runtimeDsl)
      if (requiredKeys.length > 0) {
        const token = resolveAuthToken()
        if (!token) {
        router.push('/?redirect=/app/workflow')
        return
        }
      try {
        const response = await fetch('/api/user-config', {
          method: 'GET',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
          credentials: 'include',
        })
        const payload = await response.json() as { data?: UserConfigDTO; message?: string }
        if (response.status === 401) {
          router.push('/?redirect=/app/workflow')
          return
        }
        if (!response.ok)
          throw new Error(payload.message || '加载用户配置失败')
        const config = payload.data || { warningAccount: '', warningPassword: '', aiBaseUrl: '', aiApiKey: '' }
        const missing = requiredKeys.filter((key) => String((config as any)[key] ?? '').trim() === '')
        if (missing.length > 0) {
          const missingLabels = missing
            .map((key) => userConfigFields.find(item => item.key === key)?.label || key)
            .join('、')
          const first = missing[0]
          const targetHash = userConfigFields.find(item => item.key === first)?.hash || ''
          Modal.confirm({
            title: '缺少用户配置',
            content: `当前流程运行需要先配置：${missingLabels}`,
            okText: '去配置',
            cancelText: '取消',
            onOk: () => {
              router.push(`/app/user-config${targetHash}`)
            },
          })
          return
        }
      }
      catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '加载用户配置失败')
        return
      }
    }
    const startValidation = validateDynamicInput(startFields, startInput)
    if (!startValidation.ok) {
      setError(startValidation.message)
      return
    }
    setLoading(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      const token = resolveAuthToken()
      if (token)
        headers.Authorization = `Bearer ${token}`
      const response = await fetch('/api/workflow/executions', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          workflowId,
          input: startValidation.normalized,
        }),
      })
      const payload = await response.json() as { data?: WorkflowExecution; message?: string; error?: string }
      if (response.status === 401) {
        router.push('/?redirect=/app/workflow')
        return
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error || payload.message || '运行失败')
      const executionData = payload.data
      setExecution(executionData)
      setEndRendered({})
      setEndRenderLoading({})
      setEndRenderError({})
      setVisibleNodeIds([])
      setFocusedNodeId('')
      setOpenPanels({})
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '运行失败')
    }
    finally {
      setLoading(false)
    }
  }

  const restartWorkflow = () => {
    setExecution(null)
    setLoading(false)
    setError('')
    setEndRendered({})
    setEndRenderLoading({})
    setEndRenderError({})
    setEndRenderedHeights({})
    setVisibleNodeIds([])
    setFocusedNodeId('')
    setOpenPanels({})
    setAutoRunTriggered(false)
  }

  const downloadExecutionSnapshot = () => {
    if (!execution)
      return
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `workflow-execution-${execution.id}-${timestamp}.json`
    const payload = JSON.stringify(execution, null, 2)
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const ensureExportFileName = (name: string) => {
    const base = String(name || '导出').trim() || '导出'
    return base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 64)
  }

  const escapeHtml = (raw: string) => raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const normalizeToHtmlDocument = (raw: string, title: string) => {
    const isFullDoc = /<!doctype/i.test(raw) || /<html[\s>]/i.test(raw)
    if (isFullDoc)
      return raw
    const safeTitle = escapeHtml(title)
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${safeTitle}</title></head><body>${raw}</body></html>`
  }

  const buildRenderedHtmlDocument = (rendered: { html: string; outputType: 'text' | 'html'; templateName: string }) => {
    const title = ensureExportFileName(rendered.templateName || '导出')
    const body = rendered.outputType === 'text'
      ? `<pre style="white-space:pre-wrap; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; margin: 0;">${escapeHtml(String(rendered.html ?? ''))}</pre>`
      : String(rendered.html ?? '')
    return {
      title,
      htmlDoc: normalizeToHtmlDocument(body, title),
    }
  }

  const downloadTextFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const injectPrintEnhancements = (html: string, title: string) => {
    const printStyle = `
<style>
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img, svg, canvas { max-width: 100% !important; }
  a { color: inherit; text-decoration: none; }
  .no-print { display: none !important; }
</style>
`
    const printScript = `
<script>
(() => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const run = async () => {
    try {
      if (document.fonts && document.fonts.ready)
        await document.fonts.ready
    } catch {}
    await wait(80)
    try { window.focus() } catch {}
    try { window.print() } catch {}
  }
  window.addEventListener('load', () => { void run() })
  window.addEventListener('afterprint', () => { try { window.close() } catch {} })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      try { window.close() } catch {}
    }
  })
})()
</script>
`
    const safeTitle = escapeHtml(title)
    const withTitle = /<title[\s>]/i.test(html)
      ? html
      : html.replace(/<head[\s>]/i, match => `${match}<title>${safeTitle}</title>`)

    if (/<\/head>/i.test(withTitle))
      return withTitle.replace(/<\/head>/i, `${printStyle}${printScript}</head>`)
    if (/<html[\s>]/i.test(withTitle))
      return withTitle.replace(/<html[\s>]/i, match => `${match}\n<head>${printStyle}${printScript}</head>`)
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${safeTitle}</title>${printStyle}${printScript}</head><body>${withTitle}</body></html>`
  }

  const exportRenderedToHtml = (nodeId: string) => {
    if (typeof window === 'undefined')
      return
    const rendered = endRendered[nodeId]
    if (!rendered)
      return
    const { title, htmlDoc } = buildRenderedHtmlDocument(rendered)
    downloadTextFile(htmlDoc, `${title}.html`, 'text/html')
  }

  const exportRenderedToImagePdf = (nodeId: string) => {
    void (async () => {
      if (typeof window === 'undefined')
        return
      const rendered = endRendered[nodeId]
      if (!rendered)
        return
      const { title, htmlDoc } = buildRenderedHtmlDocument(rendered)

      const renderHtmlToCanvas = async (html: string) => {
        const [{ default: html2canvas }] = await Promise.all([
          import('html2canvas'),
        ])

        // 以 A4 宽度为基准，尽量接近“标准打印清晰度” 300 DPI（用于图片 PDF 兜底导出）。
        // A4 宽度 210mm ≈ 8.27in；300DPI 时约 2480px。
        const baseWidthPx = 1024
        const targetDpi = 300
        const a4WidthInches = 210 / 25.4
        const desiredCanvasWidthPx = targetDpi * a4WidthInches
        const scale = Math.min(3, Math.max(1, desiredCanvasWidthPx / baseWidthPx))

        const iframe = document.createElement('iframe')
        iframe.setAttribute('sandbox', 'allow-same-origin')
        iframe.setAttribute('scrolling', 'no')
        iframe.style.position = 'fixed'
        iframe.style.left = '-100000px'
        iframe.style.top = '0'
        iframe.style.width = `${baseWidthPx}px`
        iframe.style.height = '10px'
        iframe.style.border = '0'
        iframe.style.background = 'white'
        iframe.srcdoc = html
        document.body.appendChild(iframe)

        try {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('渲染超时')), 8000)
            iframe.onload = () => {
              window.clearTimeout(timer)
              resolve()
            }
          })

          const doc = iframe.contentWindow?.document
          if (!doc)
            throw new Error('无法读取渲染文档')

          try {
            // 等待字体与一次重排，避免 html2canvas 捕获到“尚未应用字体”的低清晰度状态
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            await (doc.fonts?.ready ?? Promise.resolve())
          }
          catch {
          }
          await new Promise<void>(resolve => window.setTimeout(resolve, 60))

          const body = doc.body
          const docEl = doc.documentElement
          const height = Math.max(
            body?.scrollHeight ?? 0,
            body?.offsetHeight ?? 0,
            docEl?.scrollHeight ?? 0,
            docEl?.offsetHeight ?? 0,
          )
          iframe.style.height = `${Math.min(Math.max(height + 16, 200), 20000)}px`

          const target = (docEl || body) as unknown as HTMLElement
          const canvas = await html2canvas(target, {
            // 之前用 PNG + 高 scale 会导致 PDF 体积极大（内容很少也可能到数 MB）。
            // 这里按 A4 300DPI 计算 scale，并在后续用 JPEG 压缩。
            scale,
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: baseWidthPx,
          })
          return canvas
        }
        finally {
          document.body.removeChild(iframe)
        }
      }

      const canvasToPdf = async (canvas: HTMLCanvasElement, filename: string) => {
        const [{ jsPDF }] = await Promise.all([
          import('jspdf'),
        ])

        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()

        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        const imgWidth = pageWidth
        const imgHeight = (canvas.height * imgWidth) / canvas.width

        if (imgHeight <= pageHeight) {
          pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST')
          pdf.save(`${filename}.pdf`)
          return
        }

        // 多页：按 A4 高度切片
        const pageHeightPx = (canvas.width * pageHeight) / pageWidth
        let renderedHeightPx = 0
        let pageIndex = 0
        while (renderedHeightPx < canvas.height - 1) {
          const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedHeightPx)
          const pageCanvas = document.createElement('canvas')
          pageCanvas.width = canvas.width
          pageCanvas.height = Math.ceil(sliceHeightPx)
          const ctx = pageCanvas.getContext('2d')
          if (!ctx)
            break
          ctx.drawImage(canvas, 0, -renderedHeightPx)
          const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
          if (pageIndex > 0)
            pdf.addPage()
          const pageImgHeight = (pageCanvas.height * imgWidth) / pageCanvas.width
          pdf.addImage(pageImg, 'JPEG', 0, 0, imgWidth, pageImgHeight, undefined, 'FAST')
          renderedHeightPx += sliceHeightPx
          pageIndex += 1
          if (pageIndex > 60)
            break
        }

        pdf.save(`${filename}.pdf`)
      }

      try {
        const canvas = await renderHtmlToCanvas(htmlDoc)
        await canvasToPdf(canvas, title)
      }
      catch (pdfError) {
        setError(pdfError instanceof Error ? `导出 PDF 失败：${pdfError.message}` : '导出 PDF 失败')
      }
    })()
  }

  const exportRenderedToPdf = (nodeId: string) => {
    if (typeof window === 'undefined')
      return
    const rendered = endRendered[nodeId]
    if (!rendered)
      return

    const { title, htmlDoc } = buildRenderedHtmlDocument(rendered)
    const printableDoc = injectPrintEnhancements(htmlDoc, title)
    const blob = new Blob([printableDoc], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const popup = window.open(url, '_blank', 'noopener,noreferrer')
    if (!popup) {
      URL.revokeObjectURL(url)
      exportRenderedToImagePdf(nodeId)
      return
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  useEffect(() => {
    if (!autoRun || autoRunTriggered)
      return
    if (loading || execution)
      return
    if (startFields.length > 0) {
      setAutoRunTriggered(true)
      return
    }
    if (typeof window === 'undefined')
      return
    setAutoRunTriggered(true)
    runWorkflow()
  }, [autoRun, autoRunTriggered, execution, loading, runWorkflow, startFields.length])

  const submitWaitingInput = async () => {
    if (!execution?.waitingInput)
      return
    if (!validateBeforeRun())
      return
    const waitingValidation = validateDynamicInput(waitingFields, waitingInput)
    if (!waitingValidation.ok) {
      setError(waitingValidation.message)
      return
    }
    setLoading(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      const token = resolveAuthToken()
      if (token)
        headers.Authorization = `Bearer ${token}`
      const response = await fetch(`/api/workflow/executions/${execution.id}/resume`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          nodeId: execution.waitingInput.nodeId,
          input: waitingValidation.normalized,
        }),
      })
      const payload = await response.json() as { data?: WorkflowExecution; message?: string; error?: string }
      if (response.status === 401) {
        router.push('/?redirect=/app/workflow')
        return
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error || payload.message || '提交输入失败')
      const executionData = payload.data
      setExecution(executionData)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '提交输入失败')
    }
    finally {
      setLoading(false)
    }
  }

  const copyNodeOutputJson = async (value: unknown) => {
    if (typeof window === 'undefined' || !window.navigator?.clipboard) {
      message.error('当前环境不支持复制到剪贴板')
      return
    }
    const payload = JSON.stringify(value === undefined ? null : value, null, 2)
    try {
      await window.navigator.clipboard.writeText(payload)
      message.success('已复制节点输出 JSON')
    }
    catch {
      message.error('复制失败，请检查浏览器剪贴板权限')
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Modal
        open={logModalOpen}
        onCancel={() => setLogModalOpen(false)}
        footer={null}
        title="运行日志"
        width={920}
      >
        {!execution && <div className="text-sm text-gray-500">暂无运行日志（尚未执行）。</div>}
        {execution && (
          <Tabs
            items={[
              {
                key: 'events',
                label: `事件（${execution.events?.length ?? 0}）`,
                children: (
                  <pre className="max-h-[520px] overflow-auto rounded bg-gray-50 p-3 text-[11px] text-gray-700 whitespace-pre-wrap">
                    {renderJson(execution.events ?? [])}
                  </pre>
                ),
              },
              {
                key: 'nodes',
                label: '节点状态',
                children: (
                  <pre className="max-h-[520px] overflow-auto rounded bg-gray-50 p-3 text-[11px] text-gray-700 whitespace-pre-wrap">
                    {renderJson(execution.nodeStates)}
                  </pre>
                ),
              },
              {
                key: 'snapshot',
                label: '执行快照',
                children: (
                  <div className="space-y-3 rounded bg-gray-50 p-3">
                    <div className="text-xs text-gray-600">
                      执行快照体积较大时，直接渲染会导致页面卡顿。请下载后本地查看。
                    </div>
                    <button
                      type="button"
                      onClick={downloadExecutionSnapshot}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                    >
                      下载执行快照（JSON）
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Modal>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <button
          type="button"
          onClick={() => setPreviewCollapsed(prev => !prev)}
          className="mb-2 flex w-full items-center justify-between rounded px-1 py-1 text-left hover:bg-gray-50"
        >
          <div className="text-sm font-semibold text-gray-900">流程图</div>
          <div className="text-xs text-gray-500">{previewCollapsed ? '▾' : '▴'}</div>
        </button>
        {!previewCollapsed && (
          <div className="h-[360px] overflow-hidden rounded border border-gray-200">
            <ReactFlow
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodes={previewGraph.nodes}
              edges={previewGraph.edges}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
            >
              <MiniMap pannable zoomable style={{ width: 120, height: 80 }} />
              <Controls />
              <Background gap={14} size={1.5} />
            </ReactFlow>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">流程执行</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLogModalOpen(true)}
              disabled={!execution}
              className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            >
              日志
            </button>
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
              状态：{execution ? execution.status : '未运行'}
            </span>
            {execution && (
              <button
                type="button"
                onClick={restartWorkflow}
                disabled={loading}
                className="rounded bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {loading ? '运行中...' : '重新执行'}
              </button>
            )}
          </div>
        </div>

        {!execution && (
          <div className="space-y-3 rounded border border-dashed border-gray-300 p-3">
            <div className="text-xs text-gray-600">开始/输入节点会在这里生成交互表单。填写后点击底部“提交并运行”。</div>
            <DynamicForm fields={startFields} values={startInput} onChange={setStartInput} />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={runWorkflow}
                disabled={loading}
                className="rounded bg-violet-600 px-4 py-2 text-xs text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {loading ? '运行中...' : '提交并运行'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="mb-3 whitespace-pre-wrap rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

        {execution && visibleNodeIds.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">暂无执行节点。</div>
        )}

        {execution && (
          <div className="space-y-2">
            {visibleNodeIds.map((nodeId) => {
              const node = nodeMap.get(nodeId)
              const state = node ? execution.nodeStates[node.id] : undefined
              if (!node || !state)
                return null
              if (state.status === 'skipped')
                return null
              const panelOpen = openPanels[node.id] ?? false
              const status = state.status
              const rawNodeOutput = execution.variables[node.id]
              const nodeOutput = node.data.type === BlockEnum.End
                ? buildEndConfiguredOutput(node, execution.variables, rawNodeOutput)
                : rawNodeOutput
              const isWaitingCurrent = execution.waitingInput?.nodeId === node.id && status === 'waiting_input'
              const nodeConfig: Record<string, unknown> = isObject(node.data.config) ? node.data.config : {}
              const waitingPrompt = (() => {
                if (!isWaitingCurrent)
                  return ''
                const schemaPromptRaw = execution.waitingInput?.schema?.['prompt']
                const schemaPrompt = typeof schemaPromptRaw === 'string'
                  ? schemaPromptRaw
                  : ''
                const nodePrompt = typeof nodeConfig.prompt === 'string' ? nodeConfig.prompt : ''
                const rawPrompt = schemaPrompt || nodePrompt
                if (!rawPrompt.trim())
                  return ''
                return renderRuntimeTemplate(rawPrompt, execution.variables ?? {})
              })()

              return (
                <div key={node.id} ref={(el) => { nodeCardRefs.current[node.id] = el }} className="rounded border border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenPanels(prev => ({ ...prev, [node.id]: !(prev[node.id] ?? false) }))
                      setFocusedNodeId(node.id)
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <div className="text-sm font-medium text-gray-800">{node.data.title}</div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${statusClassMap[status]}`}>{statusTextMap[status]}</span>
                      <span className="text-xs text-gray-500">{panelOpen ? '收起' : '展开'}</span>
                    </div>
                  </button>

	              {panelOpen && (
	                    <div className="space-y-2 border-t border-gray-200 px-3 py-3">
	                      {state.error && <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{state.error}</div>}

                      {node.data.type === 'http-request' && (
                        <>
                          <div className="text-xs text-gray-500">请求配置</div>
                          <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(renderHttpConfigForLog(nodeConfig, execution?.variables))}</pre>
                        </>
                      )}

                  {isWaitingCurrent && (
                        <div className="space-y-2 rounded border border-gray-200 bg-white p-2">
                          <div className="text-xs font-medium text-gray-800">节点等待输入，请提交后继续</div>
                          {!!waitingPrompt && (
                            <div className="whitespace-pre-wrap rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-800">
                              {waitingPrompt}
                            </div>
                          )}
                          <DynamicForm fields={waitingFields} values={waitingInput} onChange={setWaitingInput} />
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={submitWaitingInput}
                              disabled={loading}
                              className="rounded bg-blue-600 px-4 py-2 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                              {loading ? '提交中...' : '提交并继续'}
                            </button>
                          </div>
                        </div>
                      )}

	                      {node.data.type === BlockEnum.End && (
	                        <div className="space-y-2">
	                          <div className="flex items-center justify-between gap-2">
	                            <div className="text-xs text-gray-500">模板渲染</div>
	                            {endRendered[node.id] && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => exportRenderedToPdf(node.id)}
                                    className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                                  >
                                    导出 PDF（可复制）
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => exportRenderedToHtml(node.id)}
                                    className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                                  >
                                    导出 HTML
                                  </button>
                                </div>
	                            )}
	                          </div>
	                          {endRenderLoading[node.id] && (
	                            <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">渲染中...</div>
	                          )}
	                          {endRenderError[node.id] && (
	                            <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{endRenderError[node.id]}</div>
	                          )}
	                          {endRendered[node.id] && (
	                            <div className="rounded border border-gray-200 bg-white p-2">
	                              <div className="mb-2 text-[11px] text-gray-500">模板：{endRendered[node.id].templateName}</div>
	                              {endRendered[node.id].outputType === 'html'
	                                ? (
	                                    <iframe
	                                      title={`end-template-${node.id}`}
	                                      sandbox="allow-same-origin"
	                                      scrolling="no"
	                                      srcDoc={endRendered[node.id].html}
	                                      onLoad={(event) => {
	                                        const iframe = event.currentTarget
	                                        try {
	                                        const doc = iframe.contentWindow?.document
	                                        if (!doc)
	                                          return
	                                        const body = doc.body
	                                        const docEl = doc.documentElement

	                                        const computeHeight = () => {
	                                          let maxBottom = 0
	                                          try {
	                                            const elements = body?.querySelectorAll?.('*') ?? []
	                                            const cap = Math.min(elements.length, 4000)
	                                            for (let i = 0; i < cap; i += 1) {
	                                              const el = elements[i] as Element
	                                              const rect = (el as HTMLElement).getBoundingClientRect?.()
	                                              if (!rect)
	                                                continue
	                                              if (Number.isFinite(rect.bottom))
	                                                maxBottom = Math.max(maxBottom, rect.bottom)
	                                            }
	                                          }
	                                          catch {
	                                          }

	                                            const bodyRect = body?.getBoundingClientRect()
	                                            const docRect = docEl?.getBoundingClientRect()
	                                            const height = Math.max(
	                                              body?.scrollHeight ?? 0,
	                                              body?.offsetHeight ?? 0,
	                                              Math.ceil(bodyRect?.height ?? 0),
	                                              docEl?.scrollHeight ?? 0,
	                                              docEl?.offsetHeight ?? 0,
	                                              Math.ceil(docRect?.height ?? 0),
	                                              Math.ceil(maxBottom),
	                                            )
	                                            if (height > 0) {
	                                              const next = Math.min(Math.max(height + 8, 240), 20000)
	                                              setEndRenderedHeights(prev => ({ ...prev, [node.id]: next }))
	                                            }
	                                          }

	                                          computeHeight()
	                                          window.setTimeout(computeHeight, 60)
	                                          window.setTimeout(computeHeight, 240)

	                                          const existing = iframeResizeObserversRef.current[node.id]
	                                          if (existing) {
	                                            try {
	                                              existing.disconnect()
	                                            }
	                                            catch {
	                                            }
	                                          }
	                                          if (typeof ResizeObserver !== 'undefined') {
	                                            const observer = new ResizeObserver(() => computeHeight())
	                                            iframeResizeObserversRef.current[node.id] = observer
	                                            observer.observe(docEl)
	                                          }
	                                        }
	                                        catch {
	                                        }
	                                      }}
	                                      className="w-full rounded border border-gray-200 bg-white"
	                                      style={{ height: `${endRenderedHeights[node.id] || 520}px`, display: 'block' }}
	                                    />
	                                  )
	                                : (
	                                    <pre className="w-full rounded border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-700 whitespace-pre-wrap">
	                                      {endRendered[node.id].html}
	                                    </pre>
	                                  )}
	                            </div>
	                          )}
	                          {!endRendered[node.id] && !endRenderLoading[node.id] && !endRenderError[node.id] && (
	                            <div className="text-[11px] text-gray-400">未配置模板或尚未完成执行。</div>
	                          )}
	                        </div>
	                      )}

	                      <Collapse
	                        size="small"
	                        bordered={false}
	                        className="rounded border border-gray-200 bg-white"
	                        activeKey={nodeOutputExpandedById[node.id] ? ['output'] : []}
	                        onChange={(keys) => {
	                          const list = Array.isArray(keys) ? keys : [keys]
	                          const expanded = list.includes('output')
	                          setNodeOutputExpandedById(prev => ({ ...prev, [node.id]: expanded }))
	                        }}
	                        items={[
	                          {
	                            key: 'output',
	                            label: (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs text-gray-600">节点输出（JSON）</span>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      void copyNodeOutputJson(nodeOutput)
                                    }}
                                    className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                                  >
                                    复制
                                  </button>
                                </div>
                              ),
	                            children: (
	                              <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
	                                {renderJson(nodeOutput)}
	                              </pre>
	                            ),
	                          },
	                        ]}
	                      />
	                    </div>
	                  )}
	                </div>
	              )
	            })}
          </div>
        )}
      </div>

    </div>
  )
}

function DynamicForm({
  fields,
  values,
  onChange,
}: {
  fields: DynamicField[]
  values: Record<string, unknown>
  onChange: (nextValues: Record<string, unknown>) => void
}) {
  if (!fields.length)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无可配置字段" />

  const [form] = Form.useForm()
  useEffect(() => {
    form.setFieldsValue(values)
  }, [form, values])

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      onValuesChange={(_changed, allValues) => onChange(allValues)}
      className="m-0"
    >
      {fields.map((field) => {
        const label = `${field.label || field.name}${field.required ? ' *' : ''}`
        if (field.type === 'checkbox') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} valuePropName="checked">
              <Checkbox>勾选</Checkbox>
            </Form.Item>
          )
        }
        if (field.type === 'paragraph') {
          return (
            <Form.Item key={field.name} name={field.name} label={label}>
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
            </Form.Item>
          )
        }
        if (field.type === 'number') {
          return (
            <Form.Item key={field.name} name={field.name} label={label}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          )
        }
        if (field.type === 'select') {
          return (
            <Form.Item key={field.name} name={field.name} label={label}>
              <Select
                allowClear
                placeholder="请选择"
                options={field.options.map(option => ({
                  label: option.label || option.value,
                  value: option.value,
                }))}
              />
            </Form.Item>
          )
        }
        return (
          <Form.Item key={field.name} name={field.name} label={label}>
            <Input />
          </Form.Item>
        )
      })}
    </Form>
  )
}
