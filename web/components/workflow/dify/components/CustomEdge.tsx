import type { EdgeProps } from 'reactflow'
import { memo, useMemo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position } from 'reactflow'
import CustomEdgeLinearGradientRender from './CustomEdgeLinearGradientRender'
import { NodeRunningStatus } from '../core/types'
import { getEdgeColor } from '../core/utils'

const CustomEdge = ({ id, data, sourceX, sourceY, targetX, targetY, selected, sourcePosition, targetPosition }: EdgeProps) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sourceX - 4,
    sourceY,
    sourcePosition: sourcePosition ?? Position.Right,
    targetX: targetX + 4,
    targetY,
    targetPosition: targetPosition ?? Position.Left,
    borderRadius: 18,
    offset: 22,
  })

  const sourceStatus = data?._sourceRunningStatus ?? NodeRunningStatus.Idle
  const targetStatus = data?._targetRunningStatus ?? NodeRunningStatus.Idle

  const linearGradientId = useMemo(() => {
    if (
      (sourceStatus === NodeRunningStatus.Succeeded || sourceStatus === NodeRunningStatus.Failed || sourceStatus === NodeRunningStatus.Exception)
      && (targetStatus === NodeRunningStatus.Succeeded || targetStatus === NodeRunningStatus.Failed || targetStatus === NodeRunningStatus.Exception || targetStatus === NodeRunningStatus.Running)
    )
      return id
    return undefined
  }, [id, sourceStatus, targetStatus])

  const stroke = useMemo(() => {
    if (data?._forceStroke)
      return data._forceStroke

    if (selected)
      return '#0f172a'

    if (linearGradientId)
      return `url(#${linearGradientId})`

    if (data?._connectedNodeIsHovering)
      return '#334155'

    return '#94a3b8'
  }, [data?._connectedNodeIsHovering, data?._forceStroke, linearGradientId, selected])

  const edgeStyle = useMemo(() => ({
    stroke,
    strokeWidth: selected ? 2.8 : 2.2,
    opacity: data?._waitingRun ? 0.72 : 1,
    strokeDasharray: data?._waitingRun ? '6 4' : undefined,
  }), [data?._waitingRun, selected, stroke])

  return (
    <>
      {linearGradientId && (
        <CustomEdgeLinearGradientRender
          id={linearGradientId}
          startColor={getEdgeColor(sourceStatus)}
          stopColor={getEdgeColor(targetStatus)}
          position={{ x1: sourceX, y1: sourceY, x2: targetX, y2: targetY }}
        />
      )}
      <BaseEdge id={id} path={edgePath} style={edgeStyle} interactionWidth={26} />
      {selected && data?._onDelete && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.5)] transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onClick={(event) => {
              event.stopPropagation()
              data._onDelete?.(id)
            }}
            aria-label="Delete edge"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 stroke-current" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(CustomEdge)
