'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import CustomConnectionLine from './dify/components/CustomConnectionLine'
import DSLModals from './dify/components/DSLModals'
import AINodeGenerateModal from './dify/components/AINodeGenerateModal'
import NodeConfigPanel from './dify/components/NodeConfigPanel'
import WorkflowEditor from './dify/components/WorkflowEditor'
import WorkflowToolbar from './dify/components/WorkflowToolbar'
import WorkflowRunModal from './dify/components/WorkflowRunModal'
import { demoDSL, nodeTypeLabel } from './dify/config/workflowPreset'
import {
  CUSTOM_EDGE,
  CUSTOM_NODE,
  ITERATION_CHILDREN_Z_INDEX,
  ITERATION_CONTAINER_PADDING_X,
  ITERATION_CONTAINER_PADDING_Y,
} from './dify/core/constants'
import { ensureNodeConfig } from './dify/core/node-config'
import { BlockEnum, type DifyEdge, type DifyNode, type DifyNodeConfig, type WorkflowParameter } from './dify/core/types'
import { validateWorkflow } from './dify/core/validation'
import { buildWorkflowVariableOptions } from './dify/core/variables'
import { useClipboardInteractions } from './dify/hooks/useClipboardInteractions'
import { useContextMenuInteractions } from './dify/hooks/useContextMenuInteractions'
import { useDSLActions } from './dify/hooks/useDSLActions'
import { useHistoryActions } from './dify/hooks/useHistoryActions'
import { useKeyboardShortcuts } from './dify/hooks/useKeyboardShortcuts'
import { useWorkflowCanvasState } from './dify/hooks/useWorkflowCanvasState'
import { useNodeActions } from './dify/hooks/useNodeActions'
import { useSelectionInteractions } from './dify/hooks/useSelectionInteractions'
import { buildIterationNestedNodeId, parseDifyWorkflowDSL, serializeWorkflowDSL } from './dify/core/dsl'
import type { DifyWorkflowDSL } from './dify/core/types'
import { IF_ELSE_FALLBACK_HANDLE, parseIfElseBranchIndex } from '@/lib/workflow-ifelse'
import {
  useWorkflowClipboardStore,
  useWorkflowHistoryStore,
  useWorkflowMenuStore,
} from './dify/hooks/useWorkflowStoreSelectors'

const ITERATION_CONTAINER_MIN_WIDTH = 760
const ITERATION_CONTAINER_MIN_HEIGHT = 420
const ITERATION_CONTAINER_COLLAPSED_WIDTH = 320
const ITERATION_CONTAINER_COLLAPSED_HEIGHT = 120
const ITERATION_CHILD_NODE_ESTIMATED_WIDTH = 240
const ITERATION_CHILD_NODE_ESTIMATED_HEIGHT = 130
const NODE_INSERT_X_GAP = 320
const NODE_INSERT_Y_GAP = 140
const NODE_COLLISION_X_THRESHOLD = 260
const NODE_COLLISION_Y_THRESHOLD = 110
const WORKFLOW_PERF_DEBUG = false

type PerfToken = {
  label: string
  startedAt: number
}

const startPerfMeasure = (label: string): PerfToken | null => {
  if (!WORKFLOW_PERF_DEBUG || typeof performance === 'undefined')
    return null
  return {
    label,
    startedAt: performance.now(),
  }
}

const endPerfMeasure = (token: PerfToken | null, extra?: Record<string, unknown>) => {
  if (!token || typeof performance === 'undefined')
    return
  const duration = performance.now() - token.startedAt
  const suffix = extra ? ` ${JSON.stringify(extra)}` : ''
  console.log(`[workflow-perf] ${token.label}: ${duration.toFixed(2)}ms${suffix}`)
}

const sortIfElseEdges = (edges: DifyEdge[]) => {
  const order = (edge: DifyEdge) => {
    if (edge.sourceHandle === IF_ELSE_FALLBACK_HANDLE)
      return 10000
    const index = parseIfElseBranchIndex(edge.sourceHandle)
    if (index >= 0)
      return index
    if (!edge.sourceHandle)
      return 9000
    return 9500
  }
  return [...edges].sort((a, b) => order(a) - order(b))
}

const autoLayoutNodes = (nodes: DifyNode[], edges: DifyEdge[]) => {
  const filteredNodes = nodes.filter(node => !getParentIterationId(node))
  if (filteredNodes.length === 0)
    return nodes

  const nodeById = new Map(filteredNodes.map(node => [node.id, node]))
  const outgoing = new Map<string, DifyEdge[]>()
  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target))
      return
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
  })

  const startNode = filteredNodes.find(node => node.data.type === BlockEnum.Start) ?? filteredNodes[0]
  const getOutgoing = (nodeId: string) => {
    const list = outgoing.get(nodeId) ?? []
    const node = nodeById.get(nodeId)
    if (node?.data.type === BlockEnum.IfElse)
      return sortIfElseEdges(list)
    return list
  }

  const visitOrder = new Map<string, number>()
  {
    let cursor = 0
    const queue: string[] = [startNode.id]
    const visited = new Set<string>()
    while (queue.length > 0) {
      const nodeId = queue.shift()
      if (!nodeId || visited.has(nodeId))
        continue
      visited.add(nodeId)
      visitOrder.set(nodeId, cursor)
      cursor += 1
      getOutgoing(nodeId).forEach((edge) => {
        if (!visited.has(edge.target))
          queue.push(edge.target)
      })
    }
  }

  const level = new Map<string, number>()
  {
    level.set(startNode.id, 0)
    const queue: string[] = [startNode.id]
    while (queue.length > 0) {
      const source = queue.shift()
      if (!source)
        continue
      const base = level.get(source) ?? 0
      getOutgoing(source).forEach((edge) => {
        const next = base + 1
        const current = level.get(edge.target)
        if (current === undefined || next > current) {
          level.set(edge.target, next)
          queue.push(edge.target)
        }
      })
    }

    let maxLevel = 0
    level.forEach(v => { maxLevel = Math.max(maxLevel, v) })
    filteredNodes.forEach((node) => {
      if (level.has(node.id))
        return
      maxLevel += 1
      level.set(node.id, maxLevel)
    })
  }

  const groups = new Map<number, DifyNode[]>()
  filteredNodes.forEach((node) => {
    const lv = level.get(node.id) ?? 0
    groups.set(lv, [...(groups.get(lv) ?? []), node])
  })

  const levels = [...groups.keys()].sort((a, b) => a - b)
  const xGap = 320
  const yGap = 170
  const baseX = startNode.position.x
  const baseY = startNode.position.y

  const nextPos = new Map<string, { x: number; y: number }>()
  levels.forEach((lv) => {
    const list = groups.get(lv) ?? []
    const sorted = [...list].sort((a, b) => {
      const ao = visitOrder.get(a.id)
      const bo = visitOrder.get(b.id)
      if (ao !== undefined && bo !== undefined)
        return ao - bo
      if (ao !== undefined)
        return -1
      if (bo !== undefined)
        return 1
      return a.position.y - b.position.y
    })
    sorted.forEach((node, index) => {
      nextPos.set(node.id, { x: baseX + lv * xGap, y: baseY + index * yGap })
    })
  })

  return nodes.map((node) => {
    const pos = nextPos.get(node.id)
    if (!pos)
      return node
    return {
      ...node,
      position: pos,
    }
  })
}

