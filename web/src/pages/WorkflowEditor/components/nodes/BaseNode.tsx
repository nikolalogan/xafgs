import { memo } from "react";
import type { Node as FlowNode, NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "../../utils/types";

type Props = NodeProps<FlowNode<BaseNodeData, "baseNode">>;

const BaseNode = memo((props: Props) => {
  const { data } = props;
  const isStart = (data?.code || "").toLowerCase() === "start";
  const isEnd = (data?.code || "").toLowerCase() === "end";
  const isDecision = (data?.code || "").toLowerCase() === "decision";
  const decisionBranches = data?.params?.decisionConfig?.branches ?? [];

  return (
    <div
      style={{
        border: "1px solid #d9d9d9",
        borderRadius: 6,
        background: "#fff",
        padding: 12,
        minWidth: 160,
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)"
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{data?.name || "未命名节点"}</div>
      <div style={{ color: "#8c8c8c", fontSize: 12 }}>编码：{data?.code || "-"}</div>

      {!isStart && <Handle type="target" position={Position.Left} />}
      {!isEnd && !isDecision && <Handle type="source" position={Position.Right} />}

      {isDecision && (
        <div
          style={{
            marginTop: 12,
            borderTop: "1px solid #f0f0f0",
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            position: "relative"
          }}
        >
          {decisionBranches.length === 0 ? (
            <div style={{ color: "#bfbfbf", fontSize: 12 }}>暂无输出分支</div>
          ) : (
            decisionBranches.map((branch) => (
              <div key={branch.id} style={{ position: "relative", paddingRight: 20 }}>
                <div style={{ fontWeight: 500 }}>{branch.name || "未命名分支"}</div>
                <div style={{ color: "#8c8c8c", fontSize: 12 }}>编码：{branch.code || "-"}</div>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={branch.code || branch.id}
                  style={{
                    right: -16,
                    top: "50%",
                    transform: "translateY(-50%)"
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

export default BaseNode;
