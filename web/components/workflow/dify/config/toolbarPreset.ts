import { BlockEnum } from '../core/types'

export type ToolbarActionKey = 'undo' | 'redo' | 'layout' | 'run' | 'globalParams' | 'check' | 'export' | 'import' | 'reset'

export const toolbarNodeButtons: Array<{ type: BlockEnum; label: string }> = [
  { type: BlockEnum.Start, label: '开始节点' },
  { type: BlockEnum.End, label: '结束节点' },
  { type: BlockEnum.Input, label: '输入节点' },
  { type: BlockEnum.LLM, label: 'LLM 节点' },
  { type: BlockEnum.IfElse, label: '条件节点' },
  { type: BlockEnum.Iteration, label: '迭代节点' },
  { type: BlockEnum.HttpRequest, label: 'HTTP 节点' },
  { type: BlockEnum.ApiRequest, label: 'API 请求节点' },
  { type: BlockEnum.Code, label: '代码节点' },
]

export const toolbarActionButtons: Array<{ key: ToolbarActionKey; label: string; className: string }> = [
  { key: 'undo', label: '撤销', className: 'rounded bg-gray-800 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:bg-gray-300' },
  { key: 'redo', label: '重做', className: 'rounded bg-gray-800 px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:bg-gray-300' },
  { key: 'layout', label: '自动布局', className: 'rounded bg-teal-600 px-3 py-1.5 text-xs text-white hover:bg-teal-700' },
  { key: 'run', label: '运行', className: 'rounded bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700' },
  { key: 'globalParams', label: '全局参数', className: 'rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700' },
  { key: 'check', label: '错误检查', className: 'rounded bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-700' },
  { key: 'export', label: '导出 DSL', className: 'rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700' },
  { key: 'import', label: '导入 DSL', className: 'rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700' },
  { key: 'reset', label: '重置', className: 'rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600' },
]
