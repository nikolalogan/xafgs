'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Checkbox, Collapse, Empty, Form, Input, InputNumber, Modal, Select, Tabs, message } from 'antd'
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
import 'reactflow/dist/style.css'
import { CUSTOM_EDGE, CUSTOM_NODE } from '../core/constants'
import { buildExternalRuleInputs, buildLocalRuleInputs, buildPreparedFields, evaluateDynamicFieldStates, evaluateDynamicFieldValidations, type DynamicField, type DynamicFieldState, validateDynamicInput } from '../core/dynamic-form-rules'
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

type WorkflowExecutionEvent = NonNullable<WorkflowExecution['events']>[number]
type SubmitPhase = '' | 'checking_user_config' | 'submitting_start' | 'submitting_waiting_input'
type ExecutionViewPhase = 'idle' | 'starting' | 'bootstrapping' | 'playing' | 'waiting_input' | 'completed' | 'failed_or_cancelled'

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

const shouldShowRunningIcon = (nodeType: string, status: RuntimeNodeStatus, activeNodeId: string, nodeId: string) => {
  if (activeNodeId !== nodeId || status !== 'running')
    return false
  return nodeType === BlockEnum.HttpRequest || nodeType === BlockEnum.ApiRequest || nodeType === BlockEnum.LLM
}

const shouldAutoOpenNode = (nodeType: string, status: RuntimeNodeStatus) => {
  if (nodeType === BlockEnum.Start || nodeType === BlockEnum.End)
    return true
  if (status === 'waiting_input' || status === 'failed')
    return true
  return false
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
      visibleWhen: typeof entry.visibleWhen === 'string' ? entry.visibleWhen : undefined,
      validateWhen: typeof entry.validateWhen === 'string' ? entry.validateWhen : undefined,
    } satisfies DynamicField
  }).filter(field => field.name)
}

const isJSONResponse = (response: Response) => {
  const contentType = response.headers.get('content-type') || ''
  return contentType.toLowerCase().includes('application/json')
}

const readErrorResponseText = async (response: Response) => {
  const raw = (await response.text()).trim()
  if (!raw)
    return ''
  if (raw.startsWith('<'))
    return `请求失败（HTTP ${response.status}），网关返回了非 JSON 响应`
  return raw
}

