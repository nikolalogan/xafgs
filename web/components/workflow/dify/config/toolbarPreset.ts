export type ToolbarActionKey = 'undo' | 'redo' | 'layout' | 'save' | 'run' | 'globalParams' | 'workflowParams' | 'check' | 'export' | 'import' | 'reset' | 'aiNodeGenerate'

export const toolbarActionButtons: Array<{ key: ToolbarActionKey; label: string; className: string }> = [
  { key: 'undo', label: '撤销', className: 'inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40' },
  { key: 'redo', label: '重做', className: 'inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40' },
  { key: 'layout', label: '自动布局', className: 'inline-flex h-9 items-center rounded-full border border-teal-200 bg-teal-50 px-3 text-xs font-medium text-teal-700 transition hover:bg-teal-100' },
  { key: 'save', label: '保存节点', className: 'inline-flex h-9 items-center rounded-full border border-sky-200 bg-sky-50 px-3 text-xs font-medium text-sky-700 transition hover:bg-sky-100' },
  { key: 'run', label: '运行', className: 'inline-flex h-9 items-center rounded-full bg-slate-950 px-4 text-xs font-medium text-white transition hover:bg-slate-800' },
  { key: 'globalParams', label: '全局变量', className: 'inline-flex h-9 items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100' },
  { key: 'workflowParams', label: '流程参数', className: 'inline-flex h-9 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100' },
  { key: 'check', label: '检查', className: 'inline-flex h-9 items-center rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 transition hover:bg-rose-100' },
  { key: 'aiNodeGenerate', label: 'AI 生成节点', className: 'inline-flex h-9 items-center rounded-full border border-cyan-200 bg-cyan-50 px-3 text-xs font-medium text-cyan-700 transition hover:bg-cyan-100' },
  { key: 'export', label: '导出 DSL', className: 'inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50' },
  { key: 'import', label: '导入 DSL', className: 'inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50' },
  { key: 'reset', label: '重置', className: 'inline-flex h-9 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 transition hover:bg-amber-100' },
]
