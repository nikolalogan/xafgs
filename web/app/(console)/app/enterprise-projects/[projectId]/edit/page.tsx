'use client'

import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Space } from 'antd'
import ProjectWorkflowSteps from '@/components/enterprise-projects/ProjectWorkflowSteps'

export default function EnterpriseProjectEditPlaceholderPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const projectId = Number(params?.projectId || 0)

  return (
    <div className="space-y-4">
      <ProjectWorkflowSteps projectId={projectId} currentStep={5} />
      <Card
        title="内容修改（预留）"
        extra={(
          <Space>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}/report`)}>返回报告生成</Button>
          </Space>
        )}
      >
        <div className="text-sm text-gray-600">
          当前步骤页面已预留，后续可在此接入报告编辑器与人工修订流程。
        </div>
      </Card>
    </div>
  )
}
