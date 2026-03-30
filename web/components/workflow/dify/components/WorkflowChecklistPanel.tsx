import type { WorkflowIssue } from '../core/validation'

type WorkflowChecklistPanelProps = {
  open: boolean
  issues: WorkflowIssue[]
  onClose: () => void
  onLocateNode: (nodeId: string) => void
  mode?: 'modal' | 'panel'
}

export default function WorkflowChecklistPanel({
  open,
  issues,
  onClose,
  onLocateNode,
  mode = 'modal',
}: WorkflowChecklistPanelProps) {
  if (!open)
    return null

  const content = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">错误检查</div>
        <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">关闭</button>
      </div>
      <div className="mb-3 text-xs text-gray-500">
        共发现 {issues.length} 项问题（error + warning）。
      </div>
      {!issues.length && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          未发现配置问题。
        </div>
      )}
      {!!issues.length && (
        <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
          {issues.map(issue => (
            <div key={issue.id} className="rounded border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">{issue.title}</div>
                <span className={`rounded px-2 py-0.5 text-xs ${issue.level === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {issue.level}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-600">{issue.message}</div>
              {issue.nodeId && (
                <button
                  className="mt-2 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  onClick={() => onLocateNode(issue.nodeId!)}
                >
                  定位节点
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )

  if (mode === 'panel') {
    return (
      <div className="w-[380px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
        {content}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl">
        {content}
      </div>
    </div>
  )
}
