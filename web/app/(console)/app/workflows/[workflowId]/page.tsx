'use client'

import { useParams } from 'next/navigation'
import WorkflowConfigPage from '@/components/workflow/config/WorkflowConfigPage'

export default function WorkflowConfigDetailPage() {
  const params = useParams<{ workflowId: string }>()
  const workflowIDValue = Number(params.workflowId)
  if (!Number.isFinite(workflowIDValue) || workflowIDValue <= 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-base font-semibold text-gray-900">参数错误</div>
        <div className="mt-2 text-sm text-gray-500">workflowId 必须为正整数。</div>
      </div>
    )
  }
  return <WorkflowConfigPage workflowId={workflowIDValue} />
}
