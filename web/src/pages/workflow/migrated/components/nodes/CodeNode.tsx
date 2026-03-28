import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function CodeNode({ id, data }: NodeProps<DifyNode>) {
  const config = data.code_config;
  const inCount = config?.input_mapping?.length ?? 0;
  const outCount = config?.output_mapping?.length ?? 0;
  return (
    <BaseCard id={id} data={data} blockLabel="CODE" tagColor="geekblue">
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>语言：{config?.language || "javascript"}</div>
        <div>超时：{config?.timeout_ms ?? 3000}ms</div>
        <div>输入映射：{inCount}，输出映射：{outCount}</div>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          代码：{String(config?.script ?? "").split("\n")[0] || "-"}
        </div>
      </div>
    </BaseCard>
  );
}

export default CodeNode;
