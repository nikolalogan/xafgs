import type { NodeProps } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function EndNode({ id, data }: NodeProps<DifyNode>) {
  return (
    <BaseCard id={id} data={data} blockLabel="END" tagColor="red" showSource={false}>
      <div style={{ color: "#475467", fontSize: 12 }}>工作流结束节点</div>
    </BaseCard>
  );
}

export default EndNode;

