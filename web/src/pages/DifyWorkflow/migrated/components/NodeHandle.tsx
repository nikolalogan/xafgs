import { Handle, Position } from "@xyflow/react";

type Props = {
  id: string;
  kind: "source" | "target";
};

function NodeHandle({ id, kind }: Props) {
  return (
    <Handle
      id={id}
      type={kind}
      position={kind === "source" ? Position.Right : Position.Left}
      style={{
        width: 10,
        height: 10,
        border: "2px solid #296dff",
        background: "#fff"
      }}
    />
  );
}

export default NodeHandle;

