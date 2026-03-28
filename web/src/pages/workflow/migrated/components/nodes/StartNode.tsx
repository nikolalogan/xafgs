import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function StartNode({ id, data }: NodeProps<DifyNode>) {
  const fields = data.input_config?.fields ?? [];
  return (
    <BaseCard id={id} data={data} blockLabel="START" tagColor="green" showTarget={false}>
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>工作流入口节点</div>
        <div>参数数量：{fields.length}</div>
        {fields.slice(0, 3).map((field) => (
          <div key={field.id}>
            - {field.label} ({field.value_type})
            {field.required ? " *" : ""}
          </div>
        ))}
      </div>
    </BaseCard>
  );
}

export default StartNode;
