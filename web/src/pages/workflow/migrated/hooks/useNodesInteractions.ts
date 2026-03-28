import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Node } from "@xyflow/react";
import { useWorkflowStore } from "../store";
import type { DifyNodeData } from "../types";

export function useNodesInteractions() {
  const workflowStore = useWorkflowStore();
  const dragNodeStartPosition = useRef({ x: 0, y: 0 });

  const handleNodeDragStart = useCallback(
    (_: ReactMouseEvent, node: Node<DifyNodeData>) => {
      workflowStore.setNodeAnimation(false);
      dragNodeStartPosition.current = {
        x: node.position.x,
        y: node.position.y
      };
    },
    [workflowStore]
  );

  const handleNodeDragStop = useCallback(
    (_: ReactMouseEvent, node: Node<DifyNodeData>) => {
      const { x, y } = dragNodeStartPosition.current;
      if (x !== node.position.x || y !== node.position.y) {
        workflowStore.setPanelMenu(undefined);
      }
    },
    [workflowStore]
  );

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node<DifyNodeData>) => {
      event.preventDefault();
      workflowStore.setNodeMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        nodeId: node.id
      });
      workflowStore.setEdgeMenu(undefined);
      workflowStore.setPanelMenu(undefined);
      workflowStore.setSelectionMenu(undefined);
    },
    [workflowStore]
  );

  return {
    handleNodeDragStart,
    handleNodeDragStop,
    handleNodeContextMenu
  };
}
