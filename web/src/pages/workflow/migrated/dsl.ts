import type { Edge, Node } from "@xyflow/react";
import type { DifyNodeData } from "./types";

export type DifyDSL = {
  version: string;
  graph: {
    nodes: Node<DifyNodeData, "difyNode">[];
    edges: Edge[];
  };
};

export const toDSL = (nodes: Node<DifyNodeData, "difyNode">[], edges: Edge[]): DifyDSL => ({
  version: "0.1.0",
  graph: {
    nodes,
    edges
  }
});

export const parseDSL = (raw: string): { nodes: Node<DifyNodeData, "difyNode">[]; edges: Edge[] } => {
  const parsed = JSON.parse(raw) as any;
  if (parsed?.graph?.nodes && parsed?.graph?.edges) {
    return {
      nodes: parsed.graph.nodes,
      edges: parsed.graph.edges
    };
  }
  if (parsed?.nodes && parsed?.edges) {
    return {
      nodes: parsed.nodes,
      edges: parsed.edges
    };
  }
  throw new Error("DSL 格式不正确，缺少 graph.nodes/graph.edges 或 nodes/edges");
};

export const validateDSL = (nodes: Node<DifyNodeData, "difyNode">[], edges: Edge[]) => {
  const errors: string[] = [];
  const nodeIDSet = new Set<string>();
  let startCount = 0;
  let endCount = 0;

  nodes.forEach((node) => {
    if (nodeIDSet.has(node.id)) errors.push(`存在重复节点ID：${node.id}`);
    nodeIDSet.add(node.id);
    if (String(node.data?.type) === "start") startCount += 1;
    if (String(node.data?.type) === "end") endCount += 1;
  });

  edges.forEach((edge) => {
    if (!nodeIDSet.has(edge.source)) errors.push(`连线源节点不存在：${edge.source}`);
    if (!nodeIDSet.has(edge.target)) errors.push(`连线目标节点不存在：${edge.target}`);
  });

  if (nodes.length === 0) errors.push("节点不能为空");
  if (startCount === 0) errors.push("至少需要一个 Start 节点");
  if (endCount === 0) errors.push("至少需要一个 End 节点");

  return errors;
};

