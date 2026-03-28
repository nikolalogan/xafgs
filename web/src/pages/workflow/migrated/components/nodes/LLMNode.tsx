import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function LLMNode({ id, data }: NodeProps<DifyNode>) {
  const config = data.llm_config;
  return (
    <BaseCard id={id} data={data} blockLabel="LLM" tagColor="purple">
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>模型：{config?.model || "gpt-4o-mini"}</div>
        <div>Temperature：{config?.temperature ?? 0.7}</div>
        <div>Top P：{config?.top_p ?? 1}</div>
        <div>Max Tokens：{config?.max_tokens ?? 1024}</div>
      </div>
    </BaseCard>
  );
}

export default LLMNode;
