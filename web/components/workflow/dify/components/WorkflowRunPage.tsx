'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ReactFlow, { Background, Controls, MiniMap, ReactFlowProvider } from 'reactflow'
import 'reactflow/dist/style.css'
import { CUSTOM_EDGE, CUSTOM_NODE } from '../core/constants'
import { ensureNodeConfig } from '../core/node-config'
import { edgeTypes, nodeTypes } from '../config/workflowPreset'
import { BlockEnum, NodeRunningStatus, type DifyEdge, type DifyNode, type IterationNodeConfig } from '../core/types'

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
  nodes: DifyNode[]
  edges: DifyEdge[]
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
  waiting_input: 'bg-amber-100 text-amber-700',
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
    return { border: '1.5px solid #f59e0b', background: '#fffbeb' }
  if (status === 'skipped')
    return { border: '1.5px solid #64748b', background: '#f8fafc' }
  return { border: '1px solid #d1d5db', background: '#ffffff' }
}

const normalizeStartFields = (nodes: DifyNode[]): DynamicField[] => {
  const startNode = nodes.find(node => node.data.type === 'start')
  const config = startNode?.data.config
  if (!startNode || !isObject(config))
    return []
  const rawVariables = (config as Record<string, unknown>).variables
  const raw = Array.isArray(rawVariables) ? rawVariables : []
  return raw.map((item) => {
    const entry = isObject(item) ? item : {}
    const type = typeof entry.type === 'string' ? entry.type : 'text-input'
    const optionsRaw = Array.isArray(entry.options) ? entry.options : []
    const options = optionsRaw
      .map((option) => {
        if (!isObject(option))
          return { label: '', value: '' }
        const label = typeof option.label === 'string' ? option.label : ''
        const value = typeof option.value === 'string' ? option.value : ''
        return { label, value }
      })
      .filter(option => option.label || option.value)
    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      label: typeof entry.label === 'string' ? entry.label : '',
      type: type === 'paragraph' ? 'paragraph' : type === 'number' ? 'number' : type === 'select' ? 'select' : type === 'checkbox' ? 'checkbox' : 'text',
      required: Boolean(entry.required),
      options,
      defaultValue: entry.defaultValue,
    } satisfies DynamicField
  }).filter(field => field.name)
}

