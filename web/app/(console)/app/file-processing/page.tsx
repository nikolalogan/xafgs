'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Space, Table, Tag, message } from 'antd'
import { formatShanghaiDateTime } from '@/lib/time'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type EnterpriseProjectDTO = {
  id: number
  enterpriseId: number
  templateId: number
  reportCaseId: number
  name: string
  status: string
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

type ProcessingRow = ProgressItem & {
  projectId: number
  projectName: string
  enterpriseId: number
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

export default function FileProcessingPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [terminatingKey, setTerminatingKey] = useState('')
  const [rows, setRows] = useState<ProcessingRow[]>([])

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
      router.push('/?redirect=/app/file-processing')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadAllProgress = async () => {
    setLoading(true)
    try {
      const projects = await request<EnterpriseProjectDTO[]>('/api/enterprise-projects', { method: 'GET' })
      const safeProjects = Array.isArray(projects) ? projects : []
      const progressList = await Promise.all(
        safeProjects.map(async project => {
          const progress = await request<EnterpriseProjectProgressDTO>(`/api/enterprise-projects/${project.id}/progress`, { method: 'GET' })
          return { project, progress }
        }),
      )

      const flatRows: ProcessingRow[] = []
      for (const item of progressList) {
        const progressItems = Array.isArray(item.progress?.items) ? item.progress.items : []
        for (const row of progressItems) {
          flatRows.push({
            ...row,
            projectId: item.project.id,
            projectName: item.project.name || `项目-${item.project.id}`,
            enterpriseId: item.project.enterpriseId,
          })
        }
      }
      flatRows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setRows(flatRows)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载文件处理清单失败')
    }
    finally {
      setLoading(false)
    }
  }

  const terminateSingleFile = async (record: ProcessingRow) => {
    const key = `${record.projectId}-${record.caseFileId}`
    setTerminatingKey(key)
    try {
      const response = await request<EnterpriseProjectFileTerminateResultDTO>(
        `/api/enterprise-projects/${record.projectId}/files/${record.caseFileId}/terminate`,
        { method: 'POST' },
      )
      msgApi.success(response?.message || '终止请求已处理')
      loadAllProgress()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '终止失败')
    }
    finally {
      setTerminatingKey('')
    }
  }

  useEffect(() => {
    loadAllProgress()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadAllProgress()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const stats = useMemo(() => {
    const total = rows.length
    const failed = rows.filter(row =>
      row.parseStatus === 'failed'
      || row.parseStatus === 'cancelled'
      || row.vectorStatus === 'failed'
      || row.vectorStatus === 'cancelled'
      || row.vectorStatus === 'status_error').length
    const succeeded = rows.filter(row => row.parseStatus === 'succeeded' && (row.vectorStatus === 'succeeded' || row.vectorStatus === 'unavailable')).length
    return {
      total,
      failed,
      running: Math.max(0, total - failed - succeeded),
      succeeded,
    }
  }, [rows])

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="文件处理清单"
        extra={(
          <Space>
            <Tag color="blue">总数 {stats.total}</Tag>
            <Tag color="processing">处理中 {stats.running}</Tag>
            <Tag color="success">已完成 {stats.succeeded}</Tag>
            <Tag color="error">失败 {stats.failed}</Tag>
            <Button onClick={loadAllProgress} loading={loading}>刷新</Button>
          </Space>
        )}
      >
        <Table<ProcessingRow>
          rowKey={row => `${row.projectId}-${row.jobId}`}
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            { title: '项目', dataIndex: 'projectName', width: 220, render: (_, record) => `${record.projectName} (#${record.projectId})` },
            { title: '企业ID', dataIndex: 'enterpriseId', width: 90 },
            { title: '文件', dataIndex: 'fileName', width: 220 },
            { title: '分类', dataIndex: 'manualCategory', width: 100 },
            { title: '解析状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
            { title: '向量状态', dataIndex: 'vectorStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
            { title: '阶段', dataIndex: 'currentStage', width: 120 },
            { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: value => formatShanghaiDateTime(value) },
            { title: '错误信息', dataIndex: 'errorMessage', width: 240, render: value => value || '-' },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              render: (_, record) => (
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => router.push(`/app/enterprise-projects/${record.projectId}`)}>
                    查看项目
                  </Button>
                  <Button
                    size="small"
                    danger
                    loading={terminatingKey === `${record.projectId}-${record.caseFileId}`}
                    disabled={!((record.parseStatus === 'pending' || record.parseStatus === 'running') || (record.vectorStatus === 'pending' || record.vectorStatus === 'running'))}
                    onClick={() => terminateSingleFile(record)}
                  >
                    终止
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
