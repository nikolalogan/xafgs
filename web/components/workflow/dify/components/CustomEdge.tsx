import type { EdgeProps } from 'reactflow'
import { memo, useMemo } from 'react'
import { BaseEdge, getBezierPath, Position } from 'reactflow'
import CustomEdgeLinearGradientRender from './CustomEdgeLinearGradientRender'
import { NodeRunningStatus } from '../core/types'
import { getEdgeColor } from '../core/utils'

const CustomEdge = ({ id, data, sourceX, sourceY, targetX, targetY, selected }: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
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
      return getEdgeColor(NodeRunningStatus.Running)

    if (linearGradientId)
      return `url(#${linearGradientId})`

    if (data?._connectedNodeIsHovering)
      return getEdgeColor(NodeRunningStatus.Running)

    return getEdgeColor()
  }, [data?._connectedNodeIsHovering, data?._forceStroke, linearGradientId, selected])

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
      <BaseEdge id={id} path={edgePath} style={{ stroke, strokeWidth: 2, opacity: data?._waitingRun ? 0.7 : 1 }} />
    </>
  )
}

export default memo(CustomEdge)
