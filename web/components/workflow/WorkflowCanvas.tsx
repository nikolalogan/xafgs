'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ReactFlowProvider,
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
import { demoDSL, edgeTypes, nodeTypeLabel, nodeTypes } from './dify/config/workflowPreset'
import { CUSTOM_EDGE, CUSTOM_NODE, ITERATION_CHILDREN_Z_INDEX } from './dify/core/constants'
import { ensureNodeConfig } from './dify/core/node-config'
import { BlockEnum, type DifyEdge, type DifyNode, type DifyNodeConfig, type IterationNodeConfig, type WorkflowParameter } from './dify/core/types'
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
import { parseDifyWorkflowDSL } from './dify/core/dsl'
import type { DifyWorkflowDSL } from './dify/core/types'
import { IF_ELSE_FALLBACK_HANDLE, parseIfElseBranchIndex } from '@/lib/workflow-ifelse'
import {
  useWorkflowClipboardStore,
  useWorkflowHistoryStore,
  useWorkflowMenuStore,
} from './dify/hooks/useWorkflowStoreSelectors'

const ITERATION_CHILD_NODE_PREFIX = 'iter-child::'
const ITERATION_CHILD_EDGE_PREFIX = 'iter-edge::'
const ITERATION_CONTAINER_MIN_WIDTH = 760
const ITERATION_CONTAINER_MIN_HEIGHT = 420
const ITERATION_CONTAINER_PADDING_X = 24
const ITERATION_CONTAINER_PADDING_Y = 56
const ITERATION_CHILD_NODE_ESTIMATED_WIDTH = 240
const ITERATION_CHILD_NODE_ESTIMATED_HEIGHT = 130
const NODE_INSERT_X_GAP = 320
const NODE_INSERT_Y_GAP = 140
const NODE_COLLISION_X_THRESHOLD = 260
const NODE_COLLISION_Y_THRESHOLD = 110

const buildChildNodeId = (parentId: string, childId: string) => `${ITERATION_CHILD_NODE_PREFIX}${parentId}::${childId}`
const buildChildEdgeId = (parentId: string, childEdgeId: string) => `${ITERATION_CHILD_EDGE_PREFIX}${parentId}::${childEdgeId}`

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
  const filteredNodes = nodes.filter(node => !node.id.startsWith(ITERATION_CHILD_NODE_PREFIX))
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

const parseChildNodeId = (id: string): { parentId: string; childId: string } | null => {
  if (!id.startsWith(ITERATION_CHILD_NODE_PREFIX))
    return null
  const payload = id.slice(ITERATION_CHILD_NODE_PREFIX.length)
  const [parentId, childId] = payload.split('::')
  if (!parentId || !childId)
    return null
  return { parentId, childId }
}

const parseChildEdgeId = (id: string): { parentId: string; childEdgeId: string } | null => {
  if (!id.startsWith(ITERATION_CHILD_EDGE_PREFIX))
    return null
  const payload = id.slice(ITERATION_CHILD_EDGE_PREFIX.length)
  const [parentId, childEdgeId] = payload.split('::')
  if (!parentId || !childEdgeId)
    return null
  return { parentId, childEdgeId }
}

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
  const isChildNode = activeNode.data?._iterationRole === 'child' || parseChildNodeId(activeNode.id)
  if (isChildNode)
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

const buildIterationChildRenderNode = (
  nodes: DifyNode[],
  parentId: string,
  childId: string,
): DifyNode | null => {
  const parent = nodes.find(node => node.id === parentId && node.data.type === BlockEnum.Iteration)
  if (!parent)
    return null
  const config = ensureNodeConfig(BlockEnum.Iteration, parent.data.config)
  const childNode = config.children.nodes.find(item => item.id === childId)
  if (!childNode)
    return null
  const layout = buildIterationContainerLayout(config.children.nodes)
  return {
    id: buildChildNodeId(parentId, childId),
    type: CUSTOM_NODE,
    parentNode: parentId,
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
      _iterationParentId: parentId,
      _iterationChildId: childNode.id,
    },
    draggable: true,
    selectable: true,
  } as DifyNode
}

