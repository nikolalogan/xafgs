import type { WorkflowExecution } from './types'

export type ExecutionStorePort = {
  save(execution: WorkflowExecution): Promise<void>
  get(executionId: string): Promise<WorkflowExecution | null>
}

export class InMemoryExecutionStore implements ExecutionStorePort {
  private readonly records = new Map<string, WorkflowExecution>()

  async save(execution: WorkflowExecution): Promise<void> {
    this.records.set(execution.id, execution)
  }

  async get(executionId: string): Promise<WorkflowExecution | null> {
    return this.records.get(executionId) ?? null
  }
}
