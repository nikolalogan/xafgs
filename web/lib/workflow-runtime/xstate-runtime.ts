import { randomUUID } from 'node:crypto'
import { parseWorkflowDSL } from '../workflow-dsl'
import type { WorkflowEdge, WorkflowNode } from '../workflow-types'
import { createExecutorRegistry } from './executors'
import { buildExecutionPlan } from './graph'
import { getStatusFromLifecycleEvents } from './lifecycle-machine'
import type { ExecutionStorePort } from './store'
import type {
  ExecutionNodeState,
  ResumeExecutionInput,
  StartExecutionInput,
  WorkflowExecution,
  WorkflowRuntimePort,
} from './types'

type RunOptions = {
  resumedNodeId?: string
  resumedInput?: Record<string, unknown>
}

const now = () => new Date().toISOString()

const asNodeState = (nodeId: string): ExecutionNodeState => ({
  nodeId,
  status: 'pending',
})

const normalizeError = (error: unknown) => (error instanceof Error ? error.message : 'workflow 执行失败')
const normalizePath = (path: string) => path
  .trim()
  .replace(/^\$\./, '')
  .replace(/^\$/, '')
  .replace(/\[\]$/, '')
  .replace(/\[(\d+)\]/g, '.$1')

const splitPath = (path: string) => normalizePath(path).split('.').map(item => item.trim()).filter(Boolean)

const normalizeWritebackTargetPath = (rawPath: string, value: unknown) => {
  const trimmed = String(rawPath || '').trim()
  if (!trimmed || !Array.isArray(value))
    return trimmed

  const keys = splitPath(trimmed)
  if (keys.length < 2)
    return trimmed

  let end = keys.length
  while (end > 0 && /^\d+$/.test(keys[end - 1]))
    end -= 1

  if (end === keys.length || end === 0)
    return trimmed
  return keys.slice(0, end).join('.')
}

const setByPath = (target: Record<string, unknown>, rawPath: string, value: unknown) => {
  const keys = splitPath(normalizeWritebackTargetPath(rawPath, value))
  if (keys.length === 0)
    return

  const isIndex = (key: string) => /^\d+$/.test(key)
  const ensureArrayLength = (list: unknown[], index: number) => {
    if (index < list.length)
      return list
    const next = [...list]
    while (next.length <= index)
      next.push(undefined)
    return next
  }

  const setAny = (current: unknown, path: string[], nextValue: unknown): unknown => {
    if (path.length === 0)
      return current

    if (path.length === 1) {
      if (Array.isArray(current)) {
        const index = Number(path[0])
        if (!Number.isInteger(index))
          return current
        const next = ensureArrayLength(current, index)
        next[index] = nextValue
        return next
      }

      if (!current || typeof current !== 'object' || Array.isArray(current))
        return current

      return {
        ...(current as Record<string, unknown>),
        [path[0]]: nextValue,
      }
    }

    const [key, nextKey, ...rest] = path
    const childShouldBeArray = isIndex(nextKey)

    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index))
        return current
      const next = ensureArrayLength(current, index)
      const child = next[index]
      next[index] = setAny(
        child ?? (childShouldBeArray ? [] : {}),
        [nextKey, ...rest],
        nextValue,
      )
      return next
    }

    const base = current && typeof current === 'object' && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {}
    const child = base[key]
    return {
      ...base,
      [key]: setAny(
        child ?? (childShouldBeArray ? [] : {}),
        [nextKey, ...rest],
        nextValue,
      ),
    }
  }

  const updated = setAny(target, keys, value)
  if (!updated || typeof updated !== 'object' || Array.isArray(updated))
    return

  Object.keys(target).forEach(key => delete target[key])
  Object.assign(target, updated)
}

const getStartNodeId = (nodes: WorkflowNode[]) => {
  const startNode = nodes.find(node => node.data.type === 'start')
  if (startNode)
    return startNode.id
  return nodes[0]?.id
}

const getOutgoingEdgesMap = (edges: WorkflowEdge[]) => {
  const map = new Map<string, WorkflowEdge[]>()
  edges.forEach((edge) => {
    map.set(edge.source, [...(map.get(edge.source) ?? []), edge])
  })
  return map
}

