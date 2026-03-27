import type { Edge, Node } from "@xyflow/react";
import type { BaseNodeData } from "./types";

export function getAncestorNodeIDs(
  nodeID: string,
  edges: Edge[],
  options?: { includeSelf?: boolean }
): Set<string> {
  const includeSelf = options?.includeSelf ?? false;
  const reverseMap = new Map<string, string[]>();

  edges.forEach((edge) => {
    const list = reverseMap.get(edge.target) ?? [];
    list.push(edge.source);
    reverseMap.set(edge.target, list);
  });

  const result = new Set<string>();
  const stack = [...(reverseMap.get(nodeID) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    const parents = reverseMap.get(current) ?? [];
    parents.forEach((parent) => stack.push(parent));
  }

  if (includeSelf) result.add(nodeID);
  return result;
}

export function hasWorkflowCycle(nodes: Node<BaseNodeData, "baseNode">[], edges: Edge[]) {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  nodes.forEach((node) => {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  });
  edges.forEach((edge) => {
    const next = adjacency.get(edge.source);
    if (next) next.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  });

  const queue: string[] = [];
  inDegree.forEach((degree, nodeID) => {
    if (degree === 0) queue.push(nodeID);
  });

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    const nextList = adjacency.get(current) ?? [];
    nextList.forEach((target) => {
      const nextDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextDegree);
      if (nextDegree === 0) queue.push(target);
    });
  }

  return visited !== nodes.length;
}