const isNestedNode = (node: DifyNode | null | undefined) => Boolean(node?.data.parentIterationId || node?.parentNode)
const getParentIterationId = (node: DifyNode | null | undefined) => node?.data.parentIterationId || node?.parentNode || null
const isIterationEntryNode = (node: DifyNode | null | undefined) => Boolean(node?.data.parentIterationId && node?.data.isIterationEntry)
const isNestedIterationEndNode = (node: DifyNode | null | undefined) => Boolean(node?.data.parentIterationId && node?.data.type === BlockEnum.End)

const resolveNonOverlappingNodePosition = (nodes: DifyNode[], baseX: number, baseY: number) => {
  const isOccupied = (x: number, y: number) => nodes.some((item) => {
    return Math.abs(item.position.x - x) < NODE_COLLISION_X_THRESHOLD
      && Math.abs(item.position.y - y) < NODE_COLLISION_Y_THRESHOLD
  })
  if (!isOccupied(baseX, baseY))
    return { x: baseX, y: baseY }
  for (let i = 1; i <= 120; i += 1) {
    const nextY = baseY + i * NODE_INSERT_Y_GAP
    if (!isOccupied(baseX, nextY))
      return { x: baseX, y: nextY }
  }
  return { x: baseX, y: baseY + NODE_INSERT_Y_GAP }
}

const resolveInsertPosition = (nodes: DifyNode[], activeNode: DifyNode | null) => {
  const fallbackX = 220 + (nodes.length % 5) * 180
  const fallbackY = 90 + (nodes.length % 4) * 120
  if (!activeNode)
    return resolveNonOverlappingNodePosition(nodes, fallbackX, fallbackY)
  if (isNestedNode(activeNode))
    return resolveNonOverlappingNodePosition(nodes, fallbackX, fallbackY)
  const source = nodes.find(item => item.id === activeNode.id)
  if (!source)
    return resolveNonOverlappingNodePosition(nodes, fallbackX, fallbackY)
  return resolveNonOverlappingNodePosition(
    nodes,
    source.position.x + NODE_INSERT_X_GAP,
    source.position.y,
  )
}

const buildIterationContainerLayout = (children: DifyNode[], manualSize?: { width?: number; height?: number }) => {
  const maxX = children.reduce((acc, item) => Math.max(acc, item.position.x), 0)
  const maxY = children.reduce((acc, item) => Math.max(acc, item.position.y), 0)
  const contentWidth = Math.max(ITERATION_CONTAINER_MIN_WIDTH, maxX + ITERATION_CONTAINER_PADDING_X + ITERATION_CHILD_NODE_ESTIMATED_WIDTH)
  const contentHeight = Math.max(ITERATION_CONTAINER_MIN_HEIGHT, maxY + ITERATION_CONTAINER_PADDING_Y + ITERATION_CHILD_NODE_ESTIMATED_HEIGHT)
  return {
    width: Math.max(contentWidth, manualSize?.width ?? 0),
    height: Math.max(contentHeight, manualSize?.height ?? 0),
    paddingX: ITERATION_CONTAINER_PADDING_X,
    paddingY: ITERATION_CONTAINER_PADDING_Y,
  }
}

type WorkflowCanvasInnerProps = {
  initialDSL: DifyWorkflowDSL
  workflowId?: number
  onDSLChange?: (dsl: DifyWorkflowDSL) => void
  onSave?: () => void
  apiRef?: React.Ref<WorkflowCanvasHandle>
}

type WorkflowRunSnapshot = {
  workflowId?: number
  nodes: DifyNode[]
  edges: DifyEdge[]
  workflowParameters: WorkflowParameter[]
}

type SystemModelOption = {
  name: string
  label: string
  enabled: boolean
}

type SystemConfigDTO = {
  models: SystemModelOption[]
  defaultModel: string
  codeDefaultModel: string
}