const getIncomingSourcesMap = (edges: WorkflowEdge[]) => {
  const map = new Map<string, Set<string>>()
  edges.forEach((edge) => {
    if (!edge.source || !edge.target)
      return
    const set = map.get(edge.target) ?? new Set<string>()
    set.add(edge.source)
    map.set(edge.target, set)
  })
  return map
}

const shouldWaitAllIncoming = (node: WorkflowNode | undefined, incomingCount: number) => {
  if (!node)
    return incomingCount > 1
  const config = node.data?.config
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return incomingCount > 1
  const raw = config as Record<string, unknown>
  const mode = typeof raw.joinMode === 'string' ? raw.joinMode : ''
  if (mode === 'any' || mode === 'wait_any' || mode === 'first')
    return false
  const joinAll = raw.joinAll === true || mode === 'all' || mode === 'wait_all'
  if (joinAll)
    return true
  return incomingCount > 1
}

const selectIfElseNextEdges = (edges: WorkflowEdge[], handleId: string) => {
  const matched = edges.filter((edge) => edge.sourceHandle === handleId)
  if (matched.length > 0)
    return matched

  return edges.slice(0, 1)
}

export class XStateWorkflowRuntime implements WorkflowRuntimePort {
  constructor(private readonly store: ExecutionStorePort) {}

  async start(input: StartExecutionInput): Promise<WorkflowExecution> {
    const workflowDsl = parseWorkflowDSL(input.workflowDsl)
    const createdAt = now()
    const plan = buildExecutionPlan(workflowDsl)
    const nodeStates = Object.fromEntries(plan.map(nodeId => [nodeId, asNodeState(nodeId)]))
    const execution: WorkflowExecution = {
      id: randomUUID(),
      workflowDsl,
      status: 'running',
      nodeStates,
      variables: input.input ?? {},
      lifecycleEvents: [{ type: 'BEGIN' }],
      events: [],
      createdAt,
      updatedAt: createdAt,
    }
    const result = await this.runUntilPauseOrEnd(execution)
    await this.store.save(result)
    return result
  }

  async resume(input: ResumeExecutionInput): Promise<WorkflowExecution> {
    const execution = await this.store.get(input.executionId)
    if (!execution)
      throw new Error('execution 不存在')
    if (execution.status !== 'waiting_input')
      throw new Error(`当前状态 ${execution.status} 不允许 resume`)
    if (!execution.waitingInput || execution.waitingInput.nodeId !== input.nodeId)
      throw new Error('等待中的节点与提交节点不匹配')

    const resumed: WorkflowExecution = {
      ...execution,
      waitingInput: undefined,
      updatedAt: now(),
      lifecycleEvents: [...execution.lifecycleEvents, { type: 'RESUME' }],
      events: [
        ...execution.events,
        {
          id: randomUUID(),
          type: 'input.resumed',
          at: now(),
          payload: { nodeId: input.nodeId },
        },
      ],
    }
    const result = await this.runUntilPauseOrEnd(resumed, {
      resumedNodeId: input.nodeId,
      resumedInput: input.input,
    })
    await this.store.save(result)
    return result
  }

  async get(executionId: string): Promise<WorkflowExecution | null> {
    return this.store.get(executionId)
  }

  async cancel(executionId: string): Promise<WorkflowExecution> {
    const execution = await this.store.get(executionId)
    if (!execution)
      throw new Error('execution 不存在')
    const cancelled: WorkflowExecution = {
      ...execution,
      lifecycleEvents: [...execution.lifecycleEvents, { type: 'CANCEL' }],
      status: 'cancelled',
      updatedAt: now(),
      events: [
        ...execution.events,
        {
          id: randomUUID(),
          type: 'execution.cancelled',
          at: now(),
        },
      ],
    }
    await this.store.save(cancelled)
    return cancelled
  }

