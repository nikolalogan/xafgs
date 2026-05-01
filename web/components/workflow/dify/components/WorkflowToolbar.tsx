import { toolbarActionButtons, type ToolbarActionKey } from '../config/toolbarPreset'

type WorkflowToolbarProps = {
  canUndo: boolean
  canRedo: boolean
  issueCount: number
  onUndo: () => void
  onRedo: () => void
  onLayout: () => void
  onOpenGlobalParams: () => void
  onOpenWorkflowParams: () => void
  onOpenChecklist: () => void
  onOpenAINodeGenerate: () => void
  onRun: () => void
  onExport: () => void
  onOpenImport: () => void
  onReset: () => void
}

export default function WorkflowToolbar({
  canUndo,
  canRedo,
  issueCount,
  onUndo,
  onRedo,
  onLayout,
  onOpenGlobalParams,
  onOpenWorkflowParams,
  onOpenChecklist,
  onOpenAINodeGenerate,
  onRun,
  onExport,
  onOpenImport,
  onReset,
}: WorkflowToolbarProps) {
  const actionHandlers: Record<ToolbarActionKey, () => void> = {
    undo: onUndo,
    redo: onRedo,
    layout: onLayout,
    run: onRun,
    globalParams: onOpenGlobalParams,
    workflowParams: onOpenWorkflowParams,
    check: onOpenChecklist,
    aiNodeGenerate: onOpenAINodeGenerate,
    export: onExport,
    import: onOpenImport,
    reset: onReset,
  }

  const isActionDisabled = (key: ToolbarActionKey) => {
    if (key === 'undo')
      return !canUndo
    if (key === 'redo')
      return !canRedo
    return false
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        Workspace
      </div>
      {toolbarActionButtons.map(item => (
        <button
          key={item.key}
          type="button"
          onClick={actionHandlers[item.key]}
          disabled={isActionDisabled(item.key)}
          className={item.className}
        >
          {item.key === 'check' ? `${item.label} ${issueCount}` : item.label}
        </button>
      ))}
    </div>
  )
}
