'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { BlockEnum } from './dify/core/types'
import { getWorkflowNodeHint, getWorkflowNodeVisual, workflowNodeTypeLabel } from './dify/components/nodeVisuals'

export const WORKFLOW_NODE_DND_TYPE = 'application/x-sxfgs-workflow-node'

type WorkflowNodeLibraryProps = {
  activeNodeType?: BlockEnum
  onAddNode: (type: BlockEnum) => void
}

const nodeGroups: Array<{ title: string; description: string; items: BlockEnum[] }> = [
  { title: '起止节点', description: '定义流程入口与最终输出。', items: [BlockEnum.Start, BlockEnum.End] },
  { title: '输入与理解', description: '采集输入并交给模型处理。', items: [BlockEnum.Input, BlockEnum.LLM] },
  { title: '流程控制', description: '处理条件分支与迭代子流程。', items: [BlockEnum.IfElse, BlockEnum.Iteration] },
  { title: '执行能力', description: '调用代码、本地 HTTP 或服务 API。', items: [BlockEnum.Code, BlockEnum.HttpRequest, BlockEnum.ApiRequest] },
]

export default function WorkflowNodeLibrary({ activeNodeType, onAddNode }: WorkflowNodeLibraryProps) {
  const [query, setQuery] = useState('')

  const filteredGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return nodeGroups
      .map((group) => {
        const items = keyword
          ? group.items.filter((type) => {
              const label = workflowNodeTypeLabel[type].toLowerCase()
              const hint = getWorkflowNodeHint(type).toLowerCase()
              return label.includes(keyword) || hint.includes(keyword)
            })
          : group.items
        return { ...group, items }
      })
      .filter(group => group.items.length > 0)
  }, [query])

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, type: BlockEnum) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(WORKFLOW_NODE_DND_TYPE, type)
  }

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.35)]">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Node Library</div>
        <div className="mt-1 text-lg font-semibold text-slate-950">添加节点</div>
        <div className="mt-1 text-sm text-slate-500">点击添加，或拖到画布指定位置。</div>
        <input
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索节点"
        />
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {filteredGroups.map(group => (
          <section key={group.title} className="space-y-2">
            <div className="px-1">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{group.title}</div>
              <div className="mt-1 text-xs text-slate-500">{group.description}</div>
            </div>
            <div className="space-y-2">
              {group.items.map(type => (
                <button
                  key={type}
                  type="button"
                  draggable
                  onDragStart={event => handleDragStart(event, type)}
                  onClick={() => onAddNode(type)}
                  className={`group w-full rounded-2xl border px-3 py-3 text-left transition ${activeNodeType === type ? 'border-slate-900 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-800 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md'}`}
                >
                  {(() => {
                    const visual = getWorkflowNodeVisual(type)
                    const hint = getWorkflowNodeHint(type)
                    return (
                      <>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${activeNodeType === type ? 'bg-white/15 text-white' : `${visual.iconBg} ${visual.iconFg}`}`}>
                            {visual.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{workflowNodeTypeLabel[type]}</div>
                            <div className={`mt-1 truncate text-xs ${activeNodeType === type ? 'text-slate-300' : 'text-slate-500'}`}>
                              {hint}
                            </div>
                          </div>
                          <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${activeNodeType === type ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            拖拽
                          </div>
                        </div>
                        <div className={`mt-3 h-1.5 rounded-full ${activeNodeType === type ? 'bg-white/25' : visual.iconBg}`} />
                      </>
                    )
                  })()}
                </button>
              ))}
            </div>
          </section>
        ))}
        {filteredGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            没有匹配节点
          </div>
        )}
      </div>
    </aside>
  )
}
