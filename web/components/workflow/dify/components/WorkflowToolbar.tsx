import { toolbarActionButtons, toolbarNodeButtons, type ToolbarActionKey } from '../config/toolbarPreset'
import { BlockEnum } from '../core/types'

type WorkflowToolbarProps = {
  canUndo: boolean
  canRedo: boolean
  issueCount: number
  onAddNode: (type: BlockEnum) => void
  onUndo: () => void
  onRedo: () => void
  onLayout: () => void
  onSave: () => void
  onOpenGlobalParams: () => void
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
  onAddNode,
  onUndo,
  onRedo,
  onLayout,
  onSave,
  onOpenGlobalParams,
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
    save: onSave,
    run: onRun,
    globalParams: onOpenGlobalParams,
    check: onOpenChecklist,
    aiNodeGenerate: onOpenAINodeGenerate,
    export: onExport,
    import: onOpenImport,
    reset: onReset,
  }

  const isActionDisabled = (key: ToolbarActionKey) => {
    if (key === 'undo') return !canUndo
    if (key === 'redo') return !canRedo
    return false
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-2 text-sm font-semibold text-gray-900">Dify Workflow（迁移进行中）</div>
        {toolbarNodeButtons.map(item => (
          <button
            key={item.type}
            onClick={() => onAddNode(item.type)}
            className="rounded bg-gray-100 px-3 py-1.5 text-xs hover:bg-gray-200"
          >
            {item.label}
          </button>
        ))}
        {toolbarActionButtons.map(item => (
          <button
            key={item.key}
            onClick={actionHandlers[item.key]}
            disabled={isActionDisabled(item.key)}
            className={item.className}
          >
            {item.key === 'check' ? `${item.label}（${issueCount}）` : item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
