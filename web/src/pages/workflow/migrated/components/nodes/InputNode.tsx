import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function InputNode({ id, data }: NodeProps<DifyNode>) {
  const forms = data.input_config?.forms ?? [];
  const fields = data.input_config?.fields ?? [];
  return (
    <BaseCard id={id} data={data} blockLabel="INPUT" tagColor="cyan">
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <div>表单数量：{forms.length}</div>
        {fields.length === 0 ? <div>暂无输入字段</div> : fields.map((field) => <div key={field.id}>- {field.label} ({field.value_type})</div>)}
      </div>
    </BaseCard>
  );
}

export default InputNode;