const normalizeWaitingFields = (schema?: Record<string, unknown>): DynamicField[] => {
  if (!schema || !Array.isArray(schema.fields))
    return []
  return schema.fields.map((item) => {
    const entry = isObject(item) ? item : {}
    const optionsRaw = Array.isArray(entry.options) ? entry.options : []
    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      label: typeof entry.label === 'string' ? entry.label : '',
      type: entry.type === 'paragraph' ? 'paragraph' : entry.type === 'number' ? 'number' : entry.type === 'select' ? 'select' : entry.type === 'checkbox' ? 'checkbox' : 'text',
      required: Boolean(entry.required),
      options: optionsRaw.map(option => {
        const value = String(option ?? '')
        return { label: value, value }
      }),
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

export default function WorkflowRunPage({ nodes, edges }: WorkflowRunPageProps) {
  return (
    <ReactFlowProvider>
      <WorkflowRunPageInner nodes={nodes} edges={edges} />
    </ReactFlowProvider>
  )
}

function WorkflowRunPageInner({ nodes, edges }: WorkflowRunPageProps) {
  const router = useRouter()
  const [execution, setExecution] = useState<WorkflowExecution | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [loginForm, setLoginForm] = useState({ username: 'developer', password: '123456' })
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [expandedPanels, setExpandedPanels] = useState<Record<string, boolean>>({})
  const startFields = useMemo(() => normalizeStartFields(nodes), [nodes])
  const [startInput, setStartInput] = useState<Record<string, unknown>>({})
  const waitingFields = useMemo(() => normalizeWaitingFields(execution?.waitingInput?.schema), [execution?.waitingInput?.schema])
  const [waitingInput, setWaitingInput] = useState<Record<string, unknown>>({})

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
    if (!execution || typeof window === 'undefined')
      return
    window.localStorage.setItem('workflow_last_execution', JSON.stringify({
      id: execution.id,
      status: execution.status,
      updatedAt: execution.updatedAt,
    }))
  }, [execution])

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
      viewport: { x: 0, y: 0, zoom: 1 },
    }
  }, [edges, nodes])

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
    return renderPreviewGraph.edges.map(edge => ({
      ...edge,
      type: CUSTOM_EDGE,
      data: {
        ...(edge.data ?? {}),
        _sourceRunningStatus: (() => {
          const sourceStatus = nodeStates[edge.source]?.status
          const targetStatus = nodeStates[edge.target]?.status
          if (!isNodeEntered(sourceStatus))
            return NodeRunningStatus.Idle

          const sourceNodeType = nodeMap.get(edge.source)?.data.type
          if (sourceNodeType === BlockEnum.IfElse) {
            const chosenHandle = branchHandleByNode.get(edge.source)
            if (!chosenHandle)
              return isNodeEntered(targetStatus) ? mapNodeStatus(edge.source) : NodeRunningStatus.Idle
            return edge.sourceHandle === chosenHandle ? mapNodeStatus(edge.source) : NodeRunningStatus.Idle
          }

          return isNodeEntered(targetStatus) ? mapNodeStatus(edge.source) : NodeRunningStatus.Idle
        })(),
        _targetRunningStatus: (() => {
          const sourceStatus = nodeStates[edge.source]?.status
          const targetStatus = nodeStates[edge.target]?.status
          if (!isNodeEntered(sourceStatus))
            return NodeRunningStatus.Idle

          const sourceNodeType = nodeMap.get(edge.source)?.data.type
          if (sourceNodeType === BlockEnum.IfElse) {
            const chosenHandle = branchHandleByNode.get(edge.source)
            if (!chosenHandle)
              return isNodeEntered(targetStatus) ? mapNodeStatus(edge.target) : NodeRunningStatus.Idle
            return edge.sourceHandle === chosenHandle ? mapNodeStatus(edge.target) : NodeRunningStatus.Idle
          }

          return isNodeEntered(targetStatus) ? mapNodeStatus(edge.target) : NodeRunningStatus.Idle
        })(),
      },
    }))
  }, [execution?.events, execution?.nodeStates, renderPreviewGraph.edges, renderPreviewGraph.nodes])

  const enteredNodes = useMemo(() => {
    if (!execution)
      return []
    return nodes
      .map((node) => {
        const state = execution.nodeStates[node.id]
        return { node, state }
      })
      .filter(item => item.state && item.state.status !== 'pending')
      .sort((a, b) => {
        const at = a.state?.startedAt ? new Date(a.state.startedAt).getTime() : Number.MAX_SAFE_INTEGER
        const bt = b.state?.startedAt ? new Date(b.state.startedAt).getTime() : Number.MAX_SAFE_INTEGER
        return at - bt
      })
  }, [execution, nodes])

  const runWorkflow = async () => {
    setLoading(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (authToken.trim())
        headers.Authorization = `Bearer ${authToken.trim()}`
      const response = await fetch('/workflow-api/executions', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          workflowDsl: runtimeDsl,
          input: startInput,
        }),
      })
      const payload = await response.json() as { data?: WorkflowExecution; error?: string }
      if (response.status === 401) {
        router.push('/login?redirect=/app/workflow')
        return
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error || '运行失败')
      const executionData = payload.data
      setExecution(executionData)
      const opened: Record<string, boolean> = {}
      Object.keys(executionData.nodeStates).forEach((nodeId) => {
        if (executionData.nodeStates[nodeId]?.status !== 'pending')
          opened[nodeId] = true
      })
      setExpandedPanels(opened)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '运行失败')
    }
    finally {
      setLoading(false)
    }
  }

  const submitWaitingInput = async () => {
    if (!execution?.waitingInput)
      return
    setLoading(true)
    setError('')
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (authToken.trim())
        headers.Authorization = `Bearer ${authToken.trim()}`
      const response = await fetch(`/workflow-api/executions/${execution.id}/resume`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          nodeId: execution.waitingInput.nodeId,
          input: waitingInput,
        }),
      })
      const payload = await response.json() as { data?: WorkflowExecution; error?: string }
      if (response.status === 401) {
        router.push('/login?redirect=/app/workflow')
        return
      }
      if (!response.ok || !payload.data)
        throw new Error(payload.error || '提交输入失败')
      const executionData = payload.data
      setExecution(executionData)
      setExpandedPanels(prev => ({
        ...prev,
        [execution.waitingInput!.nodeId]: true,
      }))
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '提交输入失败')
    }
    finally {
      setLoading(false)
    }
  }

  const login = async () => {
    setLoginLoading(true)
    setLoginError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const payload = await response.json() as {
        data?: { accessToken?: string; user?: { role?: string } }
        message?: string
      }
      if (!response.ok || !payload.data?.accessToken)
        throw new Error(payload.message || '登录失败')
      setAuthToken(payload.data.accessToken)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('sxfg_access_token', payload.data.accessToken)
        const role = payload.data.user?.role === 'admin' || payload.data.user?.role === 'user'
          ? payload.data.user.role
          : 'guest'
        window.localStorage.setItem('sxfg_user_role', role)
        window.localStorage.setItem('user_role', role)
      }
    }
    catch (requestError) {
      setLoginError(requestError instanceof Error ? requestError.message : '登录失败')
    }
    finally {
      setLoginLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">流程缩略图</div>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
          >
            放大查看
          </button>
        </div>
        <div className="h-[220px] overflow-hidden rounded border border-gray-200">
          <ReactFlow
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodes={previewNodes}
            edges={previewEdges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
          >
            <MiniMap pannable zoomable style={{ width: 96, height: 64 }} />
            <Controls showInteractive={false} />
            <Background gap={14} size={1.5} />
          </ReactFlow>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-semibold text-gray-700">登录（用于后端鉴权场景）</div>
          <div className="grid grid-cols-12 gap-2">
            <input
              className="col-span-3 rounded border border-gray-300 px-2 py-1.5 text-xs"
              placeholder="用户名"
              value={loginForm.username}
              onChange={event => setLoginForm(prev => ({ ...prev, username: event.target.value }))}
            />
            <input
              className="col-span-3 rounded border border-gray-300 px-2 py-1.5 text-xs"
              type="password"
              placeholder="密码"
              value={loginForm.password}
              onChange={event => setLoginForm(prev => ({ ...prev, password: event.target.value }))}
            />
            <button
              type="button"
              onClick={login}
              disabled={loginLoading}
              className="col-span-2 rounded bg-gray-800 px-2 py-1.5 text-xs text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loginLoading ? '登录中...' : '登录获取令牌'}
            </button>
            <input
              className="col-span-4 rounded border border-gray-300 px-2 py-1.5 text-xs"
              placeholder="Access Token（可直接粘贴）"
              value={authToken}
              onChange={(event) => {
                const token = event.target.value
                setAuthToken(token)
                if (typeof window !== 'undefined')
                  window.localStorage.setItem('sxfg_access_token', token)
              }}
            />
          </div>
          {loginError && <div className="mt-2 text-xs text-rose-600">{loginError}</div>}
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">流程执行</div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
              状态：{execution ? execution.status : '未运行'}
            </span>
            <button
              type="button"
              onClick={runWorkflow}
              disabled={loading}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {loading ? '运行中...' : execution ? '重新运行' : '开始运行'}
            </button>
          </div>
        </div>

        {!execution && (
          <div className="space-y-3 rounded border border-dashed border-gray-300 p-3">
            <div className="text-xs text-gray-600">开始/输入节点会在这里生成交互表单。先配置开始参数后点击“开始运行”。</div>
            <DynamicForm fields={startFields} values={startInput} onChange={setStartInput} />
          </div>
        )}

        {error && <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

        {execution && enteredNodes.length === 0 && (
          <div className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">暂无执行节点。</div>
        )}

        {execution && (
          <div className="space-y-2">
            {enteredNodes.map(({ node, state }) => {
              const panelOpen = !!expandedPanels[node.id]
              const status = state.status
              const nodeOutput = execution.variables[node.id]
              const isWaitingCurrent = execution.waitingInput?.nodeId === node.id && status === 'waiting_input'
              const nodeConfig: Record<string, unknown> = isObject(node.data.config) ? node.data.config : {}

              return (
                <div key={node.id} className="rounded border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setExpandedPanels(prev => ({ ...prev, [node.id]: !panelOpen }))}
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
                          <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson({
                            method: nodeConfig.method,
                            url: nodeConfig.url,
                            query: nodeConfig.query,
                            headers: nodeConfig.headers,
                            bodyType: nodeConfig.bodyType,
                            body: nodeConfig.body,
                          })}</pre>
                        </>
                      )}

                      {isWaitingCurrent && (
                        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-2">
                          <div className="text-xs font-medium text-amber-800">节点等待输入，请提交后继续</div>
                          <DynamicForm fields={waitingFields} values={waitingInput} onChange={setWaitingInput} />
                          <button
                            type="button"
                            onClick={submitWaitingInput}
                            disabled={loading}
                            className="rounded bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            提交并继续
                          </button>
                        </div>
                      )}

                      <div className="text-xs text-gray-500">节点输出</div>
                      <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(nodeOutput)}</pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="h-[86vh] w-[90vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="text-sm font-semibold text-gray-900">流程放大图</div>
              <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs" onClick={() => setPreviewOpen(false)}>关闭</button>
            </div>
            <div className="h-[calc(86vh-52px)]">
              <ReactFlow
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodes={previewNodes}
                edges={previewEdges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
              >
                <MiniMap pannable zoomable style={{ width: 120, height: 80 }} />
                <Controls showInteractive={false} />
                <Background gap={14} size={1.5} />
              </ReactFlow>
            </div>
          </div>
        </div>
      )}
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
    return <div className="text-xs text-gray-500">当前无可配置字段。</div>

  const inputClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
  return (
    <div className="space-y-2">
      {fields.map((field) => {
        const value = values[field.name] ?? ''
        return (
          <div key={field.name} className="space-y-1">
            <label className="block text-xs text-gray-600">
              {field.label || field.name}
              {field.required ? ' *' : ''}
            </label>

            {field.type === 'paragraph' && (
              <textarea
                className={`${inputClass} h-24`}
                value={String(value)}
                onChange={event => onChange({ ...values, [field.name]: event.target.value })}
              />
            )}

            {field.type === 'number' && (
              <input
                className={inputClass}
                type="number"
                value={String(value)}
                onChange={event => onChange({ ...values, [field.name]: event.target.value })}
              />
            )}

            {field.type === 'select' && (
              <select
                className={inputClass}
                value={String(value)}
                onChange={event => onChange({ ...values, [field.name]: event.target.value })}
              >
                <option value="">请选择</option>
                {field.options.map(option => (
                  <option key={`${field.name}-${option.value}`} value={option.value}>
                    {option.label || option.value}
                  </option>
                ))}
              </select>
            )}

            {field.type === 'checkbox' && (
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={event => onChange({ ...values, [field.name]: event.target.checked })}
                />
                勾选
              </label>
            )}

            {(field.type === 'text') && (
              <input
                className={inputClass}
                value={String(value)}
                onChange={event => onChange({ ...values, [field.name]: event.target.value })}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
