'use client'

import WorkflowCanvas from '@/components/workflow/WorkflowCanvas'
import { useConsoleRole } from '@/lib/useConsoleRole'

export default function WorkflowPage() {
  const { role, hydrated } = useConsoleRole()

  if (!hydrated) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-sm text-gray-500">加载中...</div>
      </div>
    )
  }

  if (role === 'guest') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">请先登录后再访问工作流。</div>
      </div>
    )
  }

  if (role !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">工作流仅管理员可访问。</div>
      </div>
    )
  }

  return <WorkflowCanvas />
}
