import type { WorkflowDSL } from '../workflow-types'

export type RuntimeDriver = 'xstate' | 'temporal'

export type ExecutionStatus = 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'

export type NodeRunStatus = 'pending' | 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'skipped'

export type ExecutionNodeState = {
  nodeId: string
  status: NodeRunStatus
  startedAt?: string
  endedAt?: string
  error?: string
}

export type ExecutionWaitingInput = {
  nodeId: string
  nodeTitle: string
  schema: Record<string, unknown>
}

export type ExecutionEvent = {
  id: string
  type: string
  at: string
  payload?: Record<string, unknown>
}

export type WorkflowExecution = {
  id: string
  workflowDsl: WorkflowDSL
  status: ExecutionStatus
  nodeStates: Record<string, ExecutionNodeState>
  variables: Record<string, unknown>
  outputs?: Record<string, unknown>
  waitingInput?: ExecutionWaitingInput
  error?: string
  lifecycleEvents: LifecycleEvent[]
  events: ExecutionEvent[]
  createdAt: string
  updatedAt: string
}

export type StartExecutionInput = {
  workflowDsl: WorkflowDSL
  input?: Record<string, unknown>
}

export type ResumeExecutionInput = {
  executionId: string
  nodeId: string
  input: Record<string, unknown>
}

export type WorkflowRuntimePort = {
  start(input: StartExecutionInput): Promise<WorkflowExecution>
  resume(input: ResumeExecutionInput): Promise<WorkflowExecution>
  get(executionId: string): Promise<WorkflowExecution | null>
  cancel(executionId: string): Promise<WorkflowExecution>
}

export type LifecycleEvent =
  | { type: 'BEGIN' }
  | { type: 'WAIT_INPUT' }
  | { type: 'RESUME' }
  | { type: 'COMPLETE' }
  | { type: 'FAIL' }
  | { type: 'CANCEL' }
