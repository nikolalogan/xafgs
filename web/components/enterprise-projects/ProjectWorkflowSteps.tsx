'use client'

import { useRouter } from 'next/navigation'
import { Card, Steps } from 'antd'

type ProjectWorkflowStepsProps = {
  projectId: number
  currentStep: number
}

const STEP_ROUTES = [
  (projectId: number) => `/app/enterprise-projects/${projectId}`,
  (projectId: number) => `/app/enterprise-projects/${projectId}/confirm`,
  (projectId: number) => `/app/enterprise-projects/${projectId}/finance`,
  (projectId: number) => `/app/enterprise-projects/${projectId}/processing`,
  (projectId: number) => `/app/enterprise-projects/${projectId}/report`,
  (projectId: number) => `/app/enterprise-projects/${projectId}/edit`,
]

const STEP_ITEMS = [
  { title: '文件录入' },
  { title: '文件确认' },
  { title: '财务数据确认' },
  { title: '文件处理' },
  { title: '报告生成' },
  { title: '内容修改' },
]

export default function ProjectWorkflowSteps({ projectId, currentStep }: ProjectWorkflowStepsProps) {
  const router = useRouter()
  return (
    <Card>
      <Steps
        size="small"
        current={Math.max(0, Math.min(STEP_ITEMS.length - 1, currentStep))}
        items={STEP_ITEMS}
        onChange={(next) => {
          if (!projectId || projectId <= 0)
            return
          const nextPath = STEP_ROUTES[next]?.(projectId)
          if (nextPath)
            router.push(nextPath)
        }}
      />
    </Card>
  )
}