const readWorkflowExecutionPayload = async (response: Response): Promise<{ data?: WorkflowExecution; message?: string; error?: string }> => {
  if (!isJSONResponse(response)) {
    const message = await readErrorResponseText(response)
    return { message, error: message }
  }
  return await response.json() as { data?: WorkflowExecution; message?: string; error?: string }
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

const userConfigFields = [
  { key: 'warningAccount', label: '预警通账号', hash: '#warningAccount' },
  { key: 'warningPassword', label: '预警通密码', hash: '#warningPassword' },
  { key: 'aiBaseUrl', label: 'AI 服务商地址', hash: '#aiBaseUrl' },
  { key: 'aiApiKey', label: 'AI APIKey', hash: '#aiApiKey' },
] as const

type UserConfigFieldKey = typeof userConfigFields[number]['key']

const normalizeUserConfigFieldName = (raw: string) => String(raw || '')
  .replace(/[:：]/g, '')
  .replace(/[\s_-]+/g, '')
  .toLowerCase()

const resolveUserConfigFieldKey = (raw: string): UserConfigFieldKey | '' => {
  const normalized = normalizeUserConfigFieldName(raw)
  if (!normalized)
    return ''
  if (normalized === 'warningaccount' || normalized === '预警通账号')
    return 'warningAccount'
  if (normalized === 'warningpassword' || normalized === '预警通密码')
    return 'warningPassword'
  if (normalized === 'aibaseurl' || normalized === 'aiserviceprovideraddress' || normalized === 'ai服务商地址')
    return 'aiBaseUrl'
  if (normalized === 'aiapikey')
    return 'aiApiKey'
  return ''
}

const parseMissingUserConfigKeysFromMessage = (rawMessage: string): UserConfigFieldKey[] => {
  const message = String(rawMessage || '').trim()
  if (!message)
    return []
  const missingPrefixIndex = message.indexOf('缺少用户配置')
  const content = missingPrefixIndex >= 0
    ? message.slice(missingPrefixIndex).replace(/^缺少用户配置[:：]?/, '')
    : message
  const parts = content.split(/[、,，;；]/g).map(item => item.trim()).filter(Boolean)
  const keys = parts
    .map(resolveUserConfigFieldKey)
    .filter((key): key is UserConfigFieldKey => Boolean(key))
  if (keys.length === 0)
    return []
  const keySet = new Set<UserConfigFieldKey>(keys)
  return userConfigFields.filter(field => keySet.has(field.key)).map(field => field.key)
}

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
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('')
  const [error, setError] = useState('')
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [previewCollapsed, setPreviewCollapsed] = useState(true)
  const [focusedNodeId, setFocusedNodeId] = useState('')
  const [activeNodeId, setActiveNodeId] = useState('')
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({})
  const [visibleNodeIds, setVisibleNodeIds] = useState<string[]>([])
  const [historyGroupExpanded, setHistoryGroupExpanded] = useState(false)
  const [pendingPlaybackEvents, setPendingPlaybackEvents] = useState<WorkflowExecutionEvent[]>([])
  const executionRef = useRef<WorkflowExecution | null>(null)
  const visibleNodeIdsRef = useRef<string[]>([])
  const focusedNodeIdRef = useRef('')
  const activeNodeIdRef = useRef('')
  const openPanelsRef = useRef<Record<string, boolean>>({})
  const processedExecutionIdRef = useRef('')
  const processedEventCountRef = useRef(0)
  const playbackTimerRef = useRef<number | null>(null)
  const playbackActiveRef = useRef(false)
  const autoOpenedNodeIdsRef = useRef<Set<string>>(new Set())
  const nodeCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const nodeHeaderRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const waitingFormRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const startFormRef = useRef<HTMLDivElement | null>(null)
  const runScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const historyGroupHeaderRef = useRef<HTMLButtonElement | null>(null)
  const historyNodeIdsRef = useRef<string[]>([])
  const historyGroupExpandedRef = useRef(false)
  const scrollRetryTimerRef = useRef<number | null>(null)
  const scrollRequestTokenRef = useRef(0)
  const startFields = useMemo(() => normalizeStartFields(nodes), [nodes])
  const [startInput, setStartInput] = useState<Record<string, unknown>>({})
  const waitingFields = useMemo(() => normalizeWaitingFields(execution?.waitingInput?.schema), [execution?.waitingInput?.schema])
  const [waitingInput, setWaitingInput] = useState<Record<string, unknown>>({})
  const waitingPreparedFields = useMemo(() => {
    if (!execution?.waitingInput?.nodeId)
      return []
    return buildPreparedFields(waitingFields, execution.waitingInput.nodeId)
  }, [execution?.waitingInput?.nodeId, waitingFields])
  const waitingExternalRuleInputs = useMemo(() => {
    return buildExternalRuleInputs(waitingPreparedFields, (execution?.variables ?? {}) as Record<string, unknown>)
  }, [execution?.variables, waitingPreparedFields])
  const waitingLocalRuleInputs = useMemo(() => {
    if (!execution?.waitingInput?.nodeId)
      return {}
    return buildLocalRuleInputs(execution.waitingInput.nodeId, waitingInput)
  }, [execution?.waitingInput?.nodeId, waitingInput])
  const waitingFieldStates = useMemo(() => {
    const mergedRuleInputs = {
      ...waitingExternalRuleInputs,
      ...waitingLocalRuleInputs,
    }
    return evaluateDynamicFieldStates(waitingPreparedFields, mergedRuleInputs)
  }, [waitingExternalRuleInputs, waitingLocalRuleInputs, waitingPreparedFields])
  const [autoRunTriggered, setAutoRunTriggered] = useState(false)
  const [endRendered, setEndRendered] = useState<Record<string, { html: string; outputType: 'text' | 'html'; templateName: string; executionId: string }>>({})
  const [endRenderLoading, setEndRenderLoading] = useState<Record<string, boolean>>({})
  const [endRenderError, setEndRenderError] = useState<Record<string, string>>({})
  const [endRenderedHeights, setEndRenderedHeights] = useState<Record<string, number>>({})
  const [nodeOutputExpandedById, setNodeOutputExpandedById] = useState<Record<string, boolean>>({})
  const iframeResizeObserversRef = useRef<Record<string, ResizeObserver>>({})
  const executionStreamIdRef = useRef<string>('')
  const executionStreamAbortRef = useRef<AbortController | null>(null)
  const executionStreamReconnectTimerRef = useRef<number | null>(null)
  const executionStreamRetryRef = useRef(0)
  const waitingResumeNodeIdRef = useRef('')
  const startNodeId = useMemo(() => {
    return nodes.find(node => String(node.data.type).toLowerCase() === BlockEnum.Start)?.id || ''
  }, [nodes])
  const currentDisplayNodeId = activeNodeId || focusedNodeId

  const collapseNodePanel = (nodeId: string) => {
    if (!nodeId)
      return
    autoOpenedNodeIdsRef.current.delete(nodeId)
    focusedNodeIdRef.current = ''
    activeNodeIdRef.current = ''
    openPanelsRef.current = {
      ...openPanelsRef.current,
      [nodeId]: false,
    }
    setFocusedNodeId('')
    setActiveNodeId('')
    setOpenPanels(prev => ({ ...prev, [nodeId]: false }))
  }

  const resetPlaybackState = () => {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current)
      playbackTimerRef.current = null
    }
    if (scrollRetryTimerRef.current !== null) {
      window.clearTimeout(scrollRetryTimerRef.current)
      scrollRetryTimerRef.current = null
    }
    scrollRequestTokenRef.current += 1
    playbackActiveRef.current = false
    processedExecutionIdRef.current = ''
    processedEventCountRef.current = 0
    visibleNodeIdsRef.current = []
    focusedNodeIdRef.current = ''
    activeNodeIdRef.current = ''
    openPanelsRef.current = {}
    autoOpenedNodeIdsRef.current = new Set()
    historyNodeIdsRef.current = []
    historyGroupExpandedRef.current = false
    setPendingPlaybackEvents([])
    setVisibleNodeIds([])
    setFocusedNodeId('')
    setActiveNodeId('')
    setOpenPanels({})
    setHistoryGroupExpanded(false)
  }

  const stopExecutionStream = () => {
    executionStreamIdRef.current = ''
    executionStreamRetryRef.current = 0
    if (executionStreamReconnectTimerRef.current !== null) {
      window.clearTimeout(executionStreamReconnectTimerRef.current)
      executionStreamReconnectTimerRef.current = null
    }
    if (executionStreamAbortRef.current) {
      executionStreamAbortRef.current.abort()
      executionStreamAbortRef.current = null
    }
  }

  const bootstrapExecutionView = (nodeId: string) => {
    if (!nodeId)
      return
    const nextVisible = [nodeId]
    const nextOpenPanels = { [nodeId]: true }
    visibleNodeIdsRef.current = nextVisible
    focusedNodeIdRef.current = nodeId
    activeNodeIdRef.current = nodeId
    openPanelsRef.current = nextOpenPanels
    setVisibleNodeIds(nextVisible)
    setFocusedNodeId(nodeId)
    setActiveNodeId(nodeId)
    setOpenPanels(nextOpenPanels)
  }

  const getSubmitButtonText = () => {
    if (submitPhase === 'checking_user_config')
      return '检查运行配置中...'
    if (submitPhase === 'submitting_start')
      return '启动流程中...'
    return loading ? '运行中...' : '提交并运行'
  }

  const getWaitingSubmitButtonText = () => {
    if (submitPhase === 'submitting_waiting_input')
      return '提交并继续执行中...'
    return loading ? '提交中...' : '提交并继续'
  }

  const scrollWaitingFormIntoView = (nodeId: string) => {
    if (typeof window === 'undefined')
      return
    const formElement = waitingFormRefs.current[nodeId]
    if (!formElement)
      return
    window.requestAnimationFrame(() => {
      try {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      catch {
      }
      window.setTimeout(() => {
        try {
          const rect = formElement.getBoundingClientRect()
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
          if (rect.bottom > viewportHeight - 24) {
            const overshoot = rect.bottom - viewportHeight + 24
            window.scrollBy({ top: overshoot, behavior: 'smooth' })
          }
        }
        catch {
        }
      }, 80)
    })
  }

  const scrollNodeCardIntoView = (nodeId: string, requestToken = ++scrollRequestTokenRef.current) => {
    if (typeof window === 'undefined')
      return
    const titleElement = nodeId === '__history_group__'
      ? historyGroupHeaderRef.current
      : (nodeHeaderRefs.current[nodeId] || nodeCardRefs.current[nodeId])
    if (!titleElement) {
      if (scrollRetryTimerRef.current !== null)
        window.clearTimeout(scrollRetryTimerRef.current)
      scrollRetryTimerRef.current = window.setTimeout(() => {
        if (scrollRequestTokenRef.current !== requestToken)
          return
        scrollNodeCardIntoView(nodeId, requestToken)
      }, 60)
      return
    }

    const alignTitleIntoView = (behavior: ScrollBehavior) => {
      if (scrollRequestTokenRef.current !== requestToken)
        return false
      try {
        const container = runScrollContainerRef.current
        if (!container) {
          titleElement.scrollIntoView({ behavior, block: 'start' })
          return true
        }

        const containerRect = container.getBoundingClientRect()
        const titleRect = titleElement.getBoundingClientRect()
        const currentScrollTop = container.scrollTop
        const targetOffsetTop = titleRect.top - containerRect.top + currentScrollTop
        const topAnchorOffset = Math.max(16, Math.round(container.clientHeight / 8))
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
        const targetTop = Math.min(maxScrollTop, Math.max(0, targetOffsetTop - topAnchorOffset))
        if (Math.abs(container.scrollTop - targetTop) <= 4)
          return true

        container.scrollTo({
          top: targetTop,
          behavior,
        })
        return true
      }
      catch {
        return false
      }
    }

    window.requestAnimationFrame(() => {
      const aligned = alignTitleIntoView('smooth')
      if (!aligned)
        return
      if (scrollRetryTimerRef.current !== null)
        window.clearTimeout(scrollRetryTimerRef.current)
      scrollRetryTimerRef.current = window.setTimeout(() => {
        if (scrollRequestTokenRef.current !== requestToken)
          return
        window.requestAnimationFrame(() => {
          if (scrollRequestTokenRef.current !== requestToken)
            return
          alignTitleIntoView('auto')
        })
      }, 90)
    })
  }

  const scheduleNodeScrollIntoView = (nodeId: string) => {
    if (typeof window === 'undefined' || !nodeId)
      return
    const requestToken = ++scrollRequestTokenRef.current
    const delays = [0, 80, 180, 320]
    const runAttempt = (attemptIndex: number) => {
      if (scrollRequestTokenRef.current !== requestToken)
        return
      scrollNodeCardIntoView(nodeId, requestToken)
      const nextAttemptIndex = attemptIndex + 1
      if (nextAttemptIndex >= delays.length)
        return
      if (scrollRetryTimerRef.current !== null)
        window.clearTimeout(scrollRetryTimerRef.current)
      scrollRetryTimerRef.current = window.setTimeout(() => {
        runAttempt(nextAttemptIndex)
      }, delays[nextAttemptIndex])
    }
    runAttempt(0)
  }

  const bindNodeCardRef = (nodeId: string, element: HTMLDivElement | null) => {
    nodeCardRefs.current[nodeId] = element
    if (!element)
      return
    if (activeNodeIdRef.current !== nodeId && focusedNodeIdRef.current !== nodeId)
      return
    window.setTimeout(() => {
      scheduleNodeScrollIntoView(nodeId)
    }, 0)
  }

  const bindNodeHeaderRef = (nodeId: string, element: HTMLButtonElement | null) => {
    nodeHeaderRefs.current[nodeId] = element
    if (!element)
      return
    if (activeNodeIdRef.current !== nodeId && focusedNodeIdRef.current !== nodeId)
      return
    window.setTimeout(() => {
      scheduleNodeScrollIntoView(nodeId)
    }, 0)
  }

  const focusCurrentNode = (nodeId: string, options?: { open?: boolean }) => {
    if (!nodeId)
      return
    focusedNodeIdRef.current = nodeId
    setFocusedNodeId(nodeId)
    if (!options?.open)
      return
    setOpenPanels((prev) => {
      const nextPanels = Object.keys(prev).reduce<Record<string, boolean>>((acc, key) => {
        if (prev[key])
          acc[key] = false
        return acc
      }, {})
      nextPanels[nodeId] = true
      openPanelsRef.current = nextPanels
      return nextPanels
    })
  }

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
    executionRef.current = execution
  }, [execution])

  useEffect(() => {
    visibleNodeIdsRef.current = visibleNodeIds
  }, [visibleNodeIds])

  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId
  }, [focusedNodeId])

  useEffect(() => {
    activeNodeIdRef.current = activeNodeId
  }, [activeNodeId])

  useEffect(() => {
    openPanelsRef.current = openPanels
  }, [openPanels])

  useEffect(() => {
    historyGroupExpandedRef.current = historyGroupExpanded
  }, [historyGroupExpanded])

  useEffect(() => {
    if (!execution?.waitingInput?.nodeId)
      return
    if ((openPanels[execution.waitingInput.nodeId] ?? false) !== true)
      return
    scrollWaitingFormIntoView(execution.waitingInput.nodeId)
  }, [execution?.waitingInput?.nodeId, openPanels])

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
      stopExecutionStream()
      if (scrollRetryTimerRef.current !== null) {
        window.clearTimeout(scrollRetryTimerRef.current)
        scrollRetryTimerRef.current = null
      }
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
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
  const historyNodeIds = useMemo(() => {
    return visibleNodeIds.filter((nodeId) => {
      const node = nodeMap.get(nodeId)
      return !!node
        && node.data.type !== BlockEnum.End
        && nodeId !== execution?.waitingInput?.nodeId
    })
  }, [execution?.waitingInput?.nodeId, nodeMap, visibleNodeIds])
  const endNodeIds = useMemo(() => {
    return visibleNodeIds.filter((nodeId) => {
      const node = nodeMap.get(nodeId)
      return !!node && node.data.type === BlockEnum.End
    })
  }, [nodeMap, visibleNodeIds])
  const waitingInputNodeId = useMemo(() => {
    const nodeId = execution?.waitingInput?.nodeId || ''
    if (!nodeId)
      return ''
    const node = nodeMap.get(nodeId)
    if (!node || node.data.type === BlockEnum.End)
      return ''
    return nodeId
  }, [execution?.waitingInput?.nodeId, nodeMap])
  const currentHistoryNodeId = useMemo(() => {
    if (currentDisplayNodeId) {
      const currentNode = nodeMap.get(currentDisplayNodeId)
      if (currentNode && currentNode.data.type !== BlockEnum.End)
        return currentDisplayNodeId
    }
    for (let i = historyNodeIds.length - 1; i >= 0; i -= 1) {
      if (historyNodeIds[i])
        return historyNodeIds[i]
    }
    return ''
  }, [currentDisplayNodeId, historyNodeIds, nodeMap])

  const executionEventCount = execution?.events?.length ?? 0
  const isBootstrappingExecution = Boolean(
    execution
    && execution.status === 'running'
    && executionEventCount === 0,
  )
  const executionViewPhase = useMemo<ExecutionViewPhase>(() => {
    if (!execution)
      return submitPhase === 'submitting_start' ? 'starting' : 'idle'
    if (execution.status === 'waiting_input')
      return 'waiting_input'
    if (execution.status === 'completed')
      return 'completed'
    if (execution.status === 'failed' || execution.status === 'cancelled')
      return 'failed_or_cancelled'
    if (isBootstrappingExecution)
      return 'bootstrapping'
    return 'playing'
  }, [execution, isBootstrappingExecution, submitPhase])
  const currentHistoryNode = currentHistoryNodeId ? nodeMap.get(currentHistoryNodeId) : undefined
  const currentHistoryNodeState = currentHistoryNodeId
    ? (
        execution?.nodeStates?.[currentHistoryNodeId]
        || (executionViewPhase === 'bootstrapping' && currentHistoryNode?.id === startNodeId
          ? {
              nodeId: currentHistoryNode.id,
              status: 'running' as RuntimeNodeStatus,
            }
          : undefined)
      )
    : undefined

  useEffect(() => {
    historyNodeIdsRef.current = historyNodeIds
  }, [historyNodeIds])

  useEffect(() => {
    const scrollTargetId = currentDisplayNodeId && currentHistoryNodeId === currentDisplayNodeId && !historyGroupExpanded
      ? '__history_group__'
      : currentDisplayNodeId
    if (!scrollTargetId)
      return
    if (typeof window === 'undefined')
      return
    scheduleNodeScrollIntoView(scrollTargetId)
  }, [currentDisplayNodeId, currentHistoryNodeId, historyGroupExpanded, nodes, visibleNodeIds])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    if (!currentDisplayNodeId || (currentHistoryNodeId === currentDisplayNodeId && !historyGroupExpanded))
      return
    const element = nodeCardRefs.current[currentDisplayNodeId]
    if (!element || typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver(() => {
      scheduleNodeScrollIntoView(currentDisplayNodeId)
    })
    observer.observe(element)
    return () => {
      try {
        observer.disconnect()
      }
      catch {
      }
    }
  }, [currentDisplayNodeId, currentHistoryNodeId, historyGroupExpanded])

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

  useEffect(() => {
    if (!execution) {
      resetPlaybackState()
      waitingResumeNodeIdRef.current = ''
      return
    }

    if (processedExecutionIdRef.current !== execution.id) {
      resetPlaybackState()
      processedExecutionIdRef.current = execution.id
    }

    const events = Array.isArray(execution.events) ? execution.events : []
    const nextEvents = events.slice(processedEventCountRef.current)
    if (nextEvents.length === 0)
      return

    processedEventCountRef.current = events.length
    setPendingPlaybackEvents(prev => [...prev, ...nextEvents])
  }, [execution])

  useEffect(() => {
    if (pendingPlaybackEvents.length === 0) {
      playbackActiveRef.current = false
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
      return
    }
    if (playbackTimerRef.current !== null)
      return

    const currentEvent = pendingPlaybackEvents[0]
    const isStepEvent = currentEvent.type === 'node.started' || currentEvent.type === 'node.finished'
    const delay = isStepEvent && playbackActiveRef.current ? 120 : 0

    playbackTimerRef.current = window.setTimeout(() => {
      playbackTimerRef.current = null
      playbackActiveRef.current = true

      const nextVisible = [...visibleNodeIdsRef.current]
      const visibleSet = new Set(nextVisible)
      const nextOpenPanels = { ...openPanelsRef.current }
      const nextAutoOpenedNodeIds = new Set(autoOpenedNodeIdsRef.current)
      let nextFocusedNodeId = focusedNodeIdRef.current
      let nextActiveNodeId = activeNodeIdRef.current

      if (currentEvent && typeof currentEvent.type === 'string') {
        const nodeId = typeof currentEvent.payload?.nodeId === 'string' ? currentEvent.payload.nodeId : ''
        if (nodeId) {
          if (!visibleSet.has(nodeId) && currentEvent.type.startsWith('node.') && currentEvent.type !== 'node.skipped') {
            visibleSet.add(nodeId)
            nextVisible.push(nodeId)
          }

          if (currentEvent.type === 'node.started') {
            if (waitingResumeNodeIdRef.current === nodeId)
              waitingResumeNodeIdRef.current = ''
            nextActiveNodeId = nodeId
            nextFocusedNodeId = nodeId
            const currentNode = nodeMap.get(nodeId)
            const autoOpenStartedNode = shouldAutoOpenNode(String(currentNode?.data.type || ''), 'running')
            Object.keys(nextOpenPanels).forEach((key) => {
              if (nextOpenPanels[key] && key !== nodeId)
                nextOpenPanels[key] = false
            })
            nextOpenPanels[nodeId] = autoOpenStartedNode
            if (nextAutoOpenedNodeIds.has(nodeId)) {
              nextAutoOpenedNodeIds.delete(nodeId)
            }
            if (currentNode?.data.type !== BlockEnum.End)
              setHistoryGroupExpanded(false)
            window.setTimeout(() => {
              scheduleNodeScrollIntoView(nodeId)
            }, 0)
          } else if (currentEvent.type === 'node.finished') {
            const finishedStatus = typeof currentEvent.payload?.status === 'string' ? currentEvent.payload.status : ''
            const node = nodeMap.get(nodeId)
            const isEndNode = node?.data.type === BlockEnum.End
            if (waitingResumeNodeIdRef.current === nodeId && finishedStatus !== 'waiting_input')
              waitingResumeNodeIdRef.current = ''
            if (nextActiveNodeId === nodeId)
              nextActiveNodeId = ''
            if (finishedStatus === 'waiting_input') {
              nextFocusedNodeId = nodeId
              Object.keys(nextOpenPanels).forEach((key) => {
                if (nextOpenPanels[key])
                  nextOpenPanels[key] = false
              })
              nextOpenPanels[nodeId] = true
              nextAutoOpenedNodeIds.add(nodeId)
            } else if (isEndNode && finishedStatus === 'succeeded') {
              nextFocusedNodeId = nodeId
              Object.keys(nextOpenPanels).forEach((key) => {
                if (nextOpenPanels[key])
                  nextOpenPanels[key] = false
              })
              nextOpenPanels[nodeId] = true
              nextAutoOpenedNodeIds.add(nodeId)
            } else if (finishedStatus === 'failed') {
              nextFocusedNodeId = nodeId
              Object.keys(nextOpenPanels).forEach((key) => {
                if (nextOpenPanels[key])
                  nextOpenPanels[key] = false
              })
              nextOpenPanels[nodeId] = true
              nextAutoOpenedNodeIds.add(nodeId)
            } else if (nextAutoOpenedNodeIds.has(nodeId)) {
              nextOpenPanels[nodeId] = false
              nextAutoOpenedNodeIds.delete(nodeId)
            }
          }
        }
      }

      visibleNodeIdsRef.current = nextVisible
      focusedNodeIdRef.current = nextFocusedNodeId
      activeNodeIdRef.current = nextActiveNodeId
      openPanelsRef.current = nextOpenPanels
      autoOpenedNodeIdsRef.current = nextAutoOpenedNodeIds
      setVisibleNodeIds(nextVisible)
      setFocusedNodeId(nextFocusedNodeId)
      setActiveNodeId(nextActiveNodeId)
      setOpenPanels(nextOpenPanels)
      const shouldExpandHistoryGroup = currentEvent.type === 'node.finished'
        && (typeof currentEvent.payload?.status === 'string'
          && currentEvent.payload.status === 'failed')
      if (shouldExpandHistoryGroup)
        setHistoryGroupExpanded(true)
      const scrollTargetNodeId = nextActiveNodeId || nextFocusedNodeId
      if (scrollTargetNodeId) {
        window.setTimeout(() => {
          const targetNode = nodeMap.get(scrollTargetNodeId)
          const shouldScrollGroupHeader = !!targetNode && targetNode.data.type !== BlockEnum.End && !historyGroupExpandedRef.current
          scheduleNodeScrollIntoView(shouldScrollGroupHeader ? '__history_group__' : scrollTargetNodeId)
        }, 0)
      }
      setPendingPlaybackEvents(prev => prev.slice(1))
    }, delay)

    return () => {
      if (playbackTimerRef.current !== null) {
        window.clearTimeout(playbackTimerRef.current)
        playbackTimerRef.current = null
      }
    }
  }, [pendingPlaybackEvents])

  useEffect(() => {
    if (!execution?.id || execution.status !== 'running') {
      stopExecutionStream()
      return
    }
    executionStreamIdRef.current = execution.id
    let cancelled = false
    const currentExecutionId = execution.id
    const token = resolveAuthToken()
    const headers: Record<string, string> = {}
    if (token)
      headers.Authorization = `Bearer ${token}`

    const applyExecutionSnapshot = (nextExecution: WorkflowExecution) => {
      const currentExecution = executionRef.current
      const hasExecutionChanged = currentExecution?.updatedAt !== nextExecution.updatedAt
        || currentExecution?.status !== nextExecution.status
        || (currentExecution?.events?.length ?? 0) !== (nextExecution.events?.length ?? 0)
      if (hasExecutionChanged)
        setExecution(nextExecution)
    }

    const syncExecutionSnapshot = async () => {
      try {
        const response = await fetch(`/api/workflow/executions/${currentExecutionId}`, {
          method: 'GET',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (response.status === 401) {
          router.push('/?redirect=/app/workflow')
          return false
        }
        const payload = await readWorkflowExecutionPayload(response)
        if (!response.ok || !payload.data)
          return true
        if (cancelled || executionStreamIdRef.current !== currentExecutionId)
          return false
        applyExecutionSnapshot(payload.data)
        return payload.data.status === 'running'
      }
      catch {
        return true
      }
    }

    const scheduleReconnect = (delay: number) => {
      if (cancelled || executionStreamIdRef.current !== currentExecutionId)
        return
      if (executionStreamReconnectTimerRef.current !== null)
        window.clearTimeout(executionStreamReconnectTimerRef.current)
      executionStreamReconnectTimerRef.current = window.setTimeout(() => {
        executionStreamReconnectTimerRef.current = null
        void connectExecutionStream()
      }, delay)
    }

    const handleStreamEvent = (eventName: string, dataText: string) => {
      if (eventName === 'execution.keepalive')
        return
      try {
        const payload = JSON.parse(dataText) as WorkflowExecution | { status?: string }
        if (eventName === 'execution.snapshot' && 'id' in payload)
          applyExecutionSnapshot(payload)
        if (eventName === 'execution.closed')
          executionStreamRetryRef.current = 0
      }
      catch {
      }
    }

    const consumeSSEChunk = (chunkText: string, state: { buffer: string }) => {
      state.buffer += chunkText.replace(/\r\n/g, '\n')
      let delimiterIndex = state.buffer.indexOf('\n\n')
      while (delimiterIndex >= 0) {
        const rawEvent = state.buffer.slice(0, delimiterIndex)
        state.buffer = state.buffer.slice(delimiterIndex + 2)
        delimiterIndex = state.buffer.indexOf('\n\n')
        const lines = rawEvent.split('\n')
        let eventName = 'message'
        const dataLines: string[] = []
        lines.forEach((line) => {
          const normalizedLine = line.replace(/\r$/, '')
          if (normalizedLine.startsWith('event:'))
            eventName = normalizedLine.slice(6).trim()
          else if (normalizedLine.startsWith('data:'))
            dataLines.push(normalizedLine.slice(5).trim())
        })
        if (dataLines.length > 0)
          handleStreamEvent(eventName, dataLines.join('\n'))
      }
    }

    const connectExecutionStream = async () => {
      if (cancelled || executionStreamIdRef.current !== currentExecutionId)
        return
      if (executionStreamAbortRef.current)
        executionStreamAbortRef.current.abort()
      const controller = new AbortController()
      executionStreamAbortRef.current = controller
      const decoder = new TextDecoder()
      const sseState = { buffer: '' }

      try {
        const response = await fetch(`/api/workflow/executions/${currentExecutionId}/stream`, {
          method: 'GET',
          credentials: 'include',
          headers,
          signal: controller.signal,
        })
        if (response.status === 401) {
          router.push('/?redirect=/app/workflow')
          return
        }
        if (!response.ok || !response.body)
          throw new Error('建立执行流失败')

        executionStreamRetryRef.current = 0
        const reader = response.body.getReader()
        while (!cancelled) {
          const { value, done } = await reader.read()
          if (done)
            break
          consumeSSEChunk(decoder.decode(value, { stream: true }), sseState)
          const latestExecution = executionRef.current
          if (!latestExecution || latestExecution.id !== currentExecutionId || latestExecution.status !== 'running')
            return
        }
      }
      catch (streamError) {
        if (controller.signal.aborted || cancelled)
          return
      }
      finally {
        if (executionStreamAbortRef.current === controller)
          executionStreamAbortRef.current = null
      }

      const shouldContinue = await syncExecutionSnapshot()
      if (!shouldContinue || cancelled || executionStreamIdRef.current !== currentExecutionId)
        return
      executionStreamRetryRef.current += 1
      const retryCount = executionStreamRetryRef.current
      scheduleReconnect(Math.min(5000, retryCount === 1 ? 1000 : retryCount === 2 ? 2000 : 5000))
    }

    void connectExecutionStream()

    return () => {
      cancelled = true
      if (executionStreamAbortRef.current) {
        executionStreamAbortRef.current.abort()
        executionStreamAbortRef.current = null
      }
      if (executionStreamReconnectTimerRef.current !== null) {
        window.clearTimeout(executionStreamReconnectTimerRef.current)
        executionStreamReconnectTimerRef.current = null
      }
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

  const promptMissingUserConfig = (missing: UserConfigFieldKey[]) => {
    if (missing.length === 0)
      return
    const missingLabels = missing
      .map(key => userConfigFields.find(item => item.key === key)?.label || key)
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
        setSubmitPhase('checking_user_config')
        const token = resolveAuthToken()
        if (!token) {
        setSubmitPhase('')
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
          setSubmitPhase('')
          router.push('/?redirect=/app/workflow')
          return
        }
        if (!response.ok)
          throw new Error(payload.message || '加载用户配置失败')
        const config = payload.data || { warningAccount: '', warningPassword: '', aiBaseUrl: '', aiApiKey: '' }
        const missing = requiredKeys.filter((key) => String((config as any)[key] ?? '').trim() === '')
        if (missing.length > 0) {
          promptMissingUserConfig(missing)
          setSubmitPhase('')
          return
        }
      }
      catch (requestError) {
        setSubmitPhase('')
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
    setSubmitPhase('submitting_start')
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
      const payload = await readWorkflowExecutionPayload(response)
      if (response.status === 401) {
        setSubmitPhase('')
        router.push('/?redirect=/app/workflow')
        return
      }
      if (!response.ok || !payload.data) {
        const backendMessage = payload.error || payload.message || '运行失败'
        const missing = parseMissingUserConfigKeysFromMessage(backendMessage)
        if (missing.length > 0) {
          setSubmitPhase('')
          promptMissingUserConfig(missing)
          return
        }
        throw new Error(backendMessage)
      }
      const executionData = payload.data
      resetPlaybackState()
      if ((executionData.events?.length ?? 0) === 0)
        bootstrapExecutionView(startNodeId)
      setExecution(executionData)
      setEndRendered({})
      setEndRenderLoading({})
      setEndRenderError({})
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '运行失败')
    }
    finally {
      setLoading(false)
      setSubmitPhase('')
    }
  }

  const restartWorkflow = () => {
    stopExecutionStream()
    setExecution(null)
    setLoading(false)
    setSubmitPhase('')
    setError('')
    setEndRendered({})
    setEndRenderLoading({})
    setEndRenderError({})
    setEndRenderedHeights({})
    resetPlaybackState()
    setAutoRunTriggered(false)
    waitingResumeNodeIdRef.current = ''
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
    const waitingRuleInputs = {
      ...waitingExternalRuleInputs,
      ...buildLocalRuleInputs(execution.waitingInput.nodeId, waitingInput),
    }
    const waitingValidateErrors = evaluateDynamicFieldValidations(waitingPreparedFields, waitingRuleInputs)
    const waitingValidation = validateDynamicInput(waitingFields, waitingInput, waitingFieldStates, waitingValidateErrors)
    if (!waitingValidation.ok) {
      setError(waitingValidation.message)
      return
    }
    setLoading(true)
    setSubmitPhase('submitting_waiting_input')
    setError('')
    waitingResumeNodeIdRef.current = execution.waitingInput.nodeId
    collapseNodePanel(execution.waitingInput.nodeId)
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
      const payload = await readWorkflowExecutionPayload(response)
      if (response.status === 401) {
        setSubmitPhase('')
        router.push('/?redirect=/app/workflow')
        return
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error || payload.message || '提交输入失败')
      const executionData = payload.data
      setExecution(executionData)
    }
    catch (requestError) {
      waitingResumeNodeIdRef.current = ''
      setError(requestError instanceof Error ? requestError.message : '提交输入失败')
    }
    finally {
      setLoading(false)
      setSubmitPhase('')
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

  const renderWorkflowNodeCard = (nodeId: string, options?: { forceOpen?: boolean, externalWaiting?: boolean }) => {
    if (!execution)
      return null
    const node = nodeMap.get(nodeId)
    const state = node ? execution.nodeStates[node.id] : undefined
    const runtimeState = state || (
      executionViewPhase === 'bootstrapping' && node?.id === startNodeId
        ? {
            nodeId: node.id,
            status: 'running' as RuntimeNodeStatus,
          }
        : undefined
    )
    if (!node || !runtimeState)
      return null
    if (runtimeState.status === 'skipped')
      return null
    const panelOpen = options?.forceOpen || (openPanels[node.id] ?? false)
    const status = runtimeState.status
    const rawNodeOutput = execution.variables[node.id]
    const nodeOutput = node.data.type === BlockEnum.End
      ? buildEndConfiguredOutput(node, execution.variables, rawNodeOutput)
      : rawNodeOutput
    const isWaitingCurrent = execution.waitingInput?.nodeId === node.id && status === 'waiting_input'
    const showRunningIcon = shouldShowRunningIcon(node.data.type, status, activeNodeId, node.id)
    const nodeConfig: Record<string, unknown> = isObject(node.data.config) ? node.data.config : {}
    const hasEndTemplate = node.data.type === BlockEnum.End && Number(nodeConfig.templateId ?? 0) > 0
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
      <div
        key={node.id}
        ref={el => bindNodeCardRef(node.id, el)}
        className={`rounded border ${options?.externalWaiting ? 'border-blue-200' : 'border-gray-200'}`}
      >
        <button
          ref={el => bindNodeHeaderRef(node.id, el)}
          type="button"
          onClick={() => {
            if (options?.externalWaiting)
              return
            autoOpenedNodeIdsRef.current.delete(node.id)
            setOpenPanels((prev) => {
              const nextOpen = !(prev[node.id] ?? false)
              const nextPanels = Object.keys(prev).reduce<Record<string, boolean>>((acc, key) => {
                if (key !== node.id && prev[key])
                  acc[key] = false
                return acc
              }, {})
              nextPanels[node.id] = nextOpen
              openPanelsRef.current = nextPanels
              return nextPanels
            })
            focusCurrentNode(node.id)
          }}
          className={`flex w-full items-center justify-between px-3 py-2 text-left ${options?.externalWaiting ? '' : 'hover:bg-gray-50'}`}
        >
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
            {showRunningIcon && (
              <span className="inline-flex h-4 w-4 items-center justify-center text-blue-600" aria-label="运行中">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              </span>
            )}
            <span className="shrink-0">{node.data.title}</span>
            {runtimeState.error && (
              <span className="min-w-0 truncate text-xs font-normal text-rose-600" title={runtimeState.error}>
                {runtimeState.error}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs ${statusClassMap[status]}`}>{statusTextMap[status]}</span>
            {!options?.externalWaiting && (
              <span className="text-xs text-gray-500">{panelOpen ? '收起' : '展开'}</span>
            )}
          </div>
        </button>

        {panelOpen && (
          <div className="space-y-2 border-t border-gray-200 px-3 py-3">
            {node.data.type === 'http-request' && (
              <>
                <div className="text-xs text-gray-500">请求配置</div>
                <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(renderHttpConfigForLog(nodeConfig, execution?.variables))}</pre>
              </>
            )}

            {isWaitingCurrent && (
              <div ref={(el) => { waitingFormRefs.current[node.id] = el }} className="space-y-2 rounded border border-gray-200 bg-white p-2">
                <div className="text-xs font-medium text-gray-800">节点等待输入，请提交后继续</div>
                {!!submitPhase && submitPhase === 'submitting_waiting_input' && (
                  <div className="rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                    正在提交当前输入并继续执行，请稍候。
                  </div>
                )}
                {!!waitingPrompt && (
                  <div className="whitespace-pre-wrap rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-800">
                    {waitingPrompt}
                  </div>
                )}
                <DynamicForm fieldStates={waitingFieldStates} values={waitingInput} onChange={setWaitingInput} />
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={submitWaitingInput}
                    disabled={loading}
                    className="rounded bg-blue-600 px-4 py-2 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {getWaitingSubmitButtonText()}
                  </button>
                </div>
              </div>
            )}

            {node.data.type === BlockEnum.End && hasEndTemplate && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-500">模板渲染</div>
                  {endRendered[node.id] && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => exportRenderedToPdf(node.id)} className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">导出 PDF（可复制）</button>
                      <button type="button" onClick={() => exportRenderedToHtml(node.id)} className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">导出 HTML</button>
                    </div>
                  )}
                </div>
                {endRenderLoading[node.id] && <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600">渲染中...</div>}
                {endRenderError[node.id] && <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{endRenderError[node.id]}</div>}
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
                                  } catch {}
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
                                  try { existing.disconnect() } catch {}
                                }
                                if (typeof ResizeObserver !== 'undefined') {
                                  const observer = new ResizeObserver(() => computeHeight())
                                  iframeResizeObserversRef.current[node.id] = observer
                                  observer.observe(docEl)
                                }
                              } catch {}
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

      <div ref={runScrollContainerRef} className="workflow-run-scroll min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="shrink-0">流程执行</span>
            {error && !execution && (
              <span
                className="min-w-0 truncate text-xs font-normal text-rose-600"
                title={error}
              >
                {error}
              </span>
            )}
          </div>
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
          <div ref={startFormRef} className="space-y-3 rounded border border-dashed border-gray-300 p-3">
            <div className="text-xs text-gray-600">开始/输入节点会在这里生成交互表单。填写后点击底部“提交并运行”。</div>
            {!!submitPhase && (
              <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                {submitPhase === 'checking_user_config' ? '正在检查运行配置，请稍候。' : '正在提交开始节点并启动流程，请稍候。'}
              </div>
            )}
            <DynamicForm fields={startFields} values={startInput} onChange={setStartInput} />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={runWorkflow}
                disabled={loading}
                className="rounded bg-violet-600 px-4 py-2 text-xs text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {getSubmitButtonText()}
              </button>
            </div>
          </div>
        )}

        {executionViewPhase === 'bootstrapping' && (
          <div className="mb-2 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            流程已启动，正在进入首个执行节点，请稍候。
          </div>
        )}

        {execution && executionViewPhase !== 'bootstrapping' && visibleNodeIds.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">暂无执行节点。</div>
        )}

        {execution && (
          <div className="space-y-2">
            {historyNodeIds.length > 0 && (
              <div className="rounded border border-gray-200">
                <button
                  ref={historyGroupHeaderRef}
                  type="button"
                  onClick={() => setHistoryGroupExpanded(prev => !prev)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
                >
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-800">
                    {currentHistoryNodeId && currentHistoryNode && currentHistoryNodeState && shouldShowRunningIcon(currentHistoryNode.data.type, currentHistoryNodeState.status, activeNodeId, currentHistoryNodeId) && (
                      <span className="inline-flex h-4 w-4 items-center justify-center text-blue-600" aria-label="运行中">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      </span>
                    )}
                    <span className="shrink-0">{currentHistoryNode?.data.title || '暂无执行节点'}</span>
                    {currentHistoryNodeState?.error && (
                      <span className="min-w-0 truncate text-xs font-normal text-rose-600" title={currentHistoryNodeState.error}>
                        {currentHistoryNodeState.error}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {currentHistoryNodeState && (
                      <span className={`rounded px-2 py-0.5 text-xs ${statusClassMap[currentHistoryNodeState.status]}`}>{statusTextMap[currentHistoryNodeState.status]}</span>
                    )}
                    <span className="text-xs text-gray-500">{historyGroupExpanded ? '收起历史节点' : '展开历史节点'}</span>
                  </div>
                </button>
                {historyGroupExpanded && (
                  <div className="space-y-2 border-t border-gray-200 px-3 py-3">
                    {historyNodeIds.map(nodeId => renderWorkflowNodeCard(nodeId))}
                  </div>
                )}
              </div>
            )}

            {!!waitingInputNodeId && (
              renderWorkflowNodeCard(waitingInputNodeId, { forceOpen: true, externalWaiting: true })
            )}

            {endNodeIds.map(nodeId => renderWorkflowNodeCard(nodeId))}
          </div>
        )}
      </div>

    </div>
  )
}

function DynamicForm({
  fields,
  fieldStates,
  values,
  onChange,
}: {
  fields?: DynamicField[]
  fieldStates?: DynamicFieldState[]
  values: Record<string, unknown>
  onChange: (nextValues: Record<string, unknown>) => void
}) {
  const normalizedStates = fieldStates ?? (fields ?? []).map(item => ({
    item,
    visible: true,
    visibleError: null,
    validateError: null,
  }))
  const visibleStates = normalizedStates.filter(state => state.visible)

  if (!visibleStates.length)
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
      {visibleStates.map((state) => {
        const field = state.item
        const label = `${field.label || field.name}${field.required ? ' *' : ''}`
        const help = state.visibleError || state.validateError || undefined
        const validateStatus = help ? 'error' : undefined
        if (field.type === 'checkbox') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} valuePropName="checked" help={help} validateStatus={validateStatus}>
              <Checkbox>勾选</Checkbox>
            </Form.Item>
          )
        }
        if (field.type === 'paragraph') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
            </Form.Item>
          )
        }
        if (field.type === 'number') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          )
        }
        if (field.type === 'select') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
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
          <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
            <Input />
          </Form.Item>
        )
      })}
    </Form>
  )
}
