'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Space, Table, Tag, message } from 'antd'
import { formatShanghaiDateTime } from '@/lib/time'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type ProgressItem = {
  jobId: number
  caseFileId: number
  fileId: number
  versionNo: number
  fileName: string
  manualCategory: string
  fileTypeGroup: string
  parseStatus: string
  vectorStatus: string
  currentStage: string
  errorMessage: string
  updatedAt: string
}

type EnterpriseProjectProgressDTO = {
  projectId: number
  items: ProgressItem[]
}

type EnterpriseProjectFileTerminateResultDTO = {
  projectId: number
  caseFileId: number
  parseStatus: string
  vectorStatus: string
  message: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const parseStatusColor = (status: string) => {
  if (status === 'succeeded' || status === 'completed')
    return 'success'
  if (status === 'failed' || status === 'status_error')
    return 'error'
  if (status === 'cancelled')
    return 'warning'
  if (status === 'not_enqueued' || status === 'unavailable')
    return 'default'
  if (status === 'running' || status === 'processing')
    return 'processing'
  return 'default'
}

export default function EnterpriseProjectWaitingPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [terminatingJobID, setTerminatingJobID] = useState(0)
  const [progress, setProgress] = useState<EnterpriseProjectProgressDTO | null>(null)
  const projectId = Number(params?.projectId || 0)

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, { ...init, headers, credentials: 'include' })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app/enterprise-projects')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadProgress = async () => {
    if (!projectId)
      return
    setLoading(true)
    try {
      const data = await request<EnterpriseProjectProgressDTO>(`/api/enterprise-projects/${projectId}/progress`, { method: 'GET' })
      setProgress(data)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载处理进度失败')
    }
    finally {
      setLoading(false)
    }
  }

  const terminateSingleFile = async (item: ProgressItem) => {
    if (!projectId || item.caseFileId <= 0)
      return
    setTerminatingJobID(item.jobId)
    try {
      const response = await request<EnterpriseProjectFileTerminateResultDTO>(
        `/api/enterprise-projects/${projectId}/files/${item.caseFileId}/terminate`,
        { method: 'POST' },
      )
      msgApi.success(response?.message || '终止请求已处理')
      loadProgress()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '终止失败')
    }
    finally {
      setTerminatingJobID(0)
    }
  }

  useEffect(() => {
    loadProgress()
  }, [projectId])

  useEffect(() => {
    if (!projectId)
      return
    const timer = window.setInterval(() => {
      loadProgress()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [projectId])

  const stats = useMemo(() => {
    const items = progress?.items || []
    const total = items.length
    const failed = items.filter(item =>
      item.parseStatus === 'failed'
      || item.parseStatus === 'cancelled'
      || item.vectorStatus === 'failed'
      || item.vectorStatus === 'cancelled'
      || item.vectorStatus === 'status_error').length
    const succeeded = items.filter(item => item.parseStatus === 'succeeded' && (item.vectorStatus === 'succeeded' || item.vectorStatus === 'unavailable')).length
    return {
      total,
      failed,
      succeeded,
      running: Math.max(0, total - failed - succeeded),
      allDone: total > 0 && total === failed + succeeded,
    }
  }, [progress?.items])

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="文件处理中，请稍候"
        extra={(
          <Space>
            <Tag color="blue">总数 {stats.total}</Tag>
            <Tag color="processing">处理中 {stats.running}</Tag>
            <Tag color="success">已完成 {stats.succeeded}</Tag>
            <Tag color="error">失败 {stats.failed}</Tag>
            <Button onClick={loadProgress} loading={loading}>刷新</Button>
            <Button onClick={() => router.push('/app/file-processing')}>全部处理清单</Button>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}`)}>返回项目</Button>
          </Space>
        )}
      >
        <div className="mb-3 text-sm text-gray-600">
          {stats.allDone ? '当前项目文件处理已完成，你可以返回项目查看结果。' : '系统正在进行文件解析与向量处理，请等待。'}
        </div>
        <Table<ProgressItem>
          rowKey="jobId"
          loading={loading}
          dataSource={progress?.items || []}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            { title: '文件', dataIndex: 'fileName', width: 220 },
            { title: '分类', dataIndex: 'manualCategory', width: 110 },
            { title: '文件类型组', dataIndex: 'fileTypeGroup', width: 120 },
            { title: '解析状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
            { title: '向量状态', dataIndex: 'vectorStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
            { title: '当前阶段', dataIndex: 'currentStage', width: 140 },
            { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: value => formatShanghaiDateTime(value) },
            { title: '错误信息', dataIndex: 'errorMessage', width: 240, render: value => value || '-' },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, record) => (
                <Button
                  size="small"
                  danger
                  loading={terminatingJobID === record.jobId}
                  disabled={!((record.parseStatus === 'pending' || record.parseStatus === 'running') || (record.vectorStatus === 'pending' || record.vectorStatus === 'running'))}
                  onClick={() => terminateSingleFile(record)}
                >
                  终止
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
