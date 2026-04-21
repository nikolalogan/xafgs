'use client'

import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Space } from 'antd'
import ProjectWorkflowSteps from '@/components/enterprise-projects/ProjectWorkflowSteps'

export default function EnterpriseProjectProcessingPlaceholderPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const projectId = Number(params?.projectId || 0)

  return (
    <div className="space-y-4">
      <ProjectWorkflowSteps projectId={projectId} currentStep={3} />
      <Card
        title="文件处理（预留）"
        extra={(
          <Space>
            <Button onClick={() => router.push('/app/file-processing')}>查看全局处理清单</Button>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}/finance`)}>返回财务数据确认</Button>
          </Space>
        )}
      >
        <div className="text-sm text-gray-600">
          当前步骤页面已预留，后续可在此补充项目内文件处理编排、进度追踪与异常处置交互。
        </div>
      </Card>
    </div>
  )
}
