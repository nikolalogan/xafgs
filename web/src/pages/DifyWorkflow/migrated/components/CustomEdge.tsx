import { memo, useMemo } from "react";
import { BaseEdge, getBezierPath, Position, type EdgeProps } from "@xyflow/react";
import { NodeRunningStatus } from "../types";
import { getEdgeColor } from "../utils";
import CustomEdgeLinearGradientRender from "./CustomEdgeLinearGradientRender";

const CustomEdge = ({ id, data, sourceX, sourceY, targetX, targetY, selected }: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16
  });

  const sourceStatus = data?._sourceRunningStatus as NodeRunningStatus | undefined;
  const targetStatus = data?._targetRunningStatus as NodeRunningStatus | undefined;

  const linearGradientId = useMemo(() => {
    if (!sourceStatus || !targetStatus) return undefined;
    return `${id}-gradient`;
  }, [id, sourceStatus, targetStatus]);

  const stroke = useMemo(() => {
    if (selected) return getEdgeColor(NodeRunningStatus.Running);
    if (linearGradientId) return `url(#${linearGradientId})`;
    return getEdgeColor();
  }, [linearGradientId, selected]);

  return (
    <>
      {linearGradientId ? (
        <CustomEdgeLinearGradientRender
          id={linearGradientId}
          startColor={getEdgeColor(sourceStatus)}
          stopColor={getEdgeColor(targetStatus)}
          position={{ x1: sourceX, y1: sourceY, x2: targetX, y2: targetY }}
        />
      ) : null}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: 2,
          opacity: data?._waitingRun ? 0.7 : 1
        }}
      />
    </>
  );
};

export default memo(CustomEdge);

