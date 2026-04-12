import { CUSTOM_EDGE, CUSTOM_NODE, ITERATION_CONTAINER_PADDING_X, ITERATION_CONTAINER_PADDING_Y, ITERATION_NESTED_EDGE_PREFIX, ITERATION_NESTED_NODE_PREFIX } from './constants'
import { ensureNodeConfig } from './node-config'
import { normalizeGlobalVariables } from './global-variables'
import { normalizeWorkflowParameters } from './workflow-parameters'
import { normalizeWorkflowVariableScopes } from './workflow-variable-scopes'
import { BlockEnum, type DifyEdge, type DifyNode, type DifyWorkflowDSL, type IterationNodeConfig } from './types'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const iterationRuntimeReferencePattern = /\{\{\s*(iter-node::([^:.]+)::([^}.]+))(\.[^}]+)?\s*\}\}/g

export const buildIterationNestedNodeId = (parentId: string, childId: string) => `${ITERATION_NESTED_NODE_PREFIX}${parentId}::${childId}`
export const buildIterationNestedEdgeId = (parentId: string, childEdgeId: string) => `${ITERATION_NESTED_EDGE_PREFIX}${parentId}::${childEdgeId}`

export const parseIterationNestedNodeId = (id: string): { parentId: string; childId: string } | null => {
  if (!id.startsWith(ITERATION_NESTED_NODE_PREFIX))
    return null
  const payload = id.slice(ITERATION_NESTED_NODE_PREFIX.length)
  const [parentId, childId] = payload.split('::')
  if (!parentId || !childId)
    return null
  return { parentId, childId }
}

export const parseIterationNestedEdgeId = (id: string): { parentId: string; childEdgeId: string } | null => {
  if (!id.startsWith(ITERATION_NESTED_EDGE_PREFIX))
    return null
  const payload = id.slice(ITERATION_NESTED_EDGE_PREFIX.length)
  const [parentId, childEdgeId] = payload.split('::')
  if (!parentId || !childEdgeId)
    return null
  return { parentId, childEdgeId }
}

const parseNodes = (raw: unknown): DifyNode[] => {
  if (!Array.isArray(raw)) return []
  return raw.filter((item) => isObject(item) && typeof item.id === 'string' && isObject(item.data) && isObject(item.position)) as DifyNode[]
}

const parseEdges = (raw: unknown): DifyEdge[] => {
  if (!Array.isArray(raw)) return []
  const parsed = raw.filter((item) => isObject(item) && typeof item.id === 'string' && typeof item.source === 'string' && typeof item.target === 'string') as DifyEdge[]
  return [...new Map(parsed.map(edge => [edge.id, edge])).values()]
}

const dedupeNodesById = <T extends { id: string }>(nodes: T[]) => {
  return [...new Map(nodes.map(node => [node.id, node])).values()]
}

const dedupeEdgesById = <T extends { id: string }>(edges: T[]) => {
  return [...new Map(edges.map(edge => [edge.id, edge])).values()]
}

const getIterationParentId = (node: DifyNode | null | undefined) => {
  return node?.data.parentIterationId || node?.parentNode || null
}

const normalizeFlattenedIterationState = (nodes: DifyNode[], edges: DifyEdge[]) => {
  const normalizedNodes = nodes.map((node) => {
    const parentId = getIterationParentId(node)
    if (!parentId)
      return node
    const childId = node.data.nestedNodeId || parseIterationNestedNodeId(node.id)?.childId || node.id
    return {
      ...node,
      id: buildIterationNestedNodeId(parentId, childId),
      parentNode: parentId,
      extent: 'parent' as const,
      data: {
        ...node.data,
        parentIterationId: parentId,
        nestedNodeId: childId,
      },
    } satisfies DifyNode
  })

  const nodeById = new Map(normalizedNodes.map(node => [node.id, node]))
  const normalizedEdges = edges.map((edge) => {
    const edgePayload = parseIterationNestedEdgeId(edge.id)
    const inferredParentId = edge.data?.parentIterationId
      || edgePayload?.parentId
      || getIterationParentId(nodeById.get(edge.source))
      || getIterationParentId(nodeById.get(edge.target))
      || null
    if (!inferredParentId)
      return edge

    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    const normalizedSource = sourceNode
      ? sourceNode.id
      : buildIterationNestedNodeId(inferredParentId, parseIterationNestedNodeId(edge.source)?.childId || edge.source)
    const normalizedTarget = targetNode
      ? targetNode.id
      : buildIterationNestedNodeId(inferredParentId, parseIterationNestedNodeId(edge.target)?.childId || edge.target)
    const childEdgeId = edgePayload?.childEdgeId || edge.id

    return {
      ...edge,
      id: buildIterationNestedEdgeId(inferredParentId, childEdgeId),
      source: normalizedSource,
      target: normalizedTarget,
      data: {
        ...(edge.data ?? {}),
        parentIterationId: inferredParentId,
      },
    }
  })

  return {
    nodes: dedupeNodesById(normalizedNodes),
    edges: dedupeEdgesById(normalizedEdges),
  }
}

