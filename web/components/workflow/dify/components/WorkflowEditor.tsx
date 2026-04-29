import { Drawer, Grid } from 'antd'
import type { DragEvent, MouseEvent, ReactNode, RefObject } from 'react'
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
import EdgeContextMenu from './EdgeContextMenu'
import GlobalVariablePanel from './GlobalVariablePanel'
import NodeContextMenu from './NodeContextMenu'
import PanelContextMenu from './PanelContextMenu'
import SelectionContextMenu from './SelectionContextMenu'
import WorkflowChecklistPanel from './WorkflowChecklistPanel'
import WorkflowParamsPanel from './WorkflowParamsPanel'
import type { EdgeMenuState, NodeMenuState, PanelMenuState, SelectionMenuState } from '../core/store'
import type { WorkflowIssue } from '../core/validation'
import type { DifyEdge, DifyNode, WorkflowGlobalVariable, WorkflowParameter } from '../core/types'
import type { AlignDirection } from '../hooks/useSelectionLayout'

type WorkflowEditorProps = {
  canvasContainerRef: RefObject<HTMLDivElement | null>
  title: string
  subtitle: string
  activeNodeTitle?: string
  statusBadges: string[]
  toolbar: ReactNode
  nodeConfigOpen: boolean
  nodeConfigPanel: ReactNode
  onCloseNodeConfig: () => void
  nodeTypes: NodeTypes
  edgeTypes: EdgeTypes
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
      onNodeDragStop: (_: MouseEvent, node: DifyNode) => void
      onNodeClick: (_: MouseEvent, node: DifyNode) => void
      onPaneClick: () => void
      onNodeContextMenu: (event: MouseEvent, node: DifyNode) => void
      onEdgeContextMenu: (event: MouseEvent, edge: DifyEdge) => void
      onPaneContextMenu: (event: MouseEvent) => void
      onDrop: (event: DragEvent) => void
      onDragOver: (event: DragEvent) => void
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

export default function WorkflowEditor({
  canvasContainerRef,
  title,
  subtitle,
  activeNodeTitle,
  statusBadges,
  toolbar,
  nodeConfigOpen,
  nodeConfigPanel,
  onCloseNodeConfig,
  nodeTypes,
  edgeTypes,
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
  const screens = Grid.useBreakpoint()
  const showFloatingNodeConfig = !!screens.xl

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top,#ffffff_0%,#f8fafc_35%,#eef2ff_100%)] shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)]">
      <div className="border-b border-slate-200/90 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Workflow Studio</div>
            <div>
              <div className="text-xl font-semibold text-slate-950">{title}</div>
              <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {statusBadges.map(item => (
                <span key={item} className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600">
                  {item}
                </span>
              ))}
              {activeNodeTitle && (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  当前节点：{activeNodeTitle}
                </span>
              )}
            </div>
          </div>
          <div className="max-w-full xl:max-w-[68%]">{toolbar}</div>
        </div>
      </div>

      <div ref={canvasContainerRef} className="relative flex-1 overflow-hidden p-4">
        <div className="absolute left-7 top-7 z-20 flex flex-col gap-3">
          <div className="max-w-[260px] rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Canvas Guide</div>
            <div className="mt-1 text-sm text-slate-600">从左侧拖入节点，选中后在右侧编辑；右键、框选、复制粘贴保持现有行为。</div>
          </div>
        </div>

        <div className="absolute right-7 top-7 z-20">
          <div className="flex items-center gap-2 rounded-2xl border border-white/80 bg-white/90 p-1.5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
            <button
              type="button"
              title="全局参数"
              onClick={quickPanel.onOpenGlobalVariables}
              className={`flex h-9 w-9 items-center justify-center rounded-xl border ${quickPanel.globalVariableOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
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
              className={`flex h-9 w-9 items-center justify-center rounded-xl border ${quickPanel.workflowParamsOpen ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
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
              className={`relative flex h-9 w-9 items-center justify-center rounded-xl border ${quickPanel.checklistOpen ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
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

        <div className="absolute right-7 top-20 z-20 flex flex-col gap-2">
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

        {nodeConfigOpen && showFloatingNodeConfig && (
          <div className="absolute bottom-7 right-7 top-32 z-30 hidden w-[360px] xl:block">
            <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white/96 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.5)] backdrop-blur">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Node Config</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">节点配置</div>
                </div>
                <button
                  type="button"
                  aria-label="关闭节点配置"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  onClick={onCloseNodeConfig}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {nodeConfigPanel}
              </div>
            </div>
          </div>
        )}

        <div className="h-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-inner">
          <ReactFlow
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
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
            onDrop={actions.flow.onDrop}
            onDragOver={actions.flow.onDragOver}
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
              style={{ width: 130, height: 84 }}
              maskColor="rgba(15, 23, 42, 0.08)"
              className="!absolute !bottom-16 !left-5 z-[9] !m-0 !h-[84px] !w-[130px] !rounded-2xl !border !border-slate-200 !bg-white !shadow-md"
            />
            <Controls className="!bottom-5 !right-5 !left-auto !top-auto" />
            <Background gap={[18, 18]} size={1.5} color="#dbe4f0" />
          </ReactFlow>
        </div>
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
      <Drawer
        title="节点配置"
        placement="right"
        width={380}
        open={nodeConfigOpen && !showFloatingNodeConfig}
        onClose={onCloseNodeConfig}
        destroyOnHidden={false}
      >
        <div className="overflow-y-auto">
          {nodeConfigPanel}
        </div>
      </Drawer>
    </section>
  )
}
