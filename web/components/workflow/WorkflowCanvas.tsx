'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import CustomConnectionLine from './dify/components/CustomConnectionLine'
import DSLModals from './dify/components/DSLModals'
import NodeConfigPanel from './dify/components/NodeConfigPanel'
import WorkflowEditor from './dify/components/WorkflowEditor'
import WorkflowToolbar from './dify/components/WorkflowToolbar'
import WorkflowRunModal from './dify/components/WorkflowRunModal'
import { demoDSL, edgeTypes, nodeTypeLabel, nodeTypes } from './dify/config/workflowPreset'
import { CUSTOM_EDGE, CUSTOM_NODE, ITERATION_CHILDREN_Z_INDEX } from './dify/core/constants'
import { ensureNodeConfig } from './dify/core/node-config'
import { BlockEnum, type DifyEdge, type DifyNode, type IterationNodeConfig, type WorkflowParameter } from './dify/core/types'
import { validateWorkflow } from './dify/core/validation'
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

type WorkflowCanvasInnerProps = {
  initialDSL: DifyWorkflowDSL
  onDSLChange?: (dsl: DifyWorkflowDSL) => void
  apiRef?: React.Ref<WorkflowCanvasHandle>
}

type WorkflowRunSnapshot = {
  nodes: DifyNode[]
  edges: DifyEdge[]
  workflowParameters: WorkflowParameter[]
}

export type WorkflowCanvasHandle = {
  flushActiveNode: () => void
  getDSL: () => DifyWorkflowDSL
}

function WorkflowCanvasInner({ initialDSL, onDSLChange, apiRef }: WorkflowCanvasInnerProps) {
  const [runModalOpen, setRunModalOpen] = useState(false)
  const [runSnapshot, setRunSnapshot] = useState<WorkflowRunSnapshot>({ nodes: [], edges: [], workflowParameters: [] })
  const latestNodesRef = useRef<DifyNode[]>([])
  const latestEdgesRef = useRef<DifyEdge[]>([])
  const latestWorkflowParametersRef = useRef<WorkflowParameter[]>([])
  const lastReportedDSLRef = useRef('')
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
  }, [edges, nodes, workflowParameters])

  useEffect(() => {
    const openRunModal = () => {
      setRunSnapshot({
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
  const issues = validateWorkflow(nodes, edges, workflowParameters)

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
    let nextNodes = nodes
    let changed = false
    const movingIterationParents = new Set<string>()

    changes.forEach((change) => {
      if (!('id' in change))
        return
      if (change.type !== 'position' || !change.position)
        return
      const targetNode = nodes.find(node => node.id === change.id)
      if (targetNode?.data.type === BlockEnum.Iteration)
        movingIterationParents.add(change.id)
    })

    changes.forEach((change) => {
      if (change.type === 'dimensions')
        return

      if (!('id' in change)) {
        mainChanges.push(change)
        return
      }
      const childRef = parseChildNodeId(change.id)
      if (!childRef) {
        mainChanges.push(change)
        return
      }

      if (change.type === 'position' && change.position) {
        if (movingIterationParents.has(childRef.parentId))
          return
        const layout = iterationLayouts[childRef.parentId]
        if (!layout)
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
                x: Math.max(0, nextPosition.x - layout.paddingX),
                y: Math.max(0, nextPosition.y - layout.paddingY),
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

    if (mainChanges.length > 0) {
      nextNodes = applyNodeChanges(mainChanges, nextNodes) as DifyNode[]
      changed = true
    }

    if (!changed)
      return

    const hasMeaningfulNodeUpdate = (prev: DifyNode[], next: DifyNode[]) => {
      if (prev === next)
        return false
      if (prev.length !== next.length)
        return true

      const prevById = new Map(prev.map(node => [node.id, node]))
      for (const node of next) {
        const old = prevById.get(node.id)
        if (!old)
          return true

        const x1 = node.position?.x ?? 0
        const y1 = node.position?.y ?? 0
        const x0 = old.position?.x ?? 0
        const y0 = old.position?.y ?? 0
        if (x1 !== x0 || y1 !== y0)
          return true

        if (Boolean(node.selected) !== Boolean(old.selected))
          return true
      }
      return false
    }

    if (!hasMeaningfulNodeUpdate(nodes, nextNodes))
      return

    setNodes(nextNodes)
    record({ nodes: nextNodes, edges })
  }, [edges, iterationLayouts, nodes, record, setNodes, updateIterationChildren])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const mainChanges: EdgeChange[] = []
    let nextNodes = nodes
    let nextEdges = edges
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

      nextNodes = updateIterationChildren(nextNodes, childRef.parentId, children => ({
        ...children,
        edges: children.edges.filter(edge => edge.id !== childRef.childEdgeId),
      }))
      changed = true
    })

    if (mainChanges.length > 0) {
      nextEdges = applyEdgeChanges(mainChanges, edges) as DifyEdge[]
      setEdges(nextEdges)
      changed = true
    }

    if (!changed)
      return

    if (nextNodes !== nodes)
      setNodes(nextNodes)
    record({ nodes: nextNodes, edges: nextEdges })
  }, [edges, nodes, record, setEdges, setNodes, updateIterationChildren])

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

    const createdNode = addNode(type)
    if (!createdNode)
      return

    setActiveNode(createdNode)
    if (type === BlockEnum.Iteration)
      fitView({ nodes: [{ id: createdNode.id }], duration: 220, padding: 0.28 })
  }

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
      return nodes.map(item => (item.id === activeNode.id ? activeNode : item))
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
        onRun={() => {
          setRunSnapshot({
            nodes: JSON.parse(JSON.stringify(nodes)) as DifyNode[],
            edges: JSON.parse(JSON.stringify(edges)) as DifyEdge[],
            workflowParameters: JSON.parse(JSON.stringify(workflowParameters)) as typeof workflowParameters,
          })
          setRunModalOpen(true)
        }}
        onOpenGlobalParams={() => setGlobalVariableOpen(true)}
        onOpenChecklist={() => setChecklistOpen(true)}
        onExport={exportDSL}
        onOpenImport={() => setImportOpen(true)}
        onReset={reset}
      />

      <div className="grid grid-cols-12 gap-3">
        <NodeConfigPanel
          nodes={nodes}
          workflowParameters={workflowParameters}
          globalVariables={globalVariables}
          workflowVariableScopes={workflowVariableScopes}
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
  onDSLChange?: (dsl: DifyWorkflowDSL) => void
}

const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(({ initialDSL, onDSLChange }, ref) => {
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
      <WorkflowCanvasInner initialDSL={safeInitialDSL} onDSLChange={onDSLChange} apiRef={ref} />
    </ReactFlowProvider>
  )
})

WorkflowCanvas.displayName = 'WorkflowCanvas'

export default WorkflowCanvas