const stripIterationEditorMeta = (node: DifyNode): DifyNode => {
  const data = { ...node.data }
  delete data.parentIterationId
  delete data.nestedNodeId
  delete data.isIterationEntry
  delete data._iterationRole
  delete data._iterationParentId
  delete data._iterationChildId
  delete data._iterationCollapsed
  delete data._onToggleIterationCollapse
  delete data._iterationCanvasWidth
  delete data._iterationCanvasHeight
  delete data._onResizeIterationCanvas
  return {
    ...node,
    data,
  }
}

const normalizeIterationRuntimeReferences = <T,>(value: T): T => {
  if (typeof value === 'string') {
    return value.replace(iterationRuntimeReferencePattern, (_full, _rawId, _parentId, childId, suffix = '') => {
      return `{{${childId}${suffix}}}`
    }) as T
  }
  if (Array.isArray(value))
    return value.map(item => normalizeIterationRuntimeReferences(item)) as T
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeIterationRuntimeReferences(item)]),
    ) as T
  }
  return value
}

const flattenIterationChildren = (nodes: DifyNode[], edges: DifyEdge[]) => {
  const flatNodes: DifyNode[] = []
  const flatEdges: DifyEdge[] = [...edges]

  nodes.forEach((node) => {
    flatNodes.push(stripIterationEditorMeta(node))
    if (node.data.type !== BlockEnum.Iteration)
      return
    const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
    const childNodeIds = new Set(config.children.nodes.map(childNode => childNode.id))
    config.children.nodes.forEach((childNode) => {
      flatNodes.push({
        id: buildIterationNestedNodeId(node.id, childNode.id),
        type: CUSTOM_NODE,
        parentNode: node.id,
        extent: 'parent',
        position: {
          x: ITERATION_CONTAINER_PADDING_X + childNode.position.x,
          y: ITERATION_CONTAINER_PADDING_Y + childNode.position.y,
        },
        data: {
          ...childNode.data,
          title: childNode.data.title || `${childNode.data.type}-${childNode.id}`,
          config: childNode.data.config ?? ensureNodeConfig(childNode.data.type, undefined),
          parentIterationId: node.id,
          nestedNodeId: childNode.id,
          isIterationEntry: childNode.data.type === BlockEnum.Start && childNode.id === 'iter-start',
        },
        draggable: true,
        selectable: true,
      } as DifyNode)
    })
    config.children.edges.forEach((edge) => {
      const sourceChildId = parseIterationNestedNodeId(edge.source)?.childId || edge.source
      const targetChildId = parseIterationNestedNodeId(edge.target)?.childId || edge.target
      if (!childNodeIds.has(sourceChildId) || !childNodeIds.has(targetChildId))
        return
      flatEdges.push({
        id: buildIterationNestedEdgeId(node.id, edge.id),
        source: buildIterationNestedNodeId(node.id, sourceChildId),
        target: buildIterationNestedNodeId(node.id, targetChildId),
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: edge.type ?? CUSTOM_EDGE,
        data: {
          parentIterationId: node.id,
        },
      })
    })
  })

  return { nodes: flatNodes, edges: dedupeEdgesById(flatEdges) }
}

