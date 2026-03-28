import { useCallback, useEffect } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { DifyNodeData } from "../types";
import { useWorkflowStore } from "../store";

type Params = {
  nodes: Node<DifyNodeData, "difyNode">[];
  edges: Edge[];
  setNodes: (value: Node<DifyNodeData, "difyNode">[] | ((current: Node<DifyNodeData, "difyNode">[]) => Node<DifyNodeData, "difyNode">[])) => void;
  setEdges: (value: Edge[] | ((current: Edge[]) => Edge[])) => void;
  onUndo: () => void;
  onRedo: () => void;
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (element.isContentEditable) return true;
  if (element.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return true;
  return false;
};

export function useShortcutsClipboard({ nodes, edges, setNodes, setEdges, onUndo, onRedo }: Params) {
  const store = useWorkflowStore();

  const copySelection = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    if (selectedNodes.length === 0) return;
    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdges = edges.filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target));
    store.setClipboard(clone(selectedNodes), clone(selectedEdges));
  }, [edges, nodes, store]);

  const pasteSelection = useCallback(() => {
    if (store.clipboardNodes.length === 0) return;
    const idMap = new Map<string, string>();
    const offsetX = 80;
    const offsetY = 60;

    const pastedNodes = store.clipboardNodes.map((node) => {
      const newId = `${node.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      idMap.set(node.id, newId);
      return {
        ...clone(node),
        id: newId,
        selected: true,
        position: {
          x: node.position.x + offsetX,
          y: node.position.y + offsetY
        }
      };
    });

    const pastedEdges = store.clipboardEdges.reduce<Edge[]>((acc, edge) => {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) return acc;
        acc.push({
          ...clone(edge),
          id: `${source}-${edge.sourceHandle || "source"}-${target}-${edge.targetHandle || "target"}`,
          source,
          target,
          selected: false
        });
        return acc;
      }, []);

    setNodes((current) => current.map((node) => ({ ...node, selected: false })).concat(pastedNodes));
    setEdges((current) => current.concat(pastedEdges));
  }, [setEdges, setNodes, store.clipboardEdges, store.clipboardNodes]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMeta = event.ctrlKey || event.metaKey;
      if (!isMeta) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();

      if (key === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if (key === "v") {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [copySelection, onRedo, onUndo, pasteSelection]);

  return {
    copySelection,
    pasteSelection,
    hasClipboard: store.clipboardNodes.length > 0
  };
}
