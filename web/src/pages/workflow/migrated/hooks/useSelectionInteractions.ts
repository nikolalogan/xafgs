import { useCallback } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { OnSelectionChangeFunc } from "@xyflow/react";
import { useWorkflowStore } from "../store";
import type { DifyNodeData } from "../types";

type Params = {
  nodes: Node<DifyNodeData, "difyNode">[];
  edges: Edge[];
  setNodes: (value: Node<DifyNodeData, "difyNode">[] | ((current: Node<DifyNodeData, "difyNode">[]) => Node<DifyNodeData, "difyNode">[])) => void;
  setEdges: (value: Edge[] | ((current: Edge[]) => Edge[])) => void;
};

export function useSelectionInteractions({ nodes, edges, setNodes, setEdges }: Params) {
  const workflowStore = useWorkflowStore();

  const handleSelectionStart = useCallback(() => {
    workflowStore.setSelectionMenu(undefined);
  }, [workflowStore]);

  const handleSelectionChange = useCallback<OnSelectionChangeFunc>(
    ({ nodes, edges }) => {
      const hasSelection = (nodes?.length ?? 0) > 0 || (edges?.length ?? 0) > 0;
      const selectedNodeIds = new Set((nodes ?? []).map((item) => item.id));
      const selectedEdgeIds = new Set((edges ?? []).map((item) => item.id));

      setNodes((current) =>
        current.map((item) => ({
          ...item,
          data: {
            ...item.data,
            _isBundled: selectedNodeIds.has(item.id)
          }
        }))
      );
      setEdges((current) =>
        current.map((item) => ({
          ...item,
          data: {
            ...(item.data ?? {}),
            _isBundled: selectedEdgeIds.has(item.id)
          }
        }))
      );

      if (!hasSelection) workflowStore.setSelectionMenu(undefined);
    },
    [setEdges, setNodes, workflowStore]
  );

  const handleSelectionDrag = useCallback(
    (_event: MouseEvent, nodesWithDrag: Array<Node<DifyNodeData, "difyNode">>) => {
      const dragNodeMap = new Map(nodesWithDrag.map((item) => [item.id, item.position]));
      if (dragNodeMap.size === 0) return;
      workflowStore.setNodeAnimation(false);
      setNodes((current) =>
        current.map((item) => {
          const nextPosition = dragNodeMap.get(item.id);
          if (!nextPosition) return item;
          return {
            ...item,
            position: nextPosition
          };
        })
      );
    },
    [setNodes, workflowStore]
  );

  const handleSelectionCancel = useCallback(() => {
    setNodes((current) =>
      current.map((item) => ({
        ...item,
        data: {
          ...item.data,
          _isBundled: false
        }
      }))
    );
    setEdges((current) =>
      current.map((item) => ({
        ...item,
        data: {
          ...(item.data ?? {}),
          _isBundled: false
        }
      }))
    );
    workflowStore.setSelectionMenu(undefined);
  }, [setEdges, setNodes, workflowStore]);

  const handleSelectionContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      workflowStore.setSelectionMenu({
        clientX: event.clientX,
        clientY: event.clientY
      });
      workflowStore.setNodeMenu(undefined);
      workflowStore.setEdgeMenu(undefined);
      workflowStore.setPanelMenu(undefined);
    },
    [workflowStore]
  );

  return {
    handleSelectionStart,
    handleSelectionChange,
    handleSelectionDrag,
    handleSelectionCancel,
    handleSelectionContextMenu
  };
}
