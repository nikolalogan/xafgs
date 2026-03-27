import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { DifyNodeData } from "./types";

export type MenuPosition = {
  clientX: number;
  clientY: number;
  edgeId?: string;
  nodeId?: string;
};

type WorkflowUIState = {
  nodeAnimation: boolean;
  controlMode: "pointer" | "hand";
  nodeMenu?: MenuPosition;
  edgeMenu?: MenuPosition;
  panelMenu?: MenuPosition;
  selectionMenu?: MenuPosition;
  clipboardNodes: Node<DifyNodeData, "difyNode">[];
  clipboardEdges: Edge[];
  setNodeAnimation: (value: boolean) => void;
  setControlMode: (value: "pointer" | "hand") => void;
  setNodeMenu: (value?: MenuPosition) => void;
  setEdgeMenu: (value?: MenuPosition) => void;
  setPanelMenu: (value?: MenuPosition) => void;
  setSelectionMenu: (value?: MenuPosition) => void;
  setClipboard: (nodes: Node<DifyNodeData, "difyNode">[], edges: Edge[]) => void;
};

const WorkflowUIContext = createContext<WorkflowUIState | null>(null);

export function DifyWorkflowStoreProvider({ children }: PropsWithChildren) {
  const [nodeAnimation, setNodeAnimation] = useState(false);
  const [controlMode, setControlMode] = useState<"pointer" | "hand">("pointer");
  const [nodeMenu, setNodeMenu] = useState<MenuPosition | undefined>(undefined);
  const [edgeMenu, setEdgeMenu] = useState<MenuPosition | undefined>(undefined);
  const [panelMenu, setPanelMenu] = useState<MenuPosition | undefined>(undefined);
  const [selectionMenu, setSelectionMenu] = useState<MenuPosition | undefined>(undefined);
  const [clipboardNodes, setClipboardNodes] = useState<Node<DifyNodeData, "difyNode">[]>([]);
  const [clipboardEdges, setClipboardEdges] = useState<Edge[]>([]);

  const setClipboard = (nodes: Node<DifyNodeData, "difyNode">[], edges: Edge[]) => {
    setClipboardNodes(nodes);
    setClipboardEdges(edges);
  };

  const value = useMemo(
    () => ({
      nodeAnimation,
      controlMode,
      nodeMenu,
      edgeMenu,
      panelMenu,
      selectionMenu,
      clipboardNodes,
      clipboardEdges,
      setNodeAnimation,
      setControlMode,
      setNodeMenu,
      setEdgeMenu,
      setPanelMenu,
      setSelectionMenu,
      setClipboard
    }),
    [clipboardEdges, clipboardNodes, controlMode, edgeMenu, nodeAnimation, nodeMenu, panelMenu, selectionMenu]
  );

  return <WorkflowUIContext.Provider value={value}>{children}</WorkflowUIContext.Provider>;
}

export function useDifyWorkflowStore() {
  const context = useContext(WorkflowUIContext);
  if (!context) throw new Error("Missing DifyWorkflowStoreProvider");
  return context;
}
