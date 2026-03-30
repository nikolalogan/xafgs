import type { WorkflowGlobalVariable } from '../core/types'

type GlobalVariablePanelProps = {
  open: boolean
  variables: WorkflowGlobalVariable[]
  onClose: () => void
  mode?: 'modal' | 'panel'
}

export default function GlobalVariablePanel({
  open,
  variables,
  onClose,
  mode = 'modal',
}: GlobalVariablePanelProps) {
  if (!open)
    return null

  if (mode === 'panel') {
    return (
      <div className="w-[360px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">全局参数</div>
          <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">关闭</button>
        </div>
        <div className="mb-3 text-xs text-gray-500">以下变量可在节点配置中作为系统级变量引用。</div>
        <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
          {variables.map(variable => (
            <div key={variable.name} className="rounded border border-gray-200 p-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">{variable.name}</div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{variable.valueType}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">{variable.description}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">全局参数</div>
          <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">关闭</button>
        </div>
        <div className="mb-3 text-xs text-gray-500">以下变量可在节点配置中作为系统级变量引用。</div>
        <div className="space-y-2">
          {variables.map(variable => (
            <div key={variable.name} className="rounded border border-gray-200 p-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">{variable.name}</div>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{variable.valueType}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">{variable.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
