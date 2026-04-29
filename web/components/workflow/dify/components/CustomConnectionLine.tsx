import type { ConnectionLineComponentProps } from 'reactflow'
import { memo } from 'react'
import { getSmoothStepPath, Position } from 'reactflow'

const CustomConnectionLine = ({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) => {
  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: Position.Right,
    targetX: toX,
    targetY: toY,
    targetPosition: Position.Left,
    borderRadius: 18,
    offset: 22,
  })

  return (
    <g>
      <path fill="none" stroke="#94A3B8" strokeWidth={2.2} strokeDasharray="6 4" d={edgePath} />
      <circle cx={toX} cy={toY} r={3.4} fill="#0F172A" />
    </g>
  )
}

export default memo(CustomConnectionLine)
