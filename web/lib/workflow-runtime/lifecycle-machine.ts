import { createActor, createMachine } from 'xstate'
import type { ExecutionStatus, LifecycleEvent } from './types'

const workflowLifecycleMachine = createMachine({
  id: 'workflow-lifecycle',
  initial: 'idle',
  states: {
    idle: {
      on: {
        BEGIN: { target: 'running' },
      },
    },
    running: {
      on: {
        WAIT_INPUT: { target: 'waiting_input' },
        COMPLETE: { target: 'completed' },
        FAIL: { target: 'failed' },
        CANCEL: { target: 'cancelled' },
      },
    },
    waiting_input: {
      on: {
        RESUME: { target: 'running' },
        FAIL: { target: 'failed' },
        CANCEL: { target: 'cancelled' },
      },
    },
    completed: { type: 'final' },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
  },
})

const statusMap: Record<string, ExecutionStatus> = {
  running: 'running',
  waiting_input: 'waiting_input',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  idle: 'running',
}

export const getStatusFromLifecycleEvents = (events: LifecycleEvent[]): ExecutionStatus => {
  const actor = createActor(workflowLifecycleMachine)
  actor.start()
  events.forEach(event => actor.send(event))
  const state = String(actor.getSnapshot().value)
  return statusMap[state] ?? 'running'
}
