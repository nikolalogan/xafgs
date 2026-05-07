'use client'

import type { DifyEdge, DifyNode, WorkflowGlobalVariable, WorkflowObjectType, WorkflowParameter } from '../core/types'
import { createPortal } from 'react-dom'
import WorkflowRunPage from './WorkflowRunPage'

type WorkflowRunModalProps = {
  open: boolean
  workflowId?: number
  publishedVersionNo?: number
  nodes: DifyNode[]
  edges: DifyEdge[]
  objectTypes?: WorkflowObjectType[]
  globalVariables?: WorkflowGlobalVariable[]
  workflowParameters?: WorkflowParameter[]
  debugTargetNode?: DifyNode | null
  onOpenDebug?: (node: DifyNode) => void
  onClose: () => void
}

export default function WorkflowRunModal({
  open,
  workflowId,
  publishedVersionNo = 0,
  nodes,
  edges,
  objectTypes = [],
  globalVariables = [],
  workflowParameters = [],
  debugTargetNode = null,
  onOpenDebug,
  onClose,
}: WorkflowRunModalProps) {
  if (!open)
    return null

  const isPublished = publishedVersionNo > 0

  const modal = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="h-[92vh] w-[94vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">流程运行</div>
            <div className="text-xs text-gray-500">
              {isPublished
                ? '已发布版本执行预览；节点调试会基于当前草稿 DSL 仅执行当前节点'
                : '流程运行仅支持已发布版本；节点调试可直接基于当前草稿 DSL 进行'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => debugTargetNode && onOpenDebug?.(debugTargetNode)}
              disabled={!debugTargetNode}
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
            >
              调试当前节点
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="h-[calc(92vh-64px)] p-3">
          {isPublished
            ? <WorkflowRunPage workflowId={workflowId} nodes={nodes} edges={edges} objectTypes={objectTypes} globalVariables={globalVariables} workflowParameters={workflowParameters} onOpenDebug={node => onOpenDebug?.(node)} />
            : (
                <div className="flex h-full items-center justify-center">
                  <div className="w-full max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6">
                    <div className="text-base font-semibold text-amber-950">当前工作流尚未发布</div>
                    <div className="mt-2 text-sm leading-6 text-amber-900">
                      流程运行只会执行已发布版本，不会直接运行当前草稿。
                      节点调试则会直接基于当前草稿 DSL 仅执行目标节点，因此未发布草稿也可以调试节点。
                    </div>
                    {!debugTargetNode && (
                      <div className="mt-4 text-sm text-amber-900">
                        请先在画布中选中一个要测试的节点，再点击右上角“调试当前节点”。
                      </div>
                    )}
                    <div className="mt-4 rounded-xl border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-700">
                      这里仍然不能直接运行未发布草稿，但可以打开草稿态节点调试。
                    </div>
                  </div>
                </div>
              )}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined')
    return modal

  return createPortal(modal, document.body)
}
