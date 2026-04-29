import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { buildIfElseBranchHandleId, IF_ELSE_FALLBACK_HANDLE } from '@/lib/workflow-ifelse'
import { ensureNodeConfig } from '../core/node-config'
import { BlockEnum, type DifyNodeData } from '../core/types'
import { getWorkflowNodeSubtitle, getWorkflowNodeVisual, workflowNodeTypeLabel } from './nodeVisuals'

const handleBaseClassName = '!h-2.5 !w-2.5 !rounded-full !border-[1.5px] !border-white !transition-all'

const getHandleClassName = (emphasize = false) => {
  return `${handleBaseClassName} ${emphasize ? '!scale-110 !shadow-[0_0_0_4px_rgba(255,255,255,0.92)]' : ''}`
}

const baseCardClassName = 'group relative overflow-visible rounded-[22px] border border-slate-200/90 bg-white/96 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.45)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_24px_44px_-28px_rgba(15,23,42,0.35)]'
const selectedCardClassName = 'border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.14),0_24px_44px_-28px_rgba(14,116,144,0.36)]'

const CustomNode = ({ data, selected }: NodeProps<DifyNodeData>) => {
  const isStart = data.type === BlockEnum.Start
  const isEnd = data.type === BlockEnum.End
  const isIterationContainer = data.type === BlockEnum.Iteration && data._iterationRole !== 'child'
  const isIterationChild = data._iterationRole === 'child'
  const visual = getWorkflowNodeVisual(data.type)
  const subtitle = getWorkflowNodeSubtitle(data)
  const sourceConnected = Boolean(data._connectedSourceHandleIds?.length)
  const targetConnected = Boolean(data._connectedTargetHandleIds?.length)
  const sourceHandleClassName = getHandleClassName(selected || sourceConnected)
  const targetHandleClassName = getHandleClassName(selected || targetConnected)

  const renderHeader = (options?: { compact?: boolean; badge?: string }) => (
    <div className={`flex items-center gap-3 ${options?.compact ? 'px-3 py-3' : 'px-3.5 py-3.5'}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${visual.iconBg} ${visual.iconFg} shadow-[0_10px_20px_-14px_rgba(15,23,42,0.55)]`}>
        {visual.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900">{data.title}</div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>
      </div>
      {options?.badge && (
        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${visual.accentBg} ${visual.accentBorder} ${visual.accentText}`}>
          {options.badge}
        </span>
      )}
    </div>
  )

  if (isIterationContainer) {
    return (
      <div className={`relative h-full w-full overflow-hidden rounded-[28px] border bg-white/96 shadow-[0_22px_48px_-34px_rgba(76,29,149,0.35)] ${selected ? 'border-violet-400 shadow-[0_0_0_4px_rgba(139,92,246,0.12),0_26px_52px_-34px_rgba(76,29,149,0.34)]' : 'border-slate-200/90 hover:border-violet-200'}`}>
        <Handle id="target" type="target" position={Position.Left} style={{ left: -5, backgroundColor: '#94a3b8' }} className={targetHandleClassName} />
        <div className="border-b border-slate-200/90 bg-[linear-gradient(180deg,#ffffff_0%,#faf5ff_100%)]">
          {renderHeader({ badge: '迭代容器' })}
          <div className="flex items-center justify-between px-3.5 pb-3 text-xs">
            <span className="text-slate-500">保留子流程结构与句柄逻辑</span>
            <span className={`rounded-full border px-2 py-1 font-medium ${visual.accentBg} ${visual.accentBorder} ${visual.accentText}`}>主画布模块</span>
          </div>
        </div>
        <div className="h-[calc(100%-82px)] bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(245,243,255,0.9)_100%)] p-3">
          <div className="flex h-full flex-col rounded-[22px] border border-dashed border-violet-200 bg-white/65 p-3 shadow-inner">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-500">
              <span>Subflow Region</span>
              <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] tracking-[0.08em] text-slate-500">缩放 / 拖拽 / fitView 保持可用</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">迭代子流程区域（主画布内编辑）</div>
          </div>
        </div>
        <div className={`absolute inset-x-0 bottom-0 h-1.5 ${visual.iconBg}`} />
        <Handle id="source" type="source" position={Position.Right} style={{ right: -5, backgroundColor: visual.solidColor }} className={sourceHandleClassName} />
      </div>
    )
  }

  if (data.type === BlockEnum.IfElse) {
    const config = ensureNodeConfig(BlockEnum.IfElse, data.config)
    const branchItems = [
      ...config.conditions.map((item, index) => ({
        handleId: buildIfElseBranchHandleId(index),
        name: item.name || `分支${index + 1}`,
      })),
      {
        handleId: IF_ELSE_FALLBACK_HANDLE,
        name: config.elseBranchName || 'else',
      },
    ]

    return (
      <div className={`${isIterationChild ? 'w-[250px]' : 'w-[282px]'} ${baseCardClassName} ${selected ? selectedCardClassName : ''}`}>
        <Handle id="target" type="target" position={Position.Left} style={{ left: -5, backgroundColor: '#94a3b8' }} className={targetHandleClassName} />
        {renderHeader({ compact: isIterationChild, badge: `${branchItems.length} 路输出` })}
        <div className="space-y-2 px-3.5 pb-3.5 text-xs text-slate-600">
          {branchItems.map((item, index) => {
            const branchHandleClassName = getHandleClassName(selected)
            return (
              <div key={item.handleId} className="relative rounded-2xl border border-slate-200/90 bg-slate-50/88 px-3 py-2.5 pr-7 transition-colors hover:border-slate-300 hover:bg-white">
                <div className="font-medium text-slate-700">{item.name}</div>
                <div className="mt-1 text-[11px] text-slate-400">{index === branchItems.length - 1 ? '兜底输出' : `条件分支 ${index + 1}`}</div>
                <Handle
                  id={item.handleId}
                  type="source"
                  position={Position.Right}
                  style={{ top: '50%', right: -5, transform: 'translateY(-50%)', backgroundColor: index === branchItems.length - 1 ? '#94a3b8' : visual.solidColor }}
                  className={branchHandleClassName}
                />
              </div>
            )
          })}
        </div>
        <div className={`absolute inset-x-0 bottom-0 h-1.5 ${visual.iconBg}`} />
      </div>
    )
  }

  return (
    <div className={`${isIterationChild ? 'w-[224px]' : 'w-[248px]'} ${baseCardClassName} ${selected ? selectedCardClassName : ''}`}>
      {!isStart && <Handle id="target" type="target" position={Position.Left} style={{ left: -5, backgroundColor: '#94a3b8' }} className={targetHandleClassName} />}
      {renderHeader({ compact: isIterationChild, badge: isIterationChild ? '子流程' : workflowNodeTypeLabel[data.type] })}
      <div className="px-3.5 pb-3.5">
        <div className={`rounded-2xl border px-3 py-2 text-[11px] font-medium ${visual.accentBg} ${visual.accentBorder} ${visual.accentText}`}>
          {subtitle}
        </div>
      </div>
      <div className={`absolute inset-x-0 bottom-0 h-1.5 ${visual.iconBg}`} />
      {!isEnd && <Handle id="source" type="source" position={Position.Right} style={{ right: -5, backgroundColor: visual.solidColor }} className={sourceHandleClassName} />}
    </div>
  )
}

export default memo(CustomNode)
