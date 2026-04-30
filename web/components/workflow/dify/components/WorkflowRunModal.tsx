'use client'

import type { DifyEdge, DifyNode, WorkflowGlobalVariable, WorkflowObjectType, WorkflowParameter } from '../core/types'
import { createPortal } from 'react-dom'
import WorkflowRunPage from './WorkflowRunPage'

type WorkflowRunModalProps = {
  open: boolean
  workflowId?: number
  nodes: DifyNode[]
  edges: DifyEdge[]
  objectTypes?: WorkflowObjectType[]
  globalVariables?: WorkflowGlobalVariable[]
  workflowParameters?: WorkflowParameter[]
  onClose: () => void
}

export default function WorkflowRunModal({
  open,
  workflowId,
  nodes,
  edges,
  objectTypes = [],
  globalVariables = [],
  workflowParameters = [],
  onClose,
}: WorkflowRunModalProps) {
  if (!open)
    return null

  const modal = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="h-[92vh] w-[94vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">流程运行</div>
            <div className="text-xs text-gray-500">执行预览 + 节点过程追踪</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
          >
            关闭
          </button>
        </div>
        <div className="h-[calc(92vh-64px)] p-3">
          <WorkflowRunPage workflowId={workflowId} nodes={nodes} edges={edges} objectTypes={objectTypes} globalVariables={globalVariables} workflowParameters={workflowParameters} />
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined')
    return modal

  return createPortal(modal, document.body)
}
