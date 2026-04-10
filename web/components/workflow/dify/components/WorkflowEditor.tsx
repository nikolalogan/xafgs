import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  SelectionMode,
  type Connection,
  type ConnectionLineComponent,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from 'reactflow'
import { memo, useMemo } from 'react'
import EdgeContextMenu from './EdgeContextMenu'
import GlobalVariablePanel from './GlobalVariablePanel'
import NodeContextMenu from './NodeContextMenu'
import PanelContextMenu from './PanelContextMenu'
import SelectionContextMenu from './SelectionContextMenu'
import WorkflowChecklistPanel from './WorkflowChecklistPanel'
import WorkflowParamsPanel from './WorkflowParamsPanel'
import type { EdgeMenuState, NodeMenuState, PanelMenuState, SelectionMenuState } from '../core/store'
import type { WorkflowIssue } from '../core/validation'
import type { DifyEdge, DifyNode } from '../core/types'
import type { WorkflowGlobalVariable } from '../core/types'
import type { WorkflowParameter } from '../core/types'
import type { AlignDirection } from '../hooks/useSelectionLayout'
import { edgeTypes, nodeTypes } from '../config/workflowPreset'

type WorkflowEditorProps = {
  canvasContainerRef: React.RefObject<HTMLDivElement | null>
  nodes: DifyNode[]
  edges: DifyEdge[]
  nodeMenu?: NodeMenuState
  edgeMenu?: EdgeMenuState
  panelMenu?: PanelMenuState
  selectionMenu?: SelectionMenuState
  canPaste: boolean
  connectionLineComponent: ConnectionLineComponent
  connectionLineZIndex: number
  actions: {
    flow: {
      onNodesChange: (changes: NodeChange[]) => void
      onEdgesChange: (changes: EdgeChange[]) => void
      onConnect: (params: Connection) => void
      onNodeDragStop: (_: React.MouseEvent, node: DifyNode) => void
      onNodeClick: (_: React.MouseEvent, node: DifyNode) => void
      onPaneClick: () => void
      onNodeContextMenu: (event: React.MouseEvent, node: DifyNode) => void
      onEdgeContextMenu: (event: React.MouseEvent, edge: DifyEdge) => void
      onPaneContextMenu: (event: React.MouseEvent) => void
    }
    nodeMenu: {
      onClose: () => void
      onCopy: () => void
      onDuplicate: () => void
      onDelete: () => void
    }
    edgeMenu: {
      onClose: () => void
      onDelete: () => void
    }
    panelMenu: {
      onClose: () => void
      onPaste: () => void
      onExport: () => void
      onImport: () => void
    }
    selectionMenu: {
      onClose: () => void
      onCopy: () => void
      onDuplicate: () => void
      onDelete: () => void
      onAlign: (direction: AlignDirection) => void
    }
    quickPanel: {
      globalVariableOpen: boolean
      workflowParamsOpen: boolean
      checklistOpen: boolean
      issueCount: number
      globalVariables: WorkflowGlobalVariable[]
      workflowParameters: WorkflowParameter[]
      issues: WorkflowIssue[]
      onOpenGlobalVariables: () => void
      onOpenWorkflowParams: () => void
      onOpenChecklist: () => void
      onCloseGlobalVariables: () => void
      onCloseWorkflowParams: () => void
      onChangeWorkflowParams: (params: WorkflowParameter[]) => void
      onCloseChecklist: () => void
      onLocateIssueNode: (nodeId: string) => void
    }
  }
}

