import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { DifyNodeData } from "../types";

type GraphSnapshot = {
  nodes: Node<DifyNodeData, "difyNode">[];
  edges: Edge[];
};

type Params = {
  nodes: Node<DifyNodeData, "difyNode">[];
  edges: Edge[];
  setNodes: (value: Node<DifyNodeData, "difyNode">[] | ((current: Node<DifyNodeData, "difyNode">[]) => Node<DifyNodeData, "difyNode">[])) => void;
  setEdges: (value: Edge[] | ((current: Edge[]) => Edge[])) => void;
};

const cloneSnapshot = (snapshot: GraphSnapshot): GraphSnapshot => JSON.parse(JSON.stringify(snapshot)) as GraphSnapshot;

const normalizeNode = (node: Node<DifyNodeData, "difyNode">) => {
  const { selected, dragging, ...rest } = node as any;
  const nextData = { ...(rest.data ?? {}) };
  delete (nextData as any)._connectedNodeIsHovering;
  delete (nextData as any)._isBundled;
  return { ...rest, data: nextData };
};

const normalizeEdge = (edge: Edge) => {
  const { selected, ...rest } = edge as any;
  const nextData = { ...(rest.data ?? {}) };
  delete (nextData as any)._connectedNodeIsHovering;
  delete (nextData as any)._isBundled;
  return { ...rest, data: nextData };
};

const normalizeSnapshot = (snapshot: GraphSnapshot): GraphSnapshot => ({
  nodes: snapshot.nodes.map(normalizeNode),
  edges: snapshot.edges.map(normalizeEdge)
});

const isEqualSnapshot = (a: GraphSnapshot, b: GraphSnapshot) =>
  JSON.stringify(normalizeSnapshot(a)) === JSON.stringify(normalizeSnapshot(b));

export function useWorkflowHistory({ nodes, edges, setNodes, setEdges }: Params) {
  const historyRef = useRef<GraphSnapshot[]>([]);
  const futureRef = useRef<GraphSnapshot[]>([]);
  const applyingRef = useRef(false);
  const batchingRef = useRef(false);
  const [version, setVersion] = useState(0);

  const currentSnapshot = useMemo<GraphSnapshot>(() => ({ nodes, edges }), [edges, nodes]);

  useEffect(() => {
    if (applyingRef.current) {
      applyingRef.current = false;
      return;
    }
    if (batchingRef.current) return;
    if (historyRef.current.length === 0) {
      historyRef.current.push(cloneSnapshot(currentSnapshot));
      setVersion((value) => value + 1);
      return;
    }
    const latest = historyRef.current[historyRef.current.length - 1];
    if (isEqualSnapshot(latest, currentSnapshot)) return;
    historyRef.current.push(cloneSnapshot(currentSnapshot));
    if (historyRef.current.length > 80) historyRef.current.shift();
    futureRef.current = [];
    setVersion((value) => value + 1);
  }, [currentSnapshot]);

  const undo = useCallback(() => {
    if (historyRef.current.length <= 1) return;
    const current = historyRef.current.pop()!;
    futureRef.current.push(cloneSnapshot(current));
    const target = historyRef.current[historyRef.current.length - 1];
    applyingRef.current = true;
    setNodes(cloneSnapshot(target).nodes);
    setEdges(cloneSnapshot(target).edges);
    setVersion((value) => value + 1);
  }, [setEdges, setNodes]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const target = futureRef.current.pop()!;
    historyRef.current.push(cloneSnapshot(target));
    applyingRef.current = true;
    setNodes(cloneSnapshot(target).nodes);
    setEdges(cloneSnapshot(target).edges);
    setVersion((value) => value + 1);
  }, [setEdges, setNodes]);

  const canUndo = historyRef.current.length > 1;
  const canRedo = futureRef.current.length > 0;

  const beginBatch = useCallback(() => {
    batchingRef.current = true;
  }, []);

  const commitBatch = useCallback(() => {
    if (!batchingRef.current) return;
    batchingRef.current = false;
    if (historyRef.current.length === 0) {
      historyRef.current.push(cloneSnapshot(currentSnapshot));
      futureRef.current = [];
      setVersion((value) => value + 1);
      return;
    }
    const latest = historyRef.current[historyRef.current.length - 1];
    if (isEqualSnapshot(latest, currentSnapshot)) return;
    historyRef.current.push(cloneSnapshot(currentSnapshot));
    if (historyRef.current.length > 80) historyRef.current.shift();
    futureRef.current = [];
    setVersion((value) => value + 1);
  }, [currentSnapshot]);

  return {
    version,
    canUndo,
    canRedo,
    undo,
    redo,
    beginBatch,
    commitBatch
  };
}
