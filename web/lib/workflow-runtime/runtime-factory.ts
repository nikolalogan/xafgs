import { InMemoryExecutionStore } from './store'
import type { RuntimeDriver, WorkflowRuntimePort } from './types'
import { XStateWorkflowRuntime } from './xstate-runtime'

class TemporalWorkflowRuntimeStub implements WorkflowRuntimePort {
  async start(_: Parameters<WorkflowRuntimePort['start']>[0]): ReturnType<WorkflowRuntimePort['start']> {
    throw new Error('Temporal runtime 尚未接入，请将 WORKFLOW_RUNTIME_DRIVER 设置为 xstate')
  }

  async resume(_: Parameters<WorkflowRuntimePort['resume']>[0]): ReturnType<WorkflowRuntimePort['resume']> {
    throw new Error('Temporal runtime 尚未接入，请将 WORKFLOW_RUNTIME_DRIVER 设置为 xstate')
  }

  async get(_: Parameters<WorkflowRuntimePort['get']>[0]): ReturnType<WorkflowRuntimePort['get']> {
    throw new Error('Temporal runtime 尚未接入，请将 WORKFLOW_RUNTIME_DRIVER 设置为 xstate')
  }

  async cancel(_: Parameters<WorkflowRuntimePort['cancel']>[0]): ReturnType<WorkflowRuntimePort['cancel']> {
    throw new Error('Temporal runtime 尚未接入，请将 WORKFLOW_RUNTIME_DRIVER 设置为 xstate')
  }
}

const store = new InMemoryExecutionStore()

const xstateRuntime = new XStateWorkflowRuntime(store)
const temporalRuntime = new TemporalWorkflowRuntimeStub()

export const getWorkflowRuntime = (): WorkflowRuntimePort => {
  const driver = (process.env.WORKFLOW_RUNTIME_DRIVER ?? 'xstate') as RuntimeDriver
  if (driver === 'temporal')
    return temporalRuntime
  return xstateRuntime
}
