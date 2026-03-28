import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function FileExtractorNode({ id, data }: NodeProps<DifyNode>) {
  const config = data.file_extractor_config;
  const source = config?.source || config?.input_selector || "-";
  return (
    <BaseCard id={id} data={data} blockLabel="FILE EXTRACTOR" tagColor="magenta">
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>来源：{source}</div>
        <div>模式：{config?.extraction_mode || "text"}，策略：{config?.strategy || "auto"}</div>
        <div>超时：{config?.timeout_ms ?? 10000}ms，重试：{config?.retry_count ?? 0}</div>
        <div>输出键：{config?.output_key || "extracted_text"}</div>
        <div>类型：{config?.file_types?.join(", ") || "pdf, docx, txt"}</div>
      </div>
    </BaseCard>
  );
}

export default FileExtractorNode;