function WorkflowEditor({
  canvasContainerRef,
  nodes,
  edges,
  nodeMenu,
  edgeMenu,
  panelMenu,
  selectionMenu,
  canPaste,
  connectionLineComponent,
  connectionLineZIndex,
  actions,
}: WorkflowEditorProps) {
  const { quickPanel } = actions
  const stableNodeTypes = useMemo<NodeTypes>(() => nodeTypes, [])
  const stableEdgeTypes = useMemo<EdgeTypes>(() => edgeTypes, [])

  return (
    <div ref={canvasContainerRef} className="relative col-span-9 rounded-xl border border-gray-200 bg-white p-0">
      <div className="absolute right-3 top-3 z-20">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
          <button
            type="button"
            title="全局参数"
            onClick={quickPanel.onOpenGlobalVariables}
            className={`flex h-8 w-8 items-center justify-center rounded-md border ${quickPanel.globalVariableOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-transparent text-gray-600 hover:bg-gray-100'}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
              <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18Z" />
              <path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" />
            </svg>
          </button>
          <button
            type="button"
            title="流程参数"
            onClick={quickPanel.onOpenWorkflowParams}
            className={`flex h-8 w-8 items-center justify-center rounded-md border ${quickPanel.workflowParamsOpen ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-transparent text-gray-600 hover:bg-gray-100'}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
              <path d="M4 7h9M16 7h4M8 12h12M4 12h1M4 17h6M13 17h7" />
              <circle cx="13" cy="7" r="2" />
              <circle cx="6" cy="12" r="2" />
              <circle cx="11" cy="17" r="2" />
            </svg>
          </button>
          <button
            type="button"
            title="错误检查"
            onClick={quickPanel.onOpenChecklist}
            className={`relative flex h-8 w-8 items-center justify-center rounded-md border ${quickPanel.checklistOpen ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-transparent text-gray-600 hover:bg-gray-100'}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
              <path d="M9 6h10M9 12h10M9 18h10" />
              <path d="m4.5 5.5 1.4 1.4L7.8 5M4.5 11.5l1.4 1.4 1.9-1.9M4.5 17.5l1.4 1.4 1.9-1.9" />
            </svg>
            {quickPanel.issueCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                {quickPanel.issueCount}
              </span>
            )}
          </button>
        </div>
      </div>
      <div className="absolute right-3 top-14 z-20 flex flex-col gap-2">
        <GlobalVariablePanel
          open={quickPanel.globalVariableOpen}
          variables={quickPanel.globalVariables}
          onClose={quickPanel.onCloseGlobalVariables}
          mode="panel"
        />
        <WorkflowParamsPanel
          open={quickPanel.workflowParamsOpen}
          params={quickPanel.workflowParameters}
          onClose={quickPanel.onCloseWorkflowParams}
          onChange={quickPanel.onChangeWorkflowParams}
        />
        <WorkflowChecklistPanel
          open={quickPanel.checklistOpen}
          issues={quickPanel.issues}
          onClose={quickPanel.onCloseChecklist}
          onLocateNode={quickPanel.onLocateIssueNode}
          mode="panel"
        />
      </div>
      <div className="h-[75vh]">
        <ReactFlow
          nodeTypes={stableNodeTypes}
          edgeTypes={stableEdgeTypes}
          nodes={nodes}
          edges={edges}
          onNodesChange={actions.flow.onNodesChange}
          onEdgesChange={actions.flow.onEdgesChange}
          onConnect={actions.flow.onConnect}
          onNodeDragStop={actions.flow.onNodeDragStop}
          onNodeClick={actions.flow.onNodeClick}
          onPaneClick={actions.flow.onPaneClick}
          onNodeContextMenu={actions.flow.onNodeContextMenu}
          onEdgeContextMenu={actions.flow.onEdgeContextMenu}
          onPaneContextMenu={actions.flow.onPaneContextMenu}
          connectionLineComponent={connectionLineComponent}
          connectionLineContainerStyle={{ zIndex: connectionLineZIndex }}
          multiSelectionKeyCode={null}
          deleteKeyCode={null}
          nodesDraggable
          nodesFocusable={false}
          edgesFocusable={false}
          panOnScroll={false}
          selectionKeyCode={null}
          selectionMode={SelectionMode.Partial}
          minZoom={0.25}
        >
          <MiniMap
            pannable
            zoomable
            style={{ width: 102, height: 72 }}
            maskColor="rgba(15, 23, 42, 0.08)"
            className="!absolute !bottom-14 !left-4 z-[9] !m-0 !h-[72px] !w-[102px] !rounded-lg !border-[0.5px] !border-gray-200 !bg-white !shadow-md"
          />
          <Controls />
          <Background gap={[14, 14]} size={2} color="#d1d5db" />
        </ReactFlow>
      </div>
      <NodeContextMenu
        menu={nodeMenu}
        onClose={actions.nodeMenu.onClose}
        onCopy={actions.nodeMenu.onCopy}
        onDuplicate={actions.nodeMenu.onDuplicate}
        onDelete={actions.nodeMenu.onDelete}
      />
      <EdgeContextMenu
        menu={edgeMenu}
        onClose={actions.edgeMenu.onClose}
        onDelete={actions.edgeMenu.onDelete}
      />
      <PanelContextMenu
        menu={panelMenu}
        canPaste={canPaste}
        onClose={actions.panelMenu.onClose}
        onPaste={actions.panelMenu.onPaste}
        onExport={actions.panelMenu.onExport}
        onImport={actions.panelMenu.onImport}
      />
      <SelectionContextMenu
        menu={selectionMenu}
        onClose={actions.selectionMenu.onClose}
        onCopy={actions.selectionMenu.onCopy}
        onDuplicate={actions.selectionMenu.onDuplicate}
        onDelete={actions.selectionMenu.onDelete}
        onAlignLeft={() => actions.selectionMenu.onAlign('left')}
        onAlignCenter={() => actions.selectionMenu.onAlign('center')}
        onAlignRight={() => actions.selectionMenu.onAlign('right')}
        onAlignTop={() => actions.selectionMenu.onAlign('top')}
        onAlignMiddle={() => actions.selectionMenu.onAlign('middle')}
        onAlignBottom={() => actions.selectionMenu.onAlign('bottom')}
        onDistributeHorizontal={() => actions.selectionMenu.onAlign('distributeHorizontal')}
        onDistributeVertical={() => actions.selectionMenu.onAlign('distributeVertical')}
      />
    </div>
  )
}

export default memo(WorkflowEditor)
