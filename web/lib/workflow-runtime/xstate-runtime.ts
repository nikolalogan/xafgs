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
  .replace(/\[(\d+)\]/g, '.$1')

const setByPath = (target: Record<string, unknown>, rawPath: string, value: unknown) => {
  const keys = normalizePath(rawPath).split('.').map(item => item.trim()).filter(Boolean)
  if (keys.length === 0)
    return
  let current: Record<string, unknown> = target
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]
    const nextValue = current[key]
    if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue))
      current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
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
      const enqueue = (nodeId?: string) => {
        if (!nodeId || pushed.has(nodeId))
          return
        queue.push(nodeId)
        pushed.add(nodeId)
      }

      if (options?.resumedNodeId)
        enqueue(options.resumedNodeId)
      else
        enqueue(getStartNodeId(execution.workflowDsl.nodes))

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
          branchEdges.forEach(edge => enqueue(edge.target))
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
        outgoingEdges.forEach(edge => enqueue(edge.target))
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
