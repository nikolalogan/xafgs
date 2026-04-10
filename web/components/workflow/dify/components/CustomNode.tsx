import { memo, useCallback, useRef } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { buildIfElseBranchHandleId, IF_ELSE_FALLBACK_HANDLE } from '@/lib/workflow-ifelse'
import { ensureNodeConfig } from '../core/node-config'
import { BlockEnum, type DifyNodeData } from '../core/types'

const typeColorMap: Record<BlockEnum, string> = {
  [BlockEnum.Start]: 'bg-green-100 text-green-700',
  [BlockEnum.End]: 'bg-red-100 text-red-700',
  [BlockEnum.LLM]: 'bg-blue-100 text-blue-700',
  [BlockEnum.IfElse]: 'bg-amber-100 text-amber-700',
  [BlockEnum.Iteration]: 'bg-teal-100 text-teal-700',
  [BlockEnum.Code]: 'bg-purple-100 text-purple-700',
  [BlockEnum.HttpRequest]: 'bg-cyan-100 text-cyan-700',
  [BlockEnum.ApiRequest]: 'bg-slate-100 text-slate-700',
  [BlockEnum.Input]: 'bg-indigo-100 text-indigo-700',
}

const typeLabelMap: Record<BlockEnum, string> = {
  [BlockEnum.Start]: '开始',
  [BlockEnum.End]: '结束',
  [BlockEnum.LLM]: 'LLM',
  [BlockEnum.IfElse]: '条件分支',
  [BlockEnum.Iteration]: '迭代',
  [BlockEnum.Code]: '代码',
  [BlockEnum.HttpRequest]: 'HTTP',
  [BlockEnum.ApiRequest]: 'API 请求',
  [BlockEnum.Input]: '输入',
}

const CustomNode = ({ data, selected }: NodeProps<DifyNodeData>) => {
  const isStart = data.type === BlockEnum.Start
  const isEnd = data.type === BlockEnum.End
  const isIterationContainer = data.type === BlockEnum.Iteration && !data.parentIterationId
  const isIterationChild = Boolean(data.parentIterationId)
  const isIterationCollapsed = Boolean(data._iterationCollapsed)
  const resizeStateRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!data._onResizeIterationCanvas)
      return
    event.preventDefault()
    event.stopPropagation()
    resizeStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: data._iterationCanvasWidth || 760,
      startHeight: data._iterationCanvasHeight || 420,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state)
        return
      data._onResizeIterationCanvas?.({
        width: state.startWidth + (moveEvent.clientX - state.startX),
        height: state.startHeight + (moveEvent.clientY - state.startY),
      }, false)
    }

    const handleMouseUp = (upEvent: MouseEvent) => {
      const state = resizeStateRef.current
      resizeStateRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (!state)
        return
      data._onResizeIterationCanvas?.({
        width: state.startWidth + (upEvent.clientX - state.startX),
        height: state.startHeight + (upEvent.clientY - state.startY),
      }, true)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [data])

  if (isIterationContainer) {
    return (
      <div className={`relative h-full w-full overflow-hidden rounded-2xl border bg-teal-50/70 ${selected ? 'border-teal-500 ring-2 ring-teal-200' : 'border-teal-200'}`}>
        <Handle id="target" type="target" position={Position.Left} className="!h-2 !w-2 !bg-teal-500" />
        <div className="flex h-10 items-center justify-between border-b border-teal-200 bg-white/80 px-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">{data.title}</div>
            <div className="text-[11px] text-teal-700">
              {isIterationCollapsed ? '已收起 · 点击右侧展开' : '循环区域 · 主画布内编辑'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                data._onToggleIterationCollapse?.()
              }}
              className="rounded border border-teal-200 bg-white px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-50"
            >
              {isIterationCollapsed ? '展开' : '收起'}
            </button>
            <span className={`rounded px-2 py-0.5 text-xs ${typeColorMap[data.type]}`}>{typeLabelMap[data.type]}</span>
          </div>
        </div>
        <div className="px-3 py-2 text-xs text-teal-700">
          {isIterationCollapsed ? '当前仅显示循环摘要，内部节点与连线已隐藏。' : '迭代子流程区域（主画布内编辑）'}
        </div>
        {!isIterationCollapsed && (
          <button
            type="button"
            aria-label="调整迭代区域大小"
            title="拖拽调整迭代区域大小"
            onMouseDown={handleResizeStart}
            className="nodrag nopan absolute bottom-2 right-2 h-4 w-4 cursor-se-resize rounded border border-teal-300 bg-white/90 text-teal-600 shadow-sm hover:bg-teal-50"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.4">
              <path d="M6 14 14 6M10 14l4-4M14 10l-4 4" />
            </svg>
          </button>
        )}
        <Handle id="source" type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />
      </div>
    )
  }

  if (data.type === BlockEnum.IfElse) {
    const config = ensureNodeConfig(BlockEnum.IfElse, data.config)
    const branchItems = [
      ...config.conditions.map((item, index) => ({
        handleId: buildIfElseBranchHandleId(index),
        name: item.name || `分支${index + 1}`,
      })),
      {
        handleId: IF_ELSE_FALLBACK_HANDLE,
        name: config.elseBranchName || 'else',
      },
    ]

    return (
      <div className={`${isIterationChild ? 'w-56' : 'w-64'} rounded-2xl border bg-white p-3 shadow-sm ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
        <Handle id="target" type="target" position={Position.Left} style={{ left: -3 }} className="!h-2 !w-2 !bg-gray-400" />
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">{data.title}</div>
          <span className={`rounded px-2 py-0.5 text-xs ${typeColorMap[data.type]}`}>{typeLabelMap[data.type]}</span>
        </div>
        <div className="space-y-1 text-xs text-gray-600">
          {branchItems.map((item, index) => {
            return (
              <div key={item.handleId} className="relative rounded bg-gray-50 px-2 py-1 pr-5">
                <span>{item.name}</span>
                <Handle
                  id={item.handleId}
                  type="source"
                  position={Position.Right}
                  style={{ top: '50%', right: -3, transform: 'translateY(-50%)' }}
                  className="!h-2 !w-2 !bg-gray-500"
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={`${isIterationChild ? 'w-52' : 'w-60'} rounded-2xl border bg-white p-3 shadow-sm ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
      {!isStart && <Handle id="target" type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">{data.title}</div>
        <span className={`rounded px-2 py-0.5 text-xs ${typeColorMap[data.type]}`}>{typeLabelMap[data.type]}</span>
      </div>
      <div className="text-xs text-gray-500">{data.desc || '-'}</div>
      {!isEnd && <Handle id="source" type="source" position={Position.Right} className="!h-2 !w-2 !bg-gray-400" />}
    </div>
  )
}

const areEqual = (prev: Readonly<NodeProps<DifyNodeData>>, next: Readonly<NodeProps<DifyNodeData>>) => {
  return prev.selected === next.selected
    && prev.data.type === next.data.type
    && prev.data.title === next.data.title
    && prev.data.desc === next.data.desc
    && prev.data.config === next.data.config
    && prev.data.parentIterationId === next.data.parentIterationId
    && prev.data._iterationCollapsed === next.data._iterationCollapsed
    && prev.data._iterationCanvasWidth === next.data._iterationCanvasWidth
    && prev.data._iterationCanvasHeight === next.data._iterationCanvasHeight
    && prev.data._onToggleIterationCollapse === next.data._onToggleIterationCollapse
    && prev.data._onResizeIterationCanvas === next.data._onResizeIterationCanvas
}

export default memo(CustomNode, areEqual)
