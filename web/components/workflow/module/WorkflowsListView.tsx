'use client'

import { Button, Popconfirm, Tag } from 'antd'

type WorkflowStatus = 'active' | 'disabled'
type WorkflowMenuKey = '' | 'reserve' | 'review' | 'postloan'

export type WorkflowListItem = {
  id: number
  workflowKey: string
  name: string
  description: string
  menuKey: WorkflowMenuKey
  status: WorkflowStatus
  currentDraftVersionNo: number
  currentPublishedVersionNo: number
  createdAt: string
  updatedAt: string
}

type WorkflowsListViewProps = {
  items: WorkflowListItem[]
  loading?: boolean
  onEdit: (item: WorkflowListItem) => void
  onRun: (item: WorkflowListItem) => void
  onPublishToggle: (item: WorkflowListItem) => void
  onRollback: (item: WorkflowListItem) => void
  onDelete: (item: WorkflowListItem) => void
}

const menuLabelMap: Record<WorkflowMenuKey, string> = {
  '': '未分组',
  reserve: '储备',
  review: '评审',
  postloan: '保后',
}

const statusColorMap: Record<WorkflowStatus, string> = {
  active: 'green',
  disabled: 'default',
}

const statusLabelMap: Record<WorkflowStatus, string> = {
  active: '启用',
  disabled: '停用',
}

export default function WorkflowsListView({
  items,
  loading = false,
  onEdit,
  onRun,
  onPublishToggle,
  onRollback,
  onDelete,
}: WorkflowsListViewProps) {
  if (loading) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">加载中...</div>
  }

  if (items.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">当前筛选下没有工作流。</div>
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {items.map(item => (
        <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-lg font-semibold text-slate-950">{item.name}</div>
                <Tag color={statusColorMap[item.status]}>{statusLabelMap[item.status]}</Tag>
                <Tag>{menuLabelMap[item.menuKey]}</Tag>
              </div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{item.workflowKey}</div>
            </div>
            <div className="rounded-xl bg-slate-100 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">ID</div>
              <div className="text-sm font-semibold text-slate-900">#{item.id}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">草稿版本</div>
              <div className="mt-1 text-base font-semibold text-slate-950">v{item.currentDraftVersionNo || 0}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">发布版本</div>
              <div className="mt-1 text-base font-semibold text-slate-950">v{item.currentPublishedVersionNo || 0}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">更新时间</div>
              <div className="mt-1 text-sm font-medium text-slate-700">{new Date(item.updatedAt).toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="primary" onClick={() => onEdit(item)}>编辑</Button>
            <Button onClick={() => onRun(item)}>运行</Button>
            <Button onClick={() => onPublishToggle(item)}>
              {item.currentPublishedVersionNo > 0 ? '下线' : '发布'}
            </Button>
            <Button onClick={() => onRollback(item)}>回滚</Button>
            <Popconfirm
              title="确认删除该工作流？"
              okText="删除"
              cancelText="取消"
              onConfirm={() => onDelete(item)}
            >
              <Button danger>删除</Button>
            </Popconfirm>
          </div>
        </article>
      ))}
    </div>
  )
}