export type WorkflowCanvasHandle = {
  flushActiveNode: () => void
  getDSL: () => DifyWorkflowDSL
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

function WorkflowCanvasInner({ initialDSL, workflowId, onDSLChange, onSave, apiRef }: WorkflowCanvasInnerProps) {
  const [runModalOpen, setRunModalOpen] = useState(false)
  const [runSnapshot, setRunSnapshot] = useState<WorkflowRunSnapshot>({ workflowId, nodes: [], edges: [], workflowParameters: [] })
  const [nodesForPanel, setNodesForPanel] = useState<DifyNode[]>([])
  const [llmModelOptions, setLLMModelOptions] = useState<Array<{ name: string; label: string }>>([{ name: 'gpt-4o-mini', label: 'GPT-4o mini' }])
  const [defaultLLMModel, setDefaultLLMModel] = useState('gpt-4o-mini')
  const [defaultCodeModel, setDefaultCodeModel] = useState('gpt-4o-mini')
  const [aiNodeGenerateOpen, setAINodeGenerateOpen] = useState(false)
  const [collapsedIterationIds, setCollapsedIterationIds] = useState<Record<string, boolean>>({})
  const latestNodesRef = useRef<DifyNode[]>([])
  const latestEdgesRef = useRef<DifyEdge[]>([])
  const latestWorkflowParametersRef = useRef<WorkflowParameter[]>([])
  const latestActiveNodeRef = useRef<DifyNode | null>(null)
  const lastReportedDSLRef = useRef('')
  const dragRecordPendingRef = useRef(false)
  const renderedNodeCacheRef = useRef(new Map<string, {
    sourceNode: DifyNode
    parentIterationId: string | null
    collapsed: boolean
    width?: number
    height?: number
    rendered: DifyNode
  }>())
  const renderedEdgeCacheRef = useRef(new Map<string, {
    sourceEdge: DifyEdge
    parentIterationId: string | null
    rendered: DifyEdge
  }>())
  const iterationToggleHandlerRef = useRef<Record<string, () => void>>({})
  const iterationResizeHandlerRef = useRef<Record<string, (size: { width: number; height: number }, finalize?: boolean) => void>>({})
  const {
    parsed,
    nodes,
    edges,
    activeNode,
    importOpen,
    exportOpen,
    globalVariableOpen,
    workflowParamsOpen,
    checklistOpen,
    importText,
    exportText,
    globalVariables,
    workflowParameters,
    workflowVariableScopes,
    canvasContainerRef,
    idRef,
    setNodes,
    setEdges,
    setActiveNode,
    setImportOpen,
    setExportOpen,
    setGlobalVariableOpen,
    setWorkflowParamsOpen,
    setChecklistOpen,
    setImportText,
    setExportText,
    setGlobalVariables,
    setWorkflowParameters,
    setWorkflowVariableScopes,
  } = useWorkflowCanvasState(initialDSL)

  const { fitView, setViewport, getViewport } = useReactFlow()

  const { canUndo, canRedo, record, undo, redo, resetHistory } = useWorkflowHistoryStore()
  const {
    nodeMenu,
    edgeMenu,
    panelMenu,
    selectionMenu,
    setNodeMenu,
    setEdgeMenu,
    setPanelMenu,
    setSelectionMenu,
    clearMenus,
  } = useWorkflowMenuStore()
  const { clipboard, setClipboard } = useWorkflowClipboardStore()

  useEffect(() => {
    resetHistory({ nodes: parsed.nodes, edges: parsed.edges })
  }, [parsed.edges, parsed.nodes, resetHistory])

  useEffect(() => {
    latestNodesRef.current = nodes
    latestEdgesRef.current = edges
    latestWorkflowParametersRef.current = workflowParameters
    latestActiveNodeRef.current = activeNode
  }, [activeNode, edges, nodes, workflowParameters])

  useEffect(() => {
    setCollapsedIterationIds((current) => {
      const validIds = new Set(nodes.filter(node => node.data.type === BlockEnum.Iteration).map(node => node.id))
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id)))
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [nodes])

  useEffect(() => {
    const run = async () => {
      const token = getToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token)
        headers.Authorization = `Bearer ${token}`
      try {
        const response = await fetch('/api/system-config', {
          method: 'GET',
          headers,
          credentials: 'include',
        })
        if (!response.ok)
          return
        const payload = await response.json() as { data?: SystemConfigDTO }
        const rawModels = Array.isArray(payload?.data?.models) ? payload.data.models : []
        const enabled = rawModels
          .map(item => ({
            name: String(item?.name || '').trim(),
            label: String(item?.label || '').trim(),
            enabled: Boolean(item?.enabled),
          }))
          .filter(item => item.name && item.enabled)
        if (enabled.length === 0)
          return
        const options = enabled.map(item => ({ name: item.name, label: item.label || item.name }))
        const optionNames = new Set(options.map(item => item.name))
        const fallbackDefault = options[0].name
        const nextDefault = optionNames.has(String(payload?.data?.defaultModel || '').trim())
          ? String(payload?.data?.defaultModel || '').trim()
          : fallbackDefault
        const nextCodeDefault = optionNames.has(String(payload?.data?.codeDefaultModel || '').trim())
          ? String(payload?.data?.codeDefaultModel || '').trim()
          : nextDefault
        setLLMModelOptions(options)
        setDefaultLLMModel(nextDefault)
        setDefaultCodeModel(nextCodeDefault)
      }
      catch {
      }
    }
    run()
  }, [])

  useEffect(() => {
    setNodesForPanel((prev) => {
      if (prev.length !== nodes.length)
        return nodes
      const prevByID = new Map(prev.map(node => [node.id, node]))
      for (const node of nodes) {
        const old = prevByID.get(node.id)
        if (!old)
          return nodes
        if (old.type !== node.type)
          return nodes
        if (old.parentNode !== node.parentNode)
          return nodes
        if (old.data !== node.data)
          return nodes
      }
      return prev
    })
  }, [nodes])

  useEffect(() => {
    const openRunModal = () => {
      const serialized = serializeWorkflowDSL({
        nodes: latestNodesRef.current,
        edges: latestEdgesRef.current,
        workflowParameters: latestWorkflowParametersRef.current,
      } as DifyWorkflowDSL)
      setRunSnapshot({
        workflowId,
        nodes: JSON.parse(JSON.stringify(serialized.nodes)) as DifyNode[],
        edges: JSON.parse(JSON.stringify(serialized.edges)) as DifyEdge[],
        workflowParameters: JSON.parse(JSON.stringify(latestWorkflowParametersRef.current)) as WorkflowParameter[],
      })
      setRunModalOpen(true)
    }
    window.addEventListener('workflow-open-run', openRunModal)

    const params = new URLSearchParams(window.location.search)
    if (params.get('run') === '1') {
      const serialized = serializeWorkflowDSL({
        nodes: latestNodesRef.current,
        edges: latestEdgesRef.current,
        workflowParameters: latestWorkflowParametersRef.current,
      } as DifyWorkflowDSL)
      setRunSnapshot({
        workflowId,
        nodes: JSON.parse(JSON.stringify(serialized.nodes)) as DifyNode[],
        edges: JSON.parse(JSON.stringify(serialized.edges)) as DifyEdge[],
        workflowParameters: JSON.parse(JSON.stringify(latestWorkflowParametersRef.current)) as WorkflowParameter[],
      })
      setRunModalOpen(true)
      params.delete('run')
      const search = params.toString()
      const nextUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    return () => {
      window.removeEventListener('workflow-open-run', openRunModal)
    }
  }, [])

  const { doUndo, doRedo } = useHistoryActions({
    undo,
    redo,
    setNodes,
    setEdges,
  })

  const { addNode, saveNode } = useNodeActions({
    nodes,
    edges,
    activeNode,
    idRef,
    nodeTypeLabel,
    defaultLLMModel,
    setNodes,
    record,
  })

  const { importDSL, exportDSL, reset } = useDSLActions({
    nodes,
    edges,
    importText,
    globalVariables,
    workflowParameters,
    workflowVariableScopes,
    demoDSL: initialDSL,
    setNodes,
    setEdges,
    setGlobalVariables,
    setWorkflowParameters,
    setWorkflowVariableScopes,
    setImportOpen,
    setExportOpen,
    setImportText,
    setExportText,
    resetHistory,
    fitView,
    setViewport,
    getViewport,
  })

  const { selectedNodesCount, alignSelection } = useSelectionInteractions({
    nodes,
    edges,
    setNodes,
    record,
  })
  const { copySelection, pasteClipboard, deleteSelection, duplicateSelection } = useClipboardInteractions({
    nodes,
    edges,
    clipboard,
    setNodes,
    setEdges,
    setClipboard,
    record,
  })

  const { handleNodeContextMenu, handleEdgeContextMenu, handlePaneContextMenu } = useContextMenuInteractions({
    canvasContainerRef,
    selectedNodesCount,
    clearMenus,
    setNodeMenu,
    setEdgeMenu,
    setPanelMenu,
    setSelectionMenu,
  })

  useKeyboardShortcuts({
    canvasContainerRef,
    doUndo,
    doRedo,
    copySelection: () => copySelection(),
    pasteClipboard: () => pasteClipboard(),
    duplicateSelection: () => duplicateSelection(),
    deleteSelection: () => deleteSelection(),
    saveWorkflow: onSave,
  })
  const issues = useMemo(() => {
    const perfToken = startPerfMeasure('validateWorkflow')
    const result = validateWorkflow(nodesForPanel, edges, workflowParameters)
    endPerfMeasure(perfToken, {
      nodeCount: nodesForPanel.length,
      edgeCount: edges.length,
      issueCount: result.length,
    })
    return result
  }, [edges, nodesForPanel, workflowParameters])
  const aiVariableOptions = useMemo(
    () => {
      const perfToken = startPerfMeasure('buildWorkflowVariableOptions')
      const result = buildWorkflowVariableOptions(nodesForPanel, workflowParameters, globalVariables, activeNode)
      endPerfMeasure(perfToken, {
        nodeCount: nodesForPanel.length,
        parameterCount: workflowParameters.length,
        globalCount: globalVariables.length,
        optionCount: result.length,
        activeNodeId: activeNode?.id ?? null,
      })
      return result
    },
    [activeNode, globalVariables, nodesForPanel, workflowParameters],
  )

  useEffect(() => {
    const allowed = new Set(llmModelOptions.map(item => item.name))
    const fallbackModel = defaultLLMModel || llmModelOptions[0]?.name || 'gpt-4o-mini'
    if (allowed.size === 0 || !fallbackModel)
      return

    let changed = false
    const nextNodes = nodes.map((node) => {
      if (node.data.type === BlockEnum.LLM) {
        const config = ensureNodeConfig(BlockEnum.LLM, node.data.config)
        const currentModel = String(config.model || '').trim()
        const nextModel = allowed.has(currentModel) ? currentModel : fallbackModel
        if (nextModel === config.model)
          return node
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...config,
              model: nextModel,
            },
          },
        }
      }
      return node
    })
    if (changed)
      setNodes(nextNodes)
  }, [defaultLLMModel, llmModelOptions, nodes, setNodes])

  useEffect(() => {
    let changed = false
    const nextNodes = nodes.map((node) => {
      if (!isIterationEntryNode(node))
        return node
      const childConfig = ensureNodeConfig(BlockEnum.Start, node.data.config)
      if (childConfig.variables.length === 0)
        return node
      changed = true
      return {
        ...node,
        data: {
          ...node.data,
          config: {
            ...childConfig,
            variables: [],
          },
        },
      }
    })
    if (changed)
      setNodes(nextNodes)
  }, [nodes, setNodes])

  useEffect(() => {
    if (!onDSLChange)
      return
    const perfToken = startPerfMeasure('serializeWorkflowDSL:onDSLChange')
    const nextDSL = serializeWorkflowDSL({
      nodes,
      edges,
      globalVariables,
      workflowParameters,
      workflowVariableScopes,
      viewport: getViewport(),
    })
    endPerfMeasure(perfToken, {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    })
    const serializedDSL = JSON.stringify(nextDSL)
    if (serializedDSL === lastReportedDSLRef.current)
      return
    lastReportedDSLRef.current = serializedDSL
    onDSLChange(nextDSL)
  }, [edges, getViewport, globalVariables, nodes, onDSLChange, workflowParameters, workflowVariableScopes])

  const iterationLayouts = useMemo(() => {
    const layoutMap: Record<string, ReturnType<typeof buildIterationContainerLayout>> = {}
    nodes.forEach((node) => {
      if (node.data.type !== BlockEnum.Iteration)
        return
      const children = nodes.filter(item => getParentIterationId(item) === node.id)
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      layoutMap[node.id] = collapsedIterationIds[node.id]
        ? {
            width: ITERATION_CONTAINER_COLLAPSED_WIDTH,
            height: ITERATION_CONTAINER_COLLAPSED_HEIGHT,
            paddingX: ITERATION_CONTAINER_PADDING_X,
            paddingY: ITERATION_CONTAINER_PADDING_Y,
          }
        : buildIterationContainerLayout(children, config.canvasSize)
    })
    return layoutMap
  }, [collapsedIterationIds, nodes])

  const handleResizeIterationCanvas = useCallback((iterationId: string, size: { width: number; height: number }, finalize = false) => {
    const nextWidth = Math.max(ITERATION_CONTAINER_MIN_WIDTH, Math.round(size.width))
    const nextHeight = Math.max(ITERATION_CONTAINER_MIN_HEIGHT, Math.round(size.height))
    let nextActiveNode: DifyNode | null = null
    setNodes((current) => {
      const nextNodes = current.map((node) => {
        if (node.id !== iterationId || node.data.type !== BlockEnum.Iteration)
          return node
        const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
        const nextNode = {
          ...node,
          data: {
            ...node.data,
            config: {
              ...config,
              canvasSize: {
                width: nextWidth,
                height: nextHeight,
              },
            },
          },
        }
        if (latestActiveNodeRef.current?.id === iterationId)
          nextActiveNode = nextNode
        return nextNode
      })
      latestNodesRef.current = nextNodes
      return nextNodes
    })
    if (nextActiveNode)
      setActiveNode(nextActiveNode)
    if (!finalize)
      return
    window.requestAnimationFrame(() => {
      record({
        nodes: latestNodesRef.current,
        edges: latestEdgesRef.current,
      })
    })
  }, [record, setActiveNode, setNodes])

  const getIterationToggleHandler = useCallback((iterationId: string) => {
    const existed = iterationToggleHandlerRef.current[iterationId]
    if (existed)
      return existed
    const nextHandler = () => {
      setCollapsedIterationIds(current => ({
        ...current,
        [iterationId]: !current[iterationId],
      }))
    }
    iterationToggleHandlerRef.current[iterationId] = nextHandler
    return nextHandler
  }, [])

  const getIterationResizeHandler = useCallback((iterationId: string) => {
    const existed = iterationResizeHandlerRef.current[iterationId]
    if (existed)
      return existed
    const nextHandler = (size: { width: number; height: number }, finalize?: boolean) => {
      handleResizeIterationCanvas(iterationId, size, finalize)
    }
    iterationResizeHandlerRef.current[iterationId] = nextHandler
    return nextHandler
  }, [handleResizeIterationCanvas])

  const renderNodes = useMemo(() => {
    const perfToken = startPerfMeasure('renderNodes')
    const nextCache = new Map<string, {
      sourceNode: DifyNode
      parentIterationId: string | null
      collapsed: boolean
      width?: number
      height?: number
      rendered: DifyNode
    }>()
    const result = nodes
      .filter((node) => {
        const parentIterationId = getParentIterationId(node)
        if (!parentIterationId)
          return true
        return !collapsedIterationIds[parentIterationId]
      })
      .map((node) => {
        const parentIterationId = getParentIterationId(node)
        const cached = renderedNodeCacheRef.current.get(node.id)

        if (node.data.type !== BlockEnum.Iteration) {
          if (!parentIterationId) {
            nextCache.set(node.id, {
              sourceNode: node,
              parentIterationId: null,
              collapsed: false,
              rendered: node,
            })
            return node
          }

          if (cached && cached.sourceNode === node && cached.parentIterationId === parentIterationId) {
            nextCache.set(node.id, cached)
            return cached.rendered
          }

          const renderedNode = {
            ...node,
            style: {
              ...(node.style ?? {}),
              zIndex: ITERATION_CHILDREN_Z_INDEX,
            },
            data: {
              ...node.data,
              _iterationRole: 'child' as const,
              _iterationParentId: parentIterationId,
              _iterationChildId: node.data.nestedNodeId,
            },
          }
          nextCache.set(node.id, {
            sourceNode: node,
            parentIterationId,
            collapsed: false,
            rendered: renderedNode,
          })
          return renderedNode
        }

        const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
        const layout = iterationLayouts[node.id] ?? buildIterationContainerLayout(nodes.filter(item => getParentIterationId(item) === node.id), config.canvasSize)
        const collapsed = Boolean(collapsedIterationIds[node.id])
        if (
          cached
          && cached.sourceNode === node
          && cached.parentIterationId === parentIterationId
          && cached.collapsed === collapsed
          && cached.width === layout.width
          && cached.height === layout.height
        ) {
          nextCache.set(node.id, cached)
          return cached.rendered
        }

        const renderedNode = {
          ...node,
          style: {
            ...(node.style ?? {}),
            width: layout.width,
            height: layout.height,
          },
          data: {
            ...node.data,
            _iterationRole: 'container' as const,
            _iterationCollapsed: collapsed,
            _iterationCanvasWidth: layout.width,
            _iterationCanvasHeight: layout.height,
            _onToggleIterationCollapse: getIterationToggleHandler(node.id),
            _onResizeIterationCanvas: getIterationResizeHandler(node.id),
          },
        }
        nextCache.set(node.id, {
          sourceNode: node,
          parentIterationId,
          collapsed,
          width: layout.width,
          height: layout.height,
          rendered: renderedNode,
        })
        return renderedNode
      })
    renderedNodeCacheRef.current = nextCache
    endPerfMeasure(perfToken, {
      sourceNodeCount: nodes.length,
      renderedNodeCount: result.length,
    })
    return result
  }, [collapsedIterationIds, getIterationResizeHandler, getIterationToggleHandler, iterationLayouts, nodes])

  const renderEdges = useMemo(() => {
    const perfToken = startPerfMeasure('renderEdges')
    const visibleEdges = edges.filter((edge) => {
      const sourceNode = nodes.find(node => node.id === edge.source)
      const targetNode = nodes.find(node => node.id === edge.target)
      const parentIterationId = edge.data?.parentIterationId || getParentIterationId(sourceNode) || getParentIterationId(targetNode)
      if (!parentIterationId)
        return true
      return !collapsedIterationIds[parentIterationId]
    })
    const nextCache = new Map<string, {
      sourceEdge: DifyEdge
      parentIterationId: string | null
      rendered: DifyEdge
    }>()
    const result = [...new Map(visibleEdges.map(edge => [edge.id, edge])).values()].map((edge) => {
      const sourceNode = nodes.find(node => node.id === edge.source)
      const targetNode = nodes.find(node => node.id === edge.target)
      const parentIterationId = edge.data?.parentIterationId || getParentIterationId(sourceNode) || getParentIterationId(targetNode)
      if (!parentIterationId)
      {
        nextCache.set(edge.id, {
          sourceEdge: edge,
          parentIterationId: null,
          rendered: edge,
        })
        return edge
      }

      const cached = renderedEdgeCacheRef.current.get(edge.id)
      if (cached && cached.sourceEdge === edge && cached.parentIterationId === parentIterationId) {
        nextCache.set(edge.id, cached)
        return cached.rendered
      }
      const renderedEdge = {
        ...edge,
        zIndex: ITERATION_CHILDREN_Z_INDEX,
        style: {
          ...(edge.style ?? {}),
          zIndex: ITERATION_CHILDREN_Z_INDEX,
        },
      }
      nextCache.set(edge.id, {
        sourceEdge: edge,
        parentIterationId,
        rendered: renderedEdge,
      })
      return renderedEdge
    })
    renderedEdgeCacheRef.current = nextCache
    endPerfMeasure(perfToken, {
      sourceEdgeCount: edges.length,
      renderedEdgeCount: result.length,
    })
    return result
  }, [collapsedIterationIds, edges, nodes])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const nextNodes = applyNodeChanges(changes, nodes) as DifyNode[]
    const removedIds = changes
      .filter(change => 'id' in change && change.type === 'remove')
      .map(change => change.id)
    const hasPositionChange = changes.some(change => change.type === 'position')

    setNodes(() => {
      if (removedIds.length === 0) {
        latestNodesRef.current = nextNodes
        return nextNodes
      }
      const removedSet = new Set(removedIds)
      const removedIterationIds = new Set(
        nodes
          .filter(node => removedSet.has(node.id) && node.data.type === BlockEnum.Iteration)
          .map(node => node.id),
      )
      const filteredNodes = nextNodes.filter((node) => {
        if (removedIterationIds.has(getParentIterationId(node) || ''))
          return false
        return true
      })
      latestNodesRef.current = filteredNodes
      return filteredNodes
    })

    setEdges((currentEdges) => {
      const removedSet = new Set(removedIds)
      const removedIterationIds = new Set(
        nodes
          .filter(node => removedSet.has(node.id) && node.data.type === BlockEnum.Iteration)
          .map(node => node.id),
      )
      const nextEdges = currentEdges.filter((edge) => {
        if (removedSet.has(edge.source) || removedSet.has(edge.target))
          return false
        if (removedIterationIds.has(edge.data?.parentIterationId || ''))
          return false
        return true
      })
      latestEdgesRef.current = nextEdges
      return nextEdges
    })
    if (hasPositionChange) {
      dragRecordPendingRef.current = true
      return
    }

    window.requestAnimationFrame(() => {
      record({
        nodes: latestNodesRef.current,
        edges: latestEdgesRef.current,
      })
    })
  }, [nodes, record, setEdges, setNodes])

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node?: DifyNode) => {
    if (!node)
      return
    if (activeNode?.id === node.id) {
      setActiveNode(node)
    }
    if (!dragRecordPendingRef.current)
      return
    dragRecordPendingRef.current = false
    window.requestAnimationFrame(() => {
      record({
        nodes: latestNodesRef.current,
        edges: latestEdgesRef.current,
      })
    })
  }, [activeNode?.id, record, setActiveNode])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const nextEdges = applyEdgeChanges(changes, edges) as DifyEdge[]
    setEdges(nextEdges)
    latestEdgesRef.current = nextEdges
    window.requestAnimationFrame(() => {
      record({ nodes: latestNodesRef.current, edges: latestEdgesRef.current })
    })
  }, [edges, record, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target)
      return
    const sourceNode = nodes.find(node => node.id === connection.source)
    const targetNode = nodes.find(node => node.id === connection.target)
    if (!sourceNode || !targetNode)
      return
    const sourceParentIterationId = getParentIterationId(sourceNode)
    const targetParentIterationId = getParentIterationId(targetNode)
    if (sourceParentIterationId !== targetParentIterationId)
      return

    const nextEdge: DifyEdge = {
      ...(connection as DifyEdge),
      id: sourceParentIterationId ? `sub-edge-${Date.now()}-${Math.floor(Math.random() * 1000)}` : `e-${Date.now()}`,
      type: CUSTOM_EDGE,
      data: sourceParentIterationId
        ? { parentIterationId: sourceParentIterationId }
        : undefined,
    }
    const nextEdges = [...edges, nextEdge]
    setEdges(nextEdges)
    record({ nodes, edges: nextEdges })
  }, [edges, nodes, record, setEdges])

  const handleLocateNode = useCallback((nodeId: string) => {
    const node = nodes.find(item => item.id === nodeId)
    if (!node)
      return

    const parentIterationId = getParentIterationId(node)
    if (parentIterationId)
      setCollapsedIterationIds(current => ({ ...current, [parentIterationId]: false }))
    setActiveNode(node)
    setChecklistOpen(false)
    fitView({ nodes: [{ id: node.id }], duration: 220, padding: 0.28 })
  }, [fitView, nodes, setActiveNode, setChecklistOpen])

  const handleAddNode = (type: BlockEnum) => {
    const iterationParentId = (() => {
      if (!activeNode)
        return null
      if (activeNode.data.type === BlockEnum.Iteration)
        return activeNode.id
      if (activeNode.data.parentIterationId)
        return activeNode.data.parentIterationId
      return null
    })()

    if (iterationParentId) {
      const parentNode = nodes.find(node => node.id === iterationParentId && node.data.type === BlockEnum.Iteration)
      if (!parentNode)
        return
      const iterationChildren = nodes.filter(node => getParentIterationId(node) === iterationParentId)
      if ((type === BlockEnum.Start || type === BlockEnum.End) && iterationChildren.some(node => node.data.type === type)) {
        globalThis.alert(`${nodeTypeLabel[type]}在当前循环中仅允许一个，已取消插入`)
        return
      }
      const nextChildId = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const nextNodes = [...nodes, {
        id: buildIterationNestedNodeId(iterationParentId, nextChildId),
        type: CUSTOM_NODE,
        parentNode: iterationParentId,
        extent: 'parent',
        position: {
          x: ITERATION_CONTAINER_PADDING_X + 40 + (iterationChildren.length % 3) * 240,
          y: ITERATION_CONTAINER_PADDING_Y + 40 + Math.floor(iterationChildren.length / 3) * 150,
        },
        data: {
          title: `${nodeTypeLabel[type]}-${iterationChildren.length + 1}`,
          desc: '',
          type,
          config: ensureNodeConfig(type, undefined),
          parentIterationId: iterationParentId,
          nestedNodeId: nextChildId,
          isIterationEntry: type === BlockEnum.Start,
        },
        draggable: true,
        selectable: true,
      } as DifyNode]
      setNodes(nextNodes)
      const insertedNode = nextNodes[nextNodes.length - 1]
      setActiveNode(insertedNode)
      setCollapsedIterationIds(current => ({ ...current, [iterationParentId]: false }))
      record({ nodes: nextNodes, edges })
      fitView({ nodes: [{ id: iterationParentId }], duration: 220, padding: 0.28 })
      return
    }

    const createdNode = addNode(type, resolveInsertPosition(nodes, activeNode))
    if (!createdNode)
      return

    setActiveNode(createdNode)
    if (type === BlockEnum.Iteration)
      fitView({ nodes: [{ id: createdNode.id }], duration: 220, padding: 0.28 })
  }

  const handleInsertAINode = useCallback((payload: {
    nodeType: BlockEnum
    generatedConfig: DifyNodeConfig
    suggestedTitle?: string
    suggestedDesc?: string
  }) => {
    const type = payload.nodeType
    const normalizedConfig = ensureNodeConfig(type, payload.generatedConfig)
    const iterationParentId = (() => {
      if (!activeNode)
        return null
      if (activeNode.data.type === BlockEnum.Iteration)
        return activeNode.id
      if (activeNode.data.parentIterationId)
        return activeNode.data.parentIterationId
      return null
    })()

    if (iterationParentId) {
      let insertedNodeId = ''
      let linked = false
      let cannotLink = false
      let duplicateTypeBlocked = false
      const iterationChildren = nodes.filter(node => getParentIterationId(node) === iterationParentId)
      if ((type === BlockEnum.Start || type === BlockEnum.End) && iterationChildren.some(node => node.data.type === type)) {
        duplicateTypeBlocked = true
      }
      insertedNodeId = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const nextNodeId = buildIterationNestedNodeId(iterationParentId, insertedNodeId)
      const nextNode: DifyNode = {
        id: nextNodeId,
        type: CUSTOM_NODE,
        parentNode: iterationParentId,
        extent: 'parent',
        position: {
          x: ITERATION_CONTAINER_PADDING_X + 40 + (iterationChildren.length % 3) * 240,
          y: ITERATION_CONTAINER_PADDING_Y + 40 + Math.floor(iterationChildren.length / 3) * 150,
        },
        data: {
          title: payload.suggestedTitle || `${nodeTypeLabel[type]}-${iterationChildren.length + 1}`,
          desc: payload.suggestedDesc || '',
          type,
          config: normalizedConfig,
          parentIterationId: iterationParentId,
          nestedNodeId: insertedNodeId,
          isIterationEntry: type === BlockEnum.Start,
        },
        draggable: true,
        selectable: true,
      }

      if (duplicateTypeBlocked) {
        globalThis.alert(`${nodeTypeLabel[type]}在当前迭代分支中仅允许一个，已取消插入`)
        return
      }

      const nextNodes = [...nodes, nextNode]
      const nextEdges = [...edges]
      if (activeNode?.data.parentIterationId === iterationParentId && activeNode.data.type !== BlockEnum.End && type !== BlockEnum.Start) {
        linked = true
        nextEdges.push({
          id: `e-${Date.now()}`,
          source: activeNode.id,
          target: nextNode.id,
          sourceHandle: activeNode.data.type === BlockEnum.IfElse ? IF_ELSE_FALLBACK_HANDLE : undefined,
          type: CUSTOM_EDGE,
          data: { parentIterationId: iterationParentId },
        })
      } else if (activeNode) {
        cannotLink = true
      }

      setNodes(nextNodes)
      setEdges(nextEdges)
      setActiveNode(nextNode)
      setCollapsedIterationIds(current => ({ ...current, [iterationParentId]: false }))
      record({ nodes: nextNodes, edges: nextEdges })
      fitView({ nodes: [{ id: iterationParentId }], duration: 220, padding: 0.28 })
      if (!linked && cannotLink)
        globalThis.alert('节点已插入，但当前选中节点无法自动连线')
      return
    }

    if ((type === BlockEnum.Start || type === BlockEnum.End) && nodes.some(node => node.data.type === type)) {
      globalThis.alert(`${nodeTypeLabel[type]}仅允许一个，已取消插入`)
      return
    }

    const id = `node-${idRef.current++}`
    const nextNode: DifyNode = {
      id,
      type: CUSTOM_NODE,
      position: resolveInsertPosition(nodes, activeNode),
      data: {
        title: payload.suggestedTitle || `${nodeTypeLabel[type]}-${idRef.current}`,
        desc: payload.suggestedDesc || '',
        type,
        config: normalizedConfig,
      },
    }
    const nextNodes = [...nodes, nextNode]

    let linked = false
    let cannotLink = false
    const nextEdges = [...edges]
    if (activeNode && !isNestedNode(activeNode)) {
      const sourceNodeExists = nextNodes.some(node => node.id === activeNode.id)
      if (sourceNodeExists && activeNode.data.type !== BlockEnum.End && type !== BlockEnum.Start) {
        linked = true
        nextEdges.push({
          id: `e-${Date.now()}`,
          source: activeNode.id,
          target: nextNode.id,
          sourceHandle: activeNode.data.type === BlockEnum.IfElse ? IF_ELSE_FALLBACK_HANDLE : undefined,
          type: CUSTOM_EDGE,
        })
      } else {
        cannotLink = true
      }
    }

    setNodes(nextNodes)
    setEdges(nextEdges)
    setActiveNode(nextNode)
    record({ nodes: nextNodes, edges: nextEdges })
    if (type === BlockEnum.Iteration)
      fitView({ nodes: [{ id: nextNode.id }], duration: 220, padding: 0.28 })
    if (!linked && cannotLink)
      globalThis.alert('节点已插入，但当前选中节点无法自动连线')
  }, [activeNode, edges, fitView, idRef, nodeTypeLabel, nodes, record, setActiveNode, setEdges, setNodes])

  const handleSaveActiveNode = useCallback(() => {
    if (!activeNode)
      return
    const currentNode = nodes.find(item => item.id === activeNode.id)
    if (!currentNode)
      return
    const currentPayload = JSON.stringify({
      title: currentNode.data.title,
      desc: currentNode.data.desc || '',
      type: currentNode.data.type,
      config: currentNode.data.config ?? null,
    })
    const activePayload = JSON.stringify({
      title: activeNode.data.title,
      desc: activeNode.data.desc || '',
      type: activeNode.data.type,
      config: activeNode.data.config ?? null,
    })
    if (currentPayload === activePayload)
      return
    saveNode()
  }, [activeNode, nodes, saveNode])

  const handleFocusIterationRegion = useCallback((nodeId: string) => {
    const node = nodes.find(item => item.id === nodeId && item.data.type === BlockEnum.Iteration)
    if (!node)
      return
    setCollapsedIterationIds(current => ({ ...current, [nodeId]: false }))
    setActiveNode(node)
    fitView({ nodes: [{ id: node.id }], duration: 220, padding: 0.28 })
  }, [fitView, nodes, setActiveNode])

  const handleAutoLayout = useCallback(() => {
    const nextNodes = autoLayoutNodes(nodes, edges)
    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
    fitView({ duration: 260, padding: 0.22 })
  }, [edges, fitView, nodes, record, setNodes])

  const handleAddIterationChild = (parentId: string, type: BlockEnum) => {
    const parentNode = nodes.find(node => node.id === parentId)
    if (!parentNode)
      return
    if (activeNode && activeNode.id !== parentNode.id)
      handleSaveActiveNode()
    setActiveNode(parentNode)
    window.requestAnimationFrame(() => {
      handleAddNode(type)
    })
  }

  const getEffectiveNodes = useCallback(() => {
    if (!activeNode)
      return nodes
    return nodes.map((item) => {
      if (item.id !== activeNode.id)
        return item
      return {
        ...item,
        data: {
          ...item.data,
          ...activeNode.data,
        },
      }
    })
  }, [activeNode, nodes])

  const getDSL = useCallback(() => {
    const perfToken = startPerfMeasure('serializeWorkflowDSL:getDSL')
    const result = serializeWorkflowDSL({
      nodes: getEffectiveNodes(),
      edges,
      globalVariables,
      workflowParameters,
      workflowVariableScopes,
      viewport: getViewport(),
    })
    endPerfMeasure(perfToken, {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    })
    return result
  }, [edges, getEffectiveNodes, getViewport, globalVariables, nodes.length, workflowParameters, workflowVariableScopes])

  const flowActions = useMemo(() => ({
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeDragStop: handleNodeDragStop,
    onNodeClick: (_: React.MouseEvent, node: DifyNode) => {
      if (activeNode && activeNode.id !== node.id)
        handleSaveActiveNode()
      setActiveNode(node)
    },
    onPaneClick: clearMenus,
    onNodeContextMenu: handleNodeContextMenu,
    onEdgeContextMenu: handleEdgeContextMenu,
    onPaneContextMenu: handlePaneContextMenu,
  }), [activeNode, clearMenus, handleEdgeContextMenu, handleNodeContextMenu, handleNodeDragStop, handlePaneContextMenu, handleSaveActiveNode, onConnect, onEdgesChange, onNodesChange, setActiveNode])

  const nodeMenuActions = useMemo(() => ({
    onClose: () => setNodeMenu(undefined),
    onCopy: () => copySelection(nodeMenu ? [nodeMenu.nodeId] : []),
    onDuplicate: () => duplicateSelection(nodeMenu ? [nodeMenu.nodeId] : []),
    onDelete: () => deleteSelection(nodeMenu ? [nodeMenu.nodeId] : []),
  }), [copySelection, deleteSelection, duplicateSelection, nodeMenu, setNodeMenu])

  const edgeMenuActions = useMemo(() => ({
    onClose: () => setEdgeMenu(undefined),
    onDelete: () => deleteSelection([], edgeMenu ? [edgeMenu.edgeId] : []),
  }), [deleteSelection, edgeMenu, setEdgeMenu])

  const panelMenuActions = useMemo(() => ({
    onClose: () => setPanelMenu(undefined),
    onPaste: () => pasteClipboard(panelMenu),
    onExport: exportDSL,
    onImport: () => setImportOpen(true),
  }), [exportDSL, panelMenu, pasteClipboard, setImportOpen, setPanelMenu])

  const selectionMenuActions = useMemo(() => ({
    onClose: () => setSelectionMenu(undefined),
    onCopy: () => copySelection(),
    onDuplicate: () => duplicateSelection(),
    onDelete: () => deleteSelection(),
    onAlign: (direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distributeHorizontal' | 'distributeVertical') => alignSelection(direction),
  }), [alignSelection, copySelection, deleteSelection, duplicateSelection, setSelectionMenu])

  const quickPanelActions = useMemo(() => ({
    globalVariableOpen,
    workflowParamsOpen,
    checklistOpen,
    issueCount: issues.length,
    globalVariables,
    workflowParameters,
    issues,
    onOpenGlobalVariables: () => {
      setWorkflowParamsOpen(false)
      setChecklistOpen(false)
      setGlobalVariableOpen(true)
    },
    onOpenWorkflowParams: () => {
      setGlobalVariableOpen(false)
      setChecklistOpen(false)
      setWorkflowParamsOpen(true)
    },
    onOpenChecklist: () => {
      setGlobalVariableOpen(false)
      setWorkflowParamsOpen(false)
      setChecklistOpen(true)
    },
    onCloseGlobalVariables: () => setGlobalVariableOpen(false),
    onCloseWorkflowParams: () => setWorkflowParamsOpen(false),
    onChangeWorkflowParams: setWorkflowParameters,
    onCloseChecklist: () => setChecklistOpen(false),
    onLocateIssueNode: handleLocateNode,
  }), [checklistOpen, globalVariableOpen, globalVariables, handleLocateNode, issues, setChecklistOpen, setGlobalVariableOpen, setWorkflowParameters, setWorkflowParamsOpen, workflowParameters, workflowParamsOpen])

  const editorActions = useMemo(() => ({
    flow: flowActions,
    nodeMenu: nodeMenuActions,
    edgeMenu: edgeMenuActions,
    panelMenu: panelMenuActions,
    selectionMenu: selectionMenuActions,
    quickPanel: quickPanelActions,
  }), [edgeMenuActions, flowActions, nodeMenuActions, panelMenuActions, quickPanelActions, selectionMenuActions])

  useImperativeHandle(apiRef, () => ({
    flushActiveNode: () => handleSaveActiveNode(),
    getDSL,
  }), [activeNode, edges, globalVariables, workflowParameters, workflowVariableScopes])

  return (
    <div className="space-y-3">
      <WorkflowToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        issueCount={issues.length}
        onAddNode={handleAddNode}
        onUndo={doUndo}
        onRedo={doRedo}
        onLayout={handleAutoLayout}
        onRun={() => {
          const perfToken = startPerfMeasure('serializeWorkflowDSL:onRun')
          const serialized = serializeWorkflowDSL({
            nodes,
            edges,
            workflowParameters,
          } as DifyWorkflowDSL)
          endPerfMeasure(perfToken, {
            nodeCount: nodes.length,
            edgeCount: edges.length,
          })
          setRunSnapshot({
            workflowId,
            nodes: JSON.parse(JSON.stringify(serialized.nodes)) as DifyNode[],
            edges: JSON.parse(JSON.stringify(serialized.edges)) as DifyEdge[],
            workflowParameters: JSON.parse(JSON.stringify(workflowParameters)) as typeof workflowParameters,
          })
          setRunModalOpen(true)
        }}
        onOpenGlobalParams={() => setGlobalVariableOpen(true)}
        onOpenChecklist={() => setChecklistOpen(true)}
        onOpenAINodeGenerate={() => setAINodeGenerateOpen(true)}
        onExport={exportDSL}
        onOpenImport={() => setImportOpen(true)}
        onReset={reset}
      />

      <div className="grid grid-cols-12 gap-3">
        <NodeConfigPanel
          nodes={nodesForPanel}
          edges={edges}
          workflowParameters={workflowParameters}
          globalVariables={globalVariables}
          workflowVariableScopes={workflowVariableScopes}
          llmModelOptions={llmModelOptions}
          defaultLLMModel={defaultLLMModel}
          defaultCodeModel={defaultCodeModel}
          activeNode={activeNode}
          onChange={setActiveNode}
          onChangeScopes={setWorkflowVariableScopes}
          onFocusIterationRegion={handleFocusIterationRegion}
          onAddIterationChild={handleAddIterationChild}
          onSave={handleSaveActiveNode}
        />
        <WorkflowEditor
          canvasContainerRef={canvasContainerRef}
          nodes={renderNodes}
          edges={renderEdges}
          nodeMenu={nodeMenu}
          edgeMenu={edgeMenu}
          panelMenu={panelMenu}
          selectionMenu={selectionMenu}
          canPaste={clipboard.nodes.length > 0}
          connectionLineComponent={CustomConnectionLine}
          connectionLineZIndex={ITERATION_CHILDREN_Z_INDEX}
          actions={editorActions}
        />
      </div>

      <AINodeGenerateModal
        open={aiNodeGenerateOpen}
        modelOptions={llmModelOptions}
        defaultModel={defaultLLMModel}
        activeNodeType={activeNode?.data.type}
        variableOptions={aiVariableOptions}
        onClose={() => setAINodeGenerateOpen(false)}
        onConfirm={handleInsertAINode}
      />

      <DSLModals
        importOpen={importOpen}
        exportOpen={exportOpen}
        importText={importText}
        exportText={exportText}
        onChangeImportText={setImportText}
        onCloseImport={() => setImportOpen(false)}
        onImport={importDSL}
        onCloseExport={() => setExportOpen(false)}
      />
      <WorkflowRunModal
        open={runModalOpen}
        workflowId={runSnapshot.workflowId}
        nodes={runSnapshot.nodes}
        edges={runSnapshot.edges}
        workflowParameters={runSnapshot.workflowParameters}
        onClose={() => setRunModalOpen(false)}
      />
    </div>
  )
}

type WorkflowCanvasProps = {
  initialDSL?: DifyWorkflowDSL
  workflowId?: number
  onDSLChange?: (dsl: DifyWorkflowDSL) => void
  onSave?: () => void
}

const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(({ initialDSL, workflowId, onDSLChange, onSave }, ref) => {
  const safeInitialDSL = useMemo(() => {
    try {
      return parseDifyWorkflowDSL(initialDSL ?? demoDSL)
    }
    catch {
      return parseDifyWorkflowDSL(demoDSL)
    }
  }, [initialDSL])

  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner initialDSL={safeInitialDSL} workflowId={workflowId} onDSLChange={onDSLChange} onSave={onSave} apiRef={ref} />
    </ReactFlowProvider>
  )
})

WorkflowCanvas.displayName = 'WorkflowCanvas'

export default WorkflowCanvas
