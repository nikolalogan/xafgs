import { useCallback } from "react";
import type { Edge, EdgeMouseHandler, OnEdgesChange } from "@xyflow/react";
import { applyEdgeChanges } from "@xyflow/react";
import { useDifyWorkflowStore } from "../store";

type Params = {
  edges: Edge[];
  setEdges: (value: Edge[] | ((current: Edge[]) => Edge[])) => void;
};

export function useEdgesInteractions({ edges, setEdges }: Params) {
  const workflowStore = useDifyWorkflowStore();

  const handleEdgeEnter = useCallback<EdgeMouseHandler>(
    (_, edge) => {
      setEdges((current) =>
        current.map((item) =>
          item.id === edge.id ? { ...item, data: { ...(item.data ?? {}), _connectedNodeIsHovering: true } } : item
        )
      );
    },
    [setEdges]
  );

  const handleEdgeLeave = useCallback<EdgeMouseHandler>(
    (_, edge) => {
      setEdges((current) =>
        current.map((item) =>
          item.id === edge.id ? { ...item, data: { ...(item.data ?? {}), _connectedNodeIsHovering: false } } : item
        )
      );
    },
    [setEdges]
  );

  const handleEdgesChange = useCallback<OnEdgesChange>(
    (changes) => {
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [setEdges]
  );

  const handleEdgeDeleteById = useCallback(
    (edgeId: string) => {
      setEdges((current) => current.filter((edge) => edge.id !== edgeId));
      workflowStore.setEdgeMenu(undefined);
    },
    [setEdges, workflowStore]
  );

  const handleEdgeContextMenu = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault();
      workflowStore.setNodeMenu(undefined);
      workflowStore.setPanelMenu(undefined);
      workflowStore.setSelectionMenu(undefined);
      workflowStore.setEdgeMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        edgeId: edge.id
      });
    },
    [workflowStore]
  );

  const handleEdgeDelete = useCallback(() => {
    const currentEdge = edges.find((edge) => edge.selected);
    if (!currentEdge) return;
    handleEdgeDeleteById(currentEdge.id);
  }, [edges, handleEdgeDeleteById]);

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgesChange,
    handleEdgeDeleteById,
    handleEdgeContextMenu,
    handleEdgeDelete
  };
}
