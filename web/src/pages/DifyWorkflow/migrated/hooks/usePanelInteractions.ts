import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useDifyWorkflowStore } from "../store";

export function usePanelInteractions() {
  const workflowStore = useDifyWorkflowStore();

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      event.preventDefault();
      workflowStore.setNodeMenu(undefined);
      workflowStore.setEdgeMenu(undefined);
      workflowStore.setSelectionMenu(undefined);
      workflowStore.setPanelMenu({
        clientX: event.clientX,
        clientY: event.clientY
      });
    },
    [workflowStore]
  );

  const handlePaneContextmenuCancel = useCallback(() => {
    workflowStore.setPanelMenu(undefined);
  }, [workflowStore]);

  const handleEdgeContextmenuCancel = useCallback(() => {
    workflowStore.setEdgeMenu(undefined);
  }, [workflowStore]);

  const handleSelectionContextmenuCancel = useCallback(() => {
    workflowStore.setSelectionMenu(undefined);
  }, [workflowStore]);

  const handleNodeContextmenuCancel = useCallback(() => {
    workflowStore.setNodeMenu(undefined);
  }, [workflowStore]);

  return {
    handlePaneContextMenu,
    handlePaneContextmenuCancel,
    handleEdgeContextmenuCancel,
    handleSelectionContextmenuCancel,
    handleNodeContextmenuCancel
  };
}
