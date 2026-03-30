'use client'

import type { DifyEdge, DifyNode } from '../core/types'
import WorkflowRunPage from './WorkflowRunPage'

type WorkflowRunModalProps = {
  open: boolean
  nodes: DifyNode[]
  edges: DifyEdge[]
  onClose: () => void
}

export default function WorkflowRunModal({
  open,
  nodes,
  edges,
  onClose,
}: WorkflowRunModalProps) {
  if (!open)
    return null

  return (
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
          <WorkflowRunPage nodes={nodes} edges={edges} />
        </div>
      </div>
    </div>
  )
}
