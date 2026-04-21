'use client'

import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Space } from 'antd'
import ProjectWorkflowSteps from '@/components/enterprise-projects/ProjectWorkflowSteps'

export default function EnterpriseProjectReportPlaceholderPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const projectId = Number(params?.projectId || 0)

  return (
    <div className="space-y-4">
      <ProjectWorkflowSteps projectId={projectId} currentStep={4} />
      <Card
        title="报告生成（预留）"
        extra={(
          <Space>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}/processing`)}>返回文件处理</Button>
          </Space>
        )}
      >
        <div className="text-sm text-gray-600">
          当前步骤页面已预留，后续可在此接入报告生成流程、模板装配与生成任务控制。
        </div>
      </Card>
    </div>
  )
}
