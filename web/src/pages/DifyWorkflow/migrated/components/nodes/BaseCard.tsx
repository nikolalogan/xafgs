import type { PropsWithChildren } from "react";
import { Tag } from "antd";
import type { DifyNodeData } from "../../types";
import NodeHandle from "../NodeHandle";

type Props = PropsWithChildren<{
  id: string;
  data: DifyNodeData;
  blockLabel: string;
  tagColor?: string;
  showTarget?: boolean;
  showSource?: boolean;
  sourceHandleID?: string;
}>;

function BaseCard({
  id,
  data,
  blockLabel,
  tagColor = "blue",
  showTarget = true,
  showSource = true,
  sourceHandleID,
  children
}: Props) {
  const isBundled = !!data._isBundled;

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
      {showTarget ? <NodeHandle id={`${id}-target`} kind="target" /> : null}
      {showSource ? <NodeHandle id={sourceHandleID ?? `${id}-source`} kind="source" /> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Tag color={tagColor} style={{ margin: 0 }}>
          {blockLabel}
        </Tag>
        <div style={{ fontWeight: 600, color: "#101828", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.title}</div>
      </div>
      {children}
      {data.desc ? <div style={{ color: "#667085", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 8 }}>{data.desc}</div> : null}
    </div>
  );
}

export default BaseCard;

