import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { DifyNode } from "../../types";
import BaseCard from "./BaseCard";

function IfElseNode({ id, data }: NodeProps<DifyNode>) {
  const branches = data.if_else_config?.branches ?? [
    { id: "branch_1", label: "分支1", match_mode: "equals", match_value: "" },
    { id: "else", label: "Else", is_else: true }
  ];

  const formatBranch = (branch: typeof branches[number]) => {
    if (branch.is_else) return "Else";
    const modeText: Record<string, string> = {
      contains: "包含",
      not_contains: "不包含",
      starts_with: "以...开头",
      ends_with: "以...结束",
      is_empty: "为空",
      is_not_empty: "不为空",
      equals: "等于",
      not_equals: "不等于",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<="
    };
    const mode = modeText[String(branch.match_mode ?? "equals")] ?? String(branch.match_mode ?? "equals");
    const valueNeeded = !["is_empty", "is_not_empty"].includes(String(branch.match_mode ?? ""));
    return `${mode}${valueNeeded ? ` ${branch.match_value ?? ""}` : ""}`.trim();
  };

  return (
    <BaseCard id={id} data={data} blockLabel="IF/ELSE" tagColor="gold" showSource={false}>
      <div style={{ color: "#475467", fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {branches.map((branch) => (
          <div key={branch.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{branch.label}</span>
            <span style={{ color: "#98a2b3", fontSize: 11 }}>{formatBranch(branch)}</span>
          </div>
        ))}
      </div>
      {branches.map((branch, index) => (
        <Handle
          key={branch.id}
          id={`${id}-branch-${branch.id}`}
          type="source"
          position={Position.Right}
          style={{
            top: `${32 + index * (52 / Math.max(1, branches.length - 1))}%`,
            width: 10,
            height: 10,
            border: "2px solid #f79009",
            background: "#fff"
          }}
        />
      ))}
    </BaseCard>
  );
}

export default IfElseNode;
