import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Tag } from "antd";
import type { DifyNode } from "../types";
import NodeHandle from "./NodeHandle";

const CustomNode = ({ id, data }: NodeProps<DifyNode>) => {
  const isBundled = !!(data as any)._isBundled;
  return (
    <div
      style={{
        width: 240,
        borderRadius: 14,
        border: isBundled ? "1px solid #296dff" : "1px solid #eaecf0",
        background: "#fcfcfd",
        boxShadow: isBundled ? "0 0 0 2px rgba(41,109,255,0.14)" : "0 1px 2px rgba(16,24,40,0.06)",
        padding: 12,
        position: "relative"
      }}
    >
      <NodeHandle id={`${id}-target`} kind="target" />
      {data.type !== "if-else" && data.type !== "question-classifier" && data.type !== "human-input" ? (
        <NodeHandle id={`${id}-source`} kind="source" />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Tag color="blue" style={{ margin: 0 }}>
          {String(data.type)}
        </Tag>
        <div style={{ fontWeight: 600, color: "#101828", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.title}</div>
      </div>
      {data.desc ? <div style={{ color: "#667085", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{data.desc}</div> : null}
    </div>
  );
};

export default memo(CustomNode);
