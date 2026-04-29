import type { ReactNode } from 'react'
import { BlockEnum, type DifyNodeData } from '../core/types'

export const workflowNodeTypeLabel: Record<BlockEnum, string> = {
  [BlockEnum.Start]: '开始',
  [BlockEnum.End]: '结束',
  [BlockEnum.LLM]: 'LLM',
  [BlockEnum.IfElse]: '条件分支',
  [BlockEnum.Iteration]: '迭代',
  [BlockEnum.Code]: '代码',
  [BlockEnum.HttpRequest]: 'HTTP',
  [BlockEnum.ApiRequest]: 'API 请求',
  [BlockEnum.Input]: '输入',
}

type WorkflowNodeVisual = {
  solidColor: string
  iconBg: string
  iconFg: string
  accentBg: string
  accentBorder: string
  accentText: string
  icon: ReactNode
}

const iconClassName = 'h-[18px] w-[18px] stroke-[1.8]'

const buildIcon = (type: BlockEnum) => {
  if (type === BlockEnum.Start) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <path d="M8 6.5v11l8-5.5l-8-5.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type === BlockEnum.End) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <rect x="7" y="7" width="10" height="10" rx="2.5" stroke="currentColor" />
      </svg>
    )
  }
  if (type === BlockEnum.LLM) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <path d="M12 4.5l1.8 3.8l4.2.6l-3 2.9l.8 4.2L12 14l-3.8 2l.8-4.2l-3-2.9l4.2-.6L12 4.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type === BlockEnum.IfElse) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <path d="M7 5v6m0 0c0 0 0 4 4 4h6m-10-4c0 0 0 4-4 4H2m15 0h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type === BlockEnum.Iteration) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <path d="M8 7h8l-2.5-2.5M16 17H8l2.5 2.5M18 7a6 6 0 0 1 0 10M6 17a6 6 0 0 1 0-10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type === BlockEnum.Code) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <path d="m9 7l-4 5l4 5M15 7l4 5l-4 5M13 5l-2 14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type === BlockEnum.HttpRequest) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <circle cx="12" cy="12" r="7" stroke="currentColor" />
        <path d="M5 12h14M12 5c2 2 2 10 0 14M12 5c-2 2-2 10 0 14" stroke="currentColor" strokeLinecap="round" />
      </svg>
    )
  }
  if (type === BlockEnum.ApiRequest) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
        <rect x="4" y="6" width="7" height="5" rx="1.5" stroke="currentColor" />
        <rect x="13" y="6" width="7" height="5" rx="1.5" stroke="currentColor" />
        <rect x="8.5" y="13" width="7" height="5" rx="1.5" stroke="currentColor" />
        <path d="M11 8.5h2M12 11v2" stroke="currentColor" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={iconClassName}>
      <path d="M5 6.5h14M8 12h8M10 17.5h4" stroke="currentColor" strokeLinecap="round" />
      <rect x="4" y="4.5" width="16" height="15" rx="3" stroke="currentColor" />
    </svg>
  )
}

export const getWorkflowNodeVisual = (type: BlockEnum): WorkflowNodeVisual => {
  const palette: Record<BlockEnum, Omit<WorkflowNodeVisual, 'icon'>> = {
    [BlockEnum.Start]: {
      solidColor: '#10b981',
      iconBg: 'bg-emerald-500',
      iconFg: 'text-white',
      accentBg: 'bg-emerald-50',
      accentBorder: 'border-emerald-200',
      accentText: 'text-emerald-700',
    },
    [BlockEnum.End]: {
      solidColor: '#475569',
      iconBg: 'bg-slate-600',
      iconFg: 'text-white',
      accentBg: 'bg-slate-100',
      accentBorder: 'border-slate-200',
      accentText: 'text-slate-700',
    },
    [BlockEnum.LLM]: {
      solidColor: '#0ea5e9',
      iconBg: 'bg-sky-500',
      iconFg: 'text-white',
      accentBg: 'bg-sky-50',
      accentBorder: 'border-sky-200',
      accentText: 'text-sky-700',
    },
    [BlockEnum.IfElse]: {
      solidColor: '#f43f5e',
      iconBg: 'bg-rose-500',
      iconFg: 'text-white',
      accentBg: 'bg-rose-50',
      accentBorder: 'border-rose-200',
      accentText: 'text-rose-700',
    },
    [BlockEnum.Iteration]: {
      solidColor: '#8b5cf6',
      iconBg: 'bg-violet-500',
      iconFg: 'text-white',
      accentBg: 'bg-violet-50',
      accentBorder: 'border-violet-200',
      accentText: 'text-violet-700',
    },
    [BlockEnum.Code]: {
      solidColor: '#06b6d4',
      iconBg: 'bg-cyan-500',
      iconFg: 'text-white',
      accentBg: 'bg-cyan-50',
      accentBorder: 'border-cyan-200',
      accentText: 'text-cyan-700',
    },
    [BlockEnum.HttpRequest]: {
      solidColor: '#f97316',
      iconBg: 'bg-orange-500',
      iconFg: 'text-white',
      accentBg: 'bg-orange-50',
      accentBorder: 'border-orange-200',
      accentText: 'text-orange-700',
    },
    [BlockEnum.ApiRequest]: {
      solidColor: '#6366f1',
      iconBg: 'bg-indigo-500',
      iconFg: 'text-white',
      accentBg: 'bg-indigo-50',
      accentBorder: 'border-indigo-200',
      accentText: 'text-indigo-700',
    },
    [BlockEnum.Input]: {
      solidColor: '#f59e0b',
      iconBg: 'bg-amber-500',
      iconFg: 'text-white',
      accentBg: 'bg-amber-50',
      accentBorder: 'border-amber-200',
      accentText: 'text-amber-700',
    },
  }

  return {
    ...palette[type],
    icon: buildIcon(type),
  }
}

export const getWorkflowNodeHint = (type: BlockEnum) => {
  const hints: Record<BlockEnum, string> = {
    [BlockEnum.Start]: '定义表单与入口变量',
    [BlockEnum.End]: '汇总并输出最终结果',
    [BlockEnum.LLM]: '调用模型理解与生成',
    [BlockEnum.IfElse]: '根据条件拆分后续路径',
    [BlockEnum.Iteration]: '在子流程内遍历列表',
    [BlockEnum.Code]: '执行 JS 或 Python 代码',
    [BlockEnum.HttpRequest]: '请求外部 HTTP 接口',
    [BlockEnum.ApiRequest]: '对接内部 API 路由',
    [BlockEnum.Input]: '补充业务输入字段',
  }
  return hints[type]
}

export const getWorkflowNodeSubtitle = (data: Pick<DifyNodeData, 'type' | 'desc' | '_iterationRole'>) => {
  const desc = data.desc?.trim()
  if (desc)
    return data._iterationRole === 'child' ? `子流程 · ${desc}` : desc
  if (data.type === BlockEnum.Iteration)
    return '容器节点 · 主画布内编辑'
  if (data._iterationRole === 'child')
    return `子流程 · ${workflowNodeTypeLabel[data.type]}`
  return getWorkflowNodeHint(data.type)
}