export const serializeWorkflowDSL = (dsl: DifyWorkflowDSL): DifyWorkflowDSL => {
  const nodeById = new Map(dsl.nodes.map(node => [node.id, node]))
  const resolveEdgeParentId = (edge: DifyEdge) => {
    const sourceParentId = getIterationParentId(nodeById.get(edge.source))
    const targetParentId = getIterationParentId(nodeById.get(edge.target))
    return edge.data?.parentIterationId || sourceParentId || targetParentId || null
  }

  const rootNodes = dsl.nodes.filter(node => !getIterationParentId(node))
  const rootEdges = dsl.edges.filter(edge => !resolveEdgeParentId(edge))

  const serializedNodes = rootNodes.map((node) => {
    const cleanNode = stripIterationEditorMeta(node)
    if (cleanNode.data.type !== BlockEnum.Iteration)
      return cleanNode

    const config = ensureNodeConfig(BlockEnum.Iteration, cleanNode.data.config)
    const childNodes = dsl.nodes
      .filter(item => getIterationParentId(item) === cleanNode.id)
      .map((childNode) => {
        const childId = childNode.data.nestedNodeId || parseIterationNestedNodeId(childNode.id)?.childId || childNode.id
        return {
          id: childId,
          type: 'childNode',
          position: {
            x: Math.max(0, childNode.position.x - ITERATION_CONTAINER_PADDING_X),
            y: Math.max(0, childNode.position.y - ITERATION_CONTAINER_PADDING_Y),
          },
          data: {
            title: childNode.data.title,
            desc: childNode.data.desc,
            type: childNode.data.type,
            config: normalizeIterationRuntimeReferences(childNode.data.config),
          },
        } satisfies IterationNodeConfig['children']['nodes'][number]
      })
    const childNodeIdMap = new Map(
      dsl.nodes
        .filter(item => getIterationParentId(item) === cleanNode.id)
        .map(item => [item.id, item.data.nestedNodeId || parseIterationNestedNodeId(item.id)?.childId || item.id]),
    )
    const childEdges = dedupeEdgesById(dsl.edges
      .filter(edge => resolveEdgeParentId(edge) === cleanNode.id)
      .map((edge) => {
        const edgeId = parseIterationNestedEdgeId(edge.id)?.childEdgeId || edge.id
        const sourceId = childNodeIdMap.get(edge.source) || parseIterationNestedNodeId(edge.source)?.childId || edge.source
        const targetId = childNodeIdMap.get(edge.target) || parseIterationNestedNodeId(edge.target)?.childId || edge.target
        return {
          id: edgeId,
          source: sourceId,
          target: targetId,
          type: edge.type,
          sourceHandle: edge.sourceHandle ?? undefined,
          targetHandle: edge.targetHandle ?? undefined,
        }
      })
      .filter(edge => childNodes.some(node => node.id === edge.source) && childNodes.some(node => node.id === edge.target)))

    return {
      ...cleanNode,
      data: {
        ...cleanNode.data,
        config: {
          ...config,
          children: {
            ...config.children,
            nodes: childNodes,
            edges: childEdges,
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      },
    }
  })

  return {
    ...dsl,
    nodes: serializedNodes,
    edges: dedupeEdgesById(rootEdges),
  }
}

export const parseDifyWorkflowDSL = (input: string | DifyWorkflowDSL): DifyWorkflowDSL => {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (!isObject(value)) throw new Error('DSL 根节点必须为对象')

  const parsedNodes = parseNodes(value.nodes)
  const parsedEdges = parseEdges(value.edges)
  const hasFlattenedIterationState = parsedNodes.some(node => node.data.parentIterationId)
    || parsedEdges.some(edge => Boolean(edge.data?.parentIterationId))
  const { nodes, edges } = hasFlattenedIterationState
    ? normalizeFlattenedIterationState(parsedNodes, parsedEdges)
    : flattenIterationChildren(parsedNodes, parsedEdges)

  if (!nodes.length) throw new Error('DSL 中 nodes 不能为空')

  return {
    nodes,
    edges,
    globalVariables: normalizeGlobalVariables(value.globalVariables),
    workflowParameters: normalizeWorkflowParameters(value.workflowParameters),
    workflowVariableScopes: normalizeWorkflowVariableScopes(value.workflowVariableScopes),
    viewport: isObject(value.viewport) ? (value.viewport as DifyWorkflowDSL['viewport']) : { x: 0, y: 0, zoom: 1 },
  }
}

export const toDifyWorkflowDSL = (dsl: DifyWorkflowDSL) => JSON.stringify(serializeWorkflowDSL(dsl), null, 2)
