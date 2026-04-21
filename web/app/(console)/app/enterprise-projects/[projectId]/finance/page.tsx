'use client'

import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Space } from 'antd'
import ProjectWorkflowSteps from '@/components/enterprise-projects/ProjectWorkflowSteps'

export default function EnterpriseProjectFinancePlaceholderPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const projectId = Number(params?.projectId || 0)

  return (
    <div className="space-y-4">
      <ProjectWorkflowSteps projectId={projectId} currentStep={2} />
      <Card
        title="财务数据确认（预留）"
        extra={(
          <Space>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}/confirm`)}>返回文件确认</Button>
            <Button type="primary" onClick={() => router.push(`/app/enterprise-projects/${projectId}/processing`)}>
              确认并进入文件处理
            </Button>
          </Space>
        )}
      >
        <div className="text-sm text-gray-600">
          当前步骤页面已预留，后续可在此补充财务数据核验、异常提示与确认提交交互。
        </div>
      </Card>
    </div>
  )
}