type WorkflowCanvasInnerProps = {
  initialDSL: DifyWorkflowDSL
  workflowId?: number
  onDSLChange?: (dsl: DifyWorkflowDSL) => void
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

function WorkflowCanvasInner({ initialDSL, workflowId, onDSLChange, apiRef }: WorkflowCanvasInnerProps) {
  const [runModalOpen, setRunModalOpen] = useState(false)
  const [runSnapshot, setRunSnapshot] = useState<WorkflowRunSnapshot>({ workflowId, nodes: [], edges: [], workflowParameters: [] })
  const [nodesForPanel, setNodesForPanel] = useState<DifyNode[]>([])
  const [llmModelOptions, setLLMModelOptions] = useState<Array<{ name: string; label: string }>>([{ name: 'gpt-4o-mini', label: 'GPT-4o mini' }])
  const [defaultLLMModel, setDefaultLLMModel] = useState('gpt-4o-mini')
  const [defaultCodeModel, setDefaultCodeModel] = useState('gpt-4o-mini')
  const [aiNodeGenerateOpen, setAINodeGenerateOpen] = useState(false)
  const latestNodesRef = useRef<DifyNode[]>([])
  const latestEdgesRef = useRef<DifyEdge[]>([])
  const latestWorkflowParametersRef = useRef<WorkflowParameter[]>([])
  const lastReportedDSLRef = useRef('')
  const dragRecordPendingRef = useRef(false)
  const {
    parsed,
    nodes,
    edges,
    onNodesChangeBase,
    onEdgesChangeBase,
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
  }, [edges, nodes, workflowParameters])

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
      setRunSnapshot({
        workflowId,
        nodes: JSON.parse(JSON.stringify(latestNodesRef.current)) as DifyNode[],
        edges: JSON.parse(JSON.stringify(latestEdgesRef.current)) as DifyEdge[],
        workflowParameters: JSON.parse(JSON.stringify(latestWorkflowParametersRef.current)) as WorkflowParameter[],
      })
      setRunModalOpen(true)
    }
    window.addEventListener('workflow-open-run', openRunModal)

    const params = new URLSearchParams(window.location.search)
    if (params.get('run') === '1') {
      setRunSnapshot({
        workflowId,
        nodes: JSON.parse(JSON.stringify(latestNodesRef.current)) as DifyNode[],
        edges: JSON.parse(JSON.stringify(latestEdgesRef.current)) as DifyEdge[],
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
  })
  const issues = useMemo(() => validateWorkflow(nodesForPanel, edges, workflowParameters), [edges, nodesForPanel, workflowParameters])
  const aiVariableOptions = useMemo(
    () => buildWorkflowVariableOptions(nodesForPanel, workflowParameters, globalVariables, activeNode),
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
      if (node.data.type === BlockEnum.Iteration) {
        const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
        let childChanged = false
        const nextChildren = config.children.nodes.map((child) => {
          if (child.data.type !== BlockEnum.LLM)
            return child
          const childConfig = ensureNodeConfig(BlockEnum.LLM, child.data.config)
          const currentModel = String(childConfig.model || '').trim()
          const nextModel = allowed.has(currentModel) ? currentModel : fallbackModel
          if (nextModel === childConfig.model)
            return child
          childChanged = true
          return {
            ...child,
            data: {
              ...child.data,
              config: {
                ...childConfig,
                model: nextModel,
              },
            },
          }
        })
        if (!childChanged)
          return node
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...config,
              children: {
                ...config.children,
                nodes: nextChildren,
              },
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
    if (!onDSLChange)
      return
    const nextDSL: DifyWorkflowDSL = {
      nodes,
      edges,
      globalVariables,
      workflowParameters,
      workflowVariableScopes,
      viewport: getViewport(),
    }
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
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      layoutMap[node.id] = buildIterationContainerLayout(config.children.nodes)
    })
    return layoutMap
  }, [nodes])

  const renderNodes = useMemo(() => {
    const mergedNodes: DifyNode[] = []
    nodes.forEach((node) => {
      if (node.data.type !== BlockEnum.Iteration) {
        mergedNodes.push(node)
        return
      }

      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      const layout = iterationLayouts[node.id] ?? buildIterationContainerLayout(config.children.nodes)

      mergedNodes.push({
        ...node,
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
          draggable: true,
          selectable: true,
        } as DifyNode)
      })
    })
    return mergedNodes
  }, [iterationLayouts, nodes])

  const renderEdges = useMemo(() => {
    const mergedEdges: DifyEdge[] = [...edges]
    nodes.forEach((node) => {
      if (node.data.type !== BlockEnum.Iteration)
        return
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      config.children.edges.forEach((edge) => {
        mergedEdges.push({
          id: buildChildEdgeId(node.id, edge.id),
          source: buildChildNodeId(node.id, edge.source),
          target: buildChildNodeId(node.id, edge.target),
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.type ?? CUSTOM_EDGE,
          data: {
            _iterationParentId: node.id,
          },
        })
      })
    })
    return mergedEdges
  }, [edges, nodes])

  const updateIterationChildren = useCallback((
    currentNodes: DifyNode[],
    parentId: string,
    updater: (children: IterationNodeConfig['children']) => IterationNodeConfig['children'],
  ) => {
    return currentNodes.map((node) => {
      if (node.id !== parentId || node.data.type !== BlockEnum.Iteration)
        return node
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      return {
        ...node,
        data: {
          ...node.data,
          config: {
            ...config,
            children: updater(config.children),
          },
        },
      }
    })
  }, [])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const mainChanges: NodeChange[] = []
    const childChanges: NodeChange[] = []
    changes.forEach((change) => {
      if (!('id' in change)) {
        mainChanges.push(change)
        return
      }
      const childRef = parseChildNodeId(change.id)
      if (!childRef) {
        mainChanges.push(change)
        return
      }
      childChanges.push(change)
    })

    if (mainChanges.length > 0)
      onNodesChangeBase(mainChanges)

    if (childChanges.length === 0)
      return

    const hasPositionChange = childChanges.some(change => change.type === 'position')
    let changed = false
    setNodes((currentNodes) => {
      const movingIterationParents = new Set<string>()
      childChanges.forEach((change) => {
        if (!('id' in change))
          return
        if (change.type !== 'position' || !change.position)
          return
        const targetNode = currentNodes.find(node => node.id === change.id)
        if (targetNode?.data.type === BlockEnum.Iteration)
          movingIterationParents.add(change.id)
      })

      let nextNodes = currentNodes
      childChanges.forEach((change) => {
        if (!('id' in change))
          return
        const childRef = parseChildNodeId(change.id)
        if (!childRef)
          return

        if (change.type === 'position' && change.position) {
          if (movingIterationParents.has(childRef.parentId))
            return
          const nextPosition = change.position
          nextNodes = updateIterationChildren(nextNodes, childRef.parentId, children => ({
            ...children,
            nodes: children.nodes.map((item) => {
              if (item.id !== childRef.childId)
                return item
              return {
                ...item,
                position: {
                  x: Math.max(0, nextPosition.x - ITERATION_CONTAINER_PADDING_X),
                  y: Math.max(0, nextPosition.y - ITERATION_CONTAINER_PADDING_Y),
                },
              }
            }),
          }))
          changed = true
        }

        if (change.type === 'remove') {
          nextNodes = updateIterationChildren(nextNodes, childRef.parentId, children => ({
            ...children,
            nodes: children.nodes.filter(item => item.id !== childRef.childId),
            edges: children.edges.filter(edge => edge.source !== childRef.childId && edge.target !== childRef.childId),
          }))
          changed = true
        }
      })
      return changed ? nextNodes : currentNodes
    })

    if (changed) {
      if (hasPositionChange) {
        dragRecordPendingRef.current = true
      } else {
        record({
          nodes: latestNodesRef.current,
          edges: latestEdgesRef.current,
        })
      }
    }
  }, [onNodesChangeBase, record, setNodes, updateIterationChildren])

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node?: DifyNode) => {
    if (!node)
      return
    if (activeNode?.id === node.id) {
      // 同步 activeNode，避免保存时使用旧 position 覆盖最新拖拽结果。
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
    const mainChanges: EdgeChange[] = []
    const childRemovedEdges: Array<{ parentId: string; childEdgeId: string }> = []
    let changed = false

    changes.forEach((change) => {
      if (!('id' in change)) {
        mainChanges.push(change)
        return
      }
      const childRef = parseChildEdgeId(change.id)
      if (!childRef) {
        mainChanges.push(change)
        return
      }
      if (change.type !== 'remove')
        return

      childRemovedEdges.push(childRef)
    })

    if (mainChanges.length > 0) {
      onEdgesChangeBase(mainChanges)
      changed = true
    }

    if (childRemovedEdges.length > 0) {
      setNodes((currentNodes) => {
        let nextNodes = currentNodes
        childRemovedEdges.forEach((item) => {
          nextNodes = updateIterationChildren(nextNodes, item.parentId, children => ({
            ...children,
            edges: children.edges.filter(edge => edge.id !== item.childEdgeId),
          }))
        })
        if (nextNodes !== currentNodes)
          changed = true
        return nextNodes
      })
    }

    if (!changed)
      return

    window.requestAnimationFrame(() => {
      record({ nodes: latestNodesRef.current, edges: latestEdgesRef.current })
    })
  }, [onEdgesChangeBase, record, setNodes, updateIterationChildren])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target)
      return

    const sourceChild = parseChildNodeId(connection.source)
    const targetChild = parseChildNodeId(connection.target)

    if (sourceChild && targetChild) {
      if (sourceChild.parentId !== targetChild.parentId)
        return

      const nextChildEdgeId = `sub-edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const nextNodes = updateIterationChildren(nodes, sourceChild.parentId, children => ({
        ...children,
        edges: [
          ...children.edges,
          {
            id: nextChildEdgeId,
            source: sourceChild.childId,
            target: targetChild.childId,
            sourceHandle: connection.sourceHandle ?? undefined,
            targetHandle: connection.targetHandle ?? undefined,
            type: CUSTOM_EDGE,
          },
        ],
      }))
      setNodes(nextNodes)
      record({ nodes: nextNodes, edges })
      return
    }

    if (sourceChild || targetChild)
      return

    const nextEdge: DifyEdge = {
      ...(connection as DifyEdge),
      id: `e-${Date.now()}`,
      type: CUSTOM_EDGE,
    }
    const nextEdges = [...edges, nextEdge]
    setEdges(nextEdges)
    record({ nodes, edges: nextEdges })
  }, [edges, nodes, record, setEdges, setNodes, updateIterationChildren])

  const handleLocateNode = (nodeId: string) => {
    const node = nodes.find(item => item.id === nodeId)
    if (!node)
      return

    setActiveNode(node)
    setChecklistOpen(false)
    fitView({ nodes: [{ id: node.id }], duration: 220, padding: 0.28 })
  }

  const handleAddNode = (type: BlockEnum) => {
    const iterationParentId = (() => {
      if (!activeNode)
        return null
      if (activeNode.data.type === BlockEnum.Iteration)
        return activeNode.id
      if (activeNode.data._iterationRole === 'child' && activeNode.data._iterationParentId)
        return activeNode.data._iterationParentId
      return null
    })()

    if (iterationParentId) {
      const nextChildId = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const nextNodes = updateIterationChildren(nodes, iterationParentId, children => ({
        ...children,
        nodes: [
          ...children.nodes,
          {
            id: nextChildId,
            type: 'childNode',
            position: {
              x: 40 + (children.nodes.length % 3) * 240,
              y: 40 + Math.floor(children.nodes.length / 3) * 150,
            },
            data: {
              title: `${nodeTypeLabel[type]}-${children.nodes.length + 1}`,
              desc: '',
              type,
              config: ensureNodeConfig(type, undefined),
            },
          },
        ],
      }))
      setNodes(nextNodes)
      const nextParentNode = nextNodes.find(node => node.id === iterationParentId) ?? null
      if (nextParentNode)
        setActiveNode(nextParentNode)
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
      if (activeNode.data._iterationRole === 'child' && activeNode.data._iterationParentId)
        return activeNode.data._iterationParentId
      return null
    })()

    if (iterationParentId) {
      let insertedChildId = ''
      let linked = false
      let cannotLink = false
      let duplicateTypeBlocked = false
      const nextNodes = updateIterationChildren(nodes, iterationParentId, (children) => {
        if (type === BlockEnum.Start || type === BlockEnum.End) {
          const existing = children.nodes.find(item => item.data.type === type)
          if (existing) {
            duplicateTypeBlocked = true
            return children
          }
        }

        insertedChildId = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        const nextNode = {
          id: insertedChildId,
          type: 'childNode',
          position: {
            x: 40 + (children.nodes.length % 3) * 240,
            y: 40 + Math.floor(children.nodes.length / 3) * 150,
          },
          data: {
            title: payload.suggestedTitle || `${nodeTypeLabel[type]}-${children.nodes.length + 1}`,
            desc: payload.suggestedDesc || '',
            type,
            config: normalizedConfig,
          },
        }

        const nextChildren: IterationNodeConfig['children'] = {
          ...children,
          nodes: [...children.nodes, nextNode],
          edges: [...children.edges],
        }

        if (activeNode?.data._iterationRole === 'child' && activeNode.data._iterationParentId === iterationParentId && activeNode.data._iterationChildId) {
          const sourceChildId = activeNode.data._iterationChildId
          const sourceChild = children.nodes.find(item => item.id === sourceChildId)
          if (sourceChild && sourceChild.data.type !== BlockEnum.End && type !== BlockEnum.Start) {
            linked = true
            nextChildren.edges.push({
              id: `sub-edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              source: sourceChildId,
              target: insertedChildId,
              sourceHandle: sourceChild.data.type === BlockEnum.IfElse ? IF_ELSE_FALLBACK_HANDLE : undefined,
              type: CUSTOM_EDGE,
            })
          } else {
            cannotLink = true
          }
        } else if (activeNode) {
          cannotLink = true
        }

        return nextChildren
      })

      if (duplicateTypeBlocked) {
        globalThis.alert(`${nodeTypeLabel[type]}在当前迭代分支中仅允许一个，已取消插入`)
        return
      }

      setNodes(nextNodes)
      const insertedChildNode = insertedChildId
        ? buildIterationChildRenderNode(nextNodes, iterationParentId, insertedChildId)
        : null
      const nextParentNode = nextNodes.find(node => node.id === iterationParentId) ?? null
      if (insertedChildNode)
        setActiveNode(insertedChildNode)
      else if (nextParentNode)
        setActiveNode(nextParentNode)
      record({ nodes: nextNodes, edges })
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
    if (activeNode && !parseChildNodeId(activeNode.id)) {
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
  }, [activeNode, edges, fitView, idRef, nodeTypeLabel, nodes, record, setActiveNode, setEdges, setNodes, updateIterationChildren])

  const handleSaveActiveNode = () => {
    if (!activeNode)
      return

    const childRef = parseChildNodeId(activeNode.id)
    if (!childRef) {
      saveNode()
      return
    }

    const nextNodes = updateIterationChildren(nodes, childRef.parentId, children => ({
      ...children,
      nodes: children.nodes.map((item) => {
        if (item.id !== childRef.childId)
          return item
        return {
          ...item,
          data: {
            title: activeNode.data.title,
            desc: activeNode.data.desc,
            type: activeNode.data.type,
            config: activeNode.data.config,
          },
        }
      }),
    }))
    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
  }

  const handleFocusIterationRegion = (nodeId: string) => {
    const node = nodes.find(item => item.id === nodeId && item.data.type === BlockEnum.Iteration)
    if (!node)
      return
    setActiveNode(node)
    fitView({ nodes: [{ id: node.id }], duration: 220, padding: 0.28 })
  }

  const handleAutoLayout = () => {
    const nextNodes = autoLayoutNodes(nodes, edges)
    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
    fitView({ duration: 260, padding: 0.22 })
  }

  const getEffectiveNodes = () => {
    if (!activeNode)
      return nodes

    const childRef = parseChildNodeId(activeNode.id)
    if (!childRef) {
      return nodes.map((item) => {
        if (item.id !== activeNode.id)
          return item
        // 合并 activeNode.data，保留节点当前位置/尺寸等运行态属性。
        return {
          ...item,
          data: {
            ...item.data,
            ...activeNode.data,
          },
        }
      })
    }

    return updateIterationChildren(nodes, childRef.parentId, children => ({
      ...children,
      nodes: children.nodes.map((item) => {
        if (item.id !== childRef.childId)
          return item
        return {
          ...item,
          data: {
            title: activeNode.data.title,
            desc: activeNode.data.desc,
            type: activeNode.data.type,
            config: activeNode.data.config,
          },
        }
      }),
    }))
  }

  const getDSL = () => {
    return {
      nodes: getEffectiveNodes(),
      edges,
      globalVariables,
      workflowParameters,
      workflowVariableScopes,
      viewport: getViewport(),
    }
  }

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
        onSave={handleSaveActiveNode}
        onRun={() => {
          setRunSnapshot({
            workflowId,
            nodes: JSON.parse(JSON.stringify(nodes)) as DifyNode[],
            edges: JSON.parse(JSON.stringify(edges)) as DifyEdge[],
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
          onSave={handleSaveActiveNode}
        />
        <WorkflowEditor
          canvasContainerRef={canvasContainerRef}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodes={renderNodes}
          edges={renderEdges}
          nodeMenu={nodeMenu}
          edgeMenu={edgeMenu}
          panelMenu={panelMenu}
          selectionMenu={selectionMenu}
          canPaste={clipboard.nodes.length > 0}
          connectionLineComponent={CustomConnectionLine}
          connectionLineZIndex={ITERATION_CHILDREN_Z_INDEX}
          actions={{
            flow: {
              onNodesChange,
              onEdgesChange,
              onConnect,
              onNodeDragStop: handleNodeDragStop,
              onNodeClick: (_, node) => {
                setActiveNode(node)
              },
              onPaneClick: clearMenus,
              onNodeContextMenu: (event, node) => {
                if (parseChildNodeId(node.id))
                  return
                handleNodeContextMenu(event, node)
              },
              onEdgeContextMenu: (event, edge) => {
                if (parseChildEdgeId(edge.id))
                  return
                handleEdgeContextMenu(event, edge)
              },
              onPaneContextMenu: handlePaneContextMenu,
            },
            nodeMenu: {
              onClose: () => setNodeMenu(undefined),
              onCopy: () => copySelection(nodeMenu ? [nodeMenu.nodeId] : []),
              onDuplicate: () => duplicateSelection(nodeMenu ? [nodeMenu.nodeId] : []),
              onDelete: () => deleteSelection(nodeMenu ? [nodeMenu.nodeId] : []),
            },
            edgeMenu: {
              onClose: () => setEdgeMenu(undefined),
              onDelete: () => deleteSelection([], edgeMenu ? [edgeMenu.edgeId] : []),
            },
            panelMenu: {
              onClose: () => setPanelMenu(undefined),
              onPaste: () => pasteClipboard(panelMenu),
              onExport: exportDSL,
              onImport: () => setImportOpen(true),
            },
            selectionMenu: {
              onClose: () => setSelectionMenu(undefined),
              onCopy: () => copySelection(),
              onDuplicate: () => duplicateSelection(),
              onDelete: () => deleteSelection(),
              onAlign: alignSelection,
            },
            quickPanel: {
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
            },
          }}
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
}

const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(({ initialDSL, workflowId, onDSLChange }, ref) => {
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
      <WorkflowCanvasInner initialDSL={safeInitialDSL} workflowId={workflowId} onDSLChange={onDSLChange} apiRef={ref} />
    </ReactFlowProvider>
  )
})

WorkflowCanvas.displayName = 'WorkflowCanvas'

export default WorkflowCanvas
