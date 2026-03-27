import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function HttpRequestNode({ id, data }: NodeProps<DifyNode>) {
  const config = data.http_config;
  return (
    <BaseCard id={id} data={data} blockLabel="HTTP" tagColor="volcano">
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>方法：{config?.method || "GET"}</div>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>URL：{config?.url || "-"}</div>
        <div>Header：{config?.headers?.length ?? 0}，Query：{config?.query?.length ?? 0}</div>
        <div>Body：{config?.body_mode || "none"}</div>
      </div>
    </BaseCard>
  );
}

export default HttpRequestNode;