  private async runUntilPauseOrEnd(execution: WorkflowExecution, options?: RunOptions): Promise<WorkflowExecution> {
    try {
      const executors = createExecutorRegistry()
      const plan = buildExecutionPlan(execution.workflowDsl)
      const nodeMap = new Map<string, WorkflowNode>(execution.workflowDsl.nodes.map(node => [node.id, node]))
      const outgoingEdgesMap = getOutgoingEdgesMap(execution.workflowDsl.edges)
      const incomingSourcesMap = getIncomingSourcesMap(execution.workflowDsl.edges)
      const nextExecution: WorkflowExecution = {
        ...execution,
        nodeStates: { ...execution.nodeStates },
        variables: { ...execution.variables },
        events: [...execution.events],
        updatedAt: now(),
      }

      const maxSteps = Math.max(plan.length * 8, 32)
      const queue: string[] = []
      const pushed = new Set<string>()
      const arrivedSources = new Map<string, Set<string>>()
      const seedArrivedFromHistory = () => {
        const branchHandleByNode = new Map<string, string>()
        nextExecution.events.forEach((event) => {
          if (event.type !== 'node.branch' || !event.payload)
            return
          const nodeId = typeof event.payload.nodeId === 'string' ? event.payload.nodeId.trim() : ''
          const handleId = typeof event.payload.handleId === 'string' ? event.payload.handleId.trim() : ''
          if (!nodeId || !handleId)
            return
          branchHandleByNode.set(nodeId, handleId)
        })

        Object.entries(nextExecution.nodeStates).forEach(([nodeId, state]) => {
          if (state.status !== 'succeeded')
            return
          const node = nodeMap.get(nodeId)
          if (!node)
            return
          const outgoingEdges = outgoingEdgesMap.get(nodeId) ?? []
          if (outgoingEdges.length === 0)
            return

          if (node.data.type === 'if-else') {
            const handleId = branchHandleByNode.get(nodeId)
            if (!handleId)
              return
            selectIfElseNextEdges(outgoingEdges, handleId).forEach((edge) => {
              markArrived(edge.target, nodeId)
            })
            return
          }

          outgoingEdges.forEach((edge) => {
            markArrived(edge.target, nodeId)
          })
        })
      }
      const enqueue = (nodeId?: string) => {
        if (!nodeId || pushed.has(nodeId))
          return
        const node = nodeMap.get(nodeId)
        const expected = incomingSourcesMap.get(nodeId)
        if (shouldWaitAllIncoming(node, expected?.size ?? 0)) {
          if (expected && expected.size > 0) {
            const arrived = arrivedSources.get(nodeId) ?? new Set<string>()
            if (arrived.size < expected.size)
              return
          }
        }

        queue.push(nodeId)
        pushed.add(nodeId)
      }
      const markArrived = (targetId: string, sourceId: string) => {
        const set = arrivedSources.get(targetId) ?? new Set<string>()
        set.add(sourceId)
        arrivedSources.set(targetId, set)
      }
      const canEnqueueFromHistory = (nodeId: string) => {
        const expected = incomingSourcesMap.get(nodeId)
        if (!expected || expected.size === 0)
          return true
        const arrived = arrivedSources.get(nodeId) ?? new Set<string>()
        if (shouldWaitAllIncoming(nodeMap.get(nodeId), expected.size))
          return arrived.size >= expected.size
        return arrived.size > 0
      }
      const enqueueEligiblePendingNodes = () => {
        plan.forEach((nodeId) => {
          if (pushed.has(nodeId))
            return
          const state = nextExecution.nodeStates[nodeId]
          if (state && state.status !== 'pending')
            return
          if (!canEnqueueFromHistory(nodeId))
            return
          enqueue(nodeId)
        })
      }

      if (options?.resumedNodeId)
        seedArrivedFromHistory()

      if (options?.resumedNodeId) {
        // resume 的节点此前已进入 waiting_input：此处应强制入队，避免多入边 join 策略阻塞 resume
        queue.push(options.resumedNodeId)
        pushed.add(options.resumedNodeId)
      }
      else
        enqueue(getStartNodeId(execution.workflowDsl.nodes))
      if (options?.resumedNodeId)
        enqueueEligiblePendingNodes()

      let stepCount = 0
      while (queue.length > 0) {
        stepCount += 1
        if (stepCount > maxSteps)
          throw new Error('检测到可能的循环执行，请检查流程连线')

        const nodeId = queue.shift()
        if (!nodeId)
          continue
        const node = nodeMap.get(nodeId)
        if (!node)
          continue

        const state = nextExecution.nodeStates[nodeId] ?? asNodeState(nodeId)
        if (state.status === 'succeeded' || state.status === 'skipped')
          continue

        const executor = executors[node.data.type] ?? executors.start
        const nextState: ExecutionNodeState = {
          ...state,
          status: 'running',
          startedAt: state.startedAt ?? now(),
        }
        nextExecution.nodeStates[nodeId] = nextState

        const nodeInput = options?.resumedNodeId === nodeId ? options.resumedInput : undefined
        const result = await executor.execute({
          node,
          variables: nextExecution.variables,
          nodeInput,
        })

        if (result.type === 'waiting_input') {
          nextExecution.nodeStates[nodeId] = {
            ...nextState,
            status: 'waiting_input',
          }
          nextExecution.waitingInput = {
            nodeId,
            nodeTitle: node.data.title,
            schema: result.schema,
          }
          nextExecution.lifecycleEvents = [...nextExecution.lifecycleEvents, { type: 'WAIT_INPUT' }]
          nextExecution.status = getStatusFromLifecycleEvents(nextExecution.lifecycleEvents)
          nextExecution.updatedAt = now()
          nextExecution.events.push({
            id: randomUUID(),
            type: 'node.waiting_input',
            at: now(),
            payload: { nodeId },
          })
          return nextExecution
        }

        if (result.type === 'branch') {
          nextExecution.nodeStates[nodeId] = {
            ...nextState,
            status: 'succeeded',
            endedAt: now(),
          }
          const output = result.output ?? {}
          nextExecution.variables[nodeId] = output
          nextExecution.events.push({
            id: randomUUID(),
            type: 'node.branch',
            at: now(),
            payload: { nodeId, handleId: result.handleId, branchName: result.branchName },
          })
          const outgoingEdges = outgoingEdgesMap.get(nodeId) ?? []
          const branchEdges = selectIfElseNextEdges(outgoingEdges, result.handleId)
          branchEdges.forEach((edge) => {
            markArrived(edge.target, nodeId)
            enqueue(edge.target)
          })
          continue
        }

        if (result.type === 'failed') {
          nextExecution.nodeStates[nodeId] = {
            ...nextState,
            status: 'failed',
            endedAt: now(),
            error: result.error,
          }
          nextExecution.error = result.error
          nextExecution.lifecycleEvents = [...nextExecution.lifecycleEvents, { type: 'FAIL' }]
          nextExecution.status = getStatusFromLifecycleEvents(nextExecution.lifecycleEvents)
          nextExecution.updatedAt = now()
          nextExecution.events.push({
            id: randomUUID(),
            type: 'node.failed',
            at: now(),
            payload: { nodeId, error: result.error },
          })
          return nextExecution
        }

        nextExecution.nodeStates[nodeId] = {
          ...nextState,
          status: 'succeeded',
          endedAt: now(),
        }
        const output = result.output ?? {}
        nextExecution.variables[nodeId] = output
        if (result.writebacks?.length) {
          result.writebacks.forEach((mapping) => {
            if (!mapping.targetPath.trim())
              return
            setByPath(nextExecution.variables, mapping.targetPath, mapping.value)
          })
        }
        nextExecution.events.push({
          id: randomUUID(),
          type: 'node.succeeded',
          at: now(),
          payload: { nodeId },
        })

        const outgoingEdges = outgoingEdgesMap.get(nodeId) ?? []
        outgoingEdges.forEach((edge) => {
          markArrived(edge.target, nodeId)
          enqueue(edge.target)
        })
      }

      Object.entries(nextExecution.nodeStates).forEach(([nodeId, state]) => {
        if (state.status === 'pending') {
          nextExecution.nodeStates[nodeId] = {
            ...state,
            status: 'skipped',
          }
          nextExecution.events.push({
            id: randomUUID(),
            type: 'node.skipped',
            at: now(),
            payload: { nodeId },
          })
        }
      })

      nextExecution.outputs = { ...nextExecution.variables }
      nextExecution.lifecycleEvents = [...nextExecution.lifecycleEvents, { type: 'COMPLETE' }]
      nextExecution.status = getStatusFromLifecycleEvents(nextExecution.lifecycleEvents)
      nextExecution.updatedAt = now()
      nextExecution.events.push({
        id: randomUUID(),
        type: 'execution.completed',
        at: now(),
      })
      return nextExecution
    }
    catch (error) {
      return {
        ...execution,
        lifecycleEvents: [...execution.lifecycleEvents, { type: 'FAIL' }],
        status: getStatusFromLifecycleEvents([...execution.lifecycleEvents, { type: 'FAIL' }]),
        error: normalizeError(error),
        updatedAt: now(),
        events: [
          ...execution.events,
          {
            id: randomUUID(),
            type: 'execution.failed',
            at: now(),
            payload: { error: normalizeError(error) },
          },
        ],
      }
    }
  }
}
