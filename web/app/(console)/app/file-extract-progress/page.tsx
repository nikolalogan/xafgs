'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Modal, Space, Table, Tabs, Tag, message } from 'antd'
import ParsedDocumentViewer from '@/components/files/ParsedDocumentViewer'
import { formatShanghaiDateTime } from '@/lib/time'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type FileParseQueueItemDTO = {
  jobId: number
  fileId: number
  versionNo: number
  fileName: string
  sourceScope: string
  projectId?: number
  projectName?: string
  caseFileId?: number
  manualCategory?: string
  fileType: string
  sourceType: string
  parseStrategy: string
  ocrTaskStatus?: string
  ocrPending?: boolean
  ocrError?: string
  parseStatus: string
  currentStage: string
  errorMessage: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

type FileParseResultDTO = {
  version: {
    fileId: number
    versionNo: number
    originName: string
  }
  profile: Record<string, unknown>
  sliceCount: number
  tableCount: number
  figureCount: number
  fragmentCount: number
  cellCount: number
  markdown?: string
  text?: string
  document?: Record<string, unknown> | null
  slices: unknown[]
  tables: unknown[]
  figures: unknown[]
}

type FileParseJobDTO = {
  jobId: number
  fileId: number
  versionNo: number
  status: string
  retryCount: number
  errorMessage: string
  fileType: string
  sourceType: string
  parseStrategy: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  latestResult?: FileParseResultDTO
  resultReady?: boolean
}

type EnterpriseProjectDTO = {
  id: number
  enterpriseId: number
  name: string
}

type EnterpriseProgressItem = {
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
  items: EnterpriseProgressItem[]
}

type EnterpriseRow = EnterpriseProgressItem & {
  projectId: number
  projectName: string
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
  if (status === 'running' || status === 'processing')
    return 'processing'
  return 'default'
}

export default function FileExtractProgressPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [queueRows, setQueueRows] = useState<FileParseQueueItemDTO[]>([])
  const [enterpriseRows, setEnterpriseRows] = useState<EnterpriseRow[]>([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailResult, setDetailResult] = useState<FileParseResultDTO | null>(null)

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
      router.push('/?redirect=/app/file-extract-progress')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadQueue = async () => {
    const data = await request<FileParseQueueItemDTO[]>('/api/files/parse-jobs?limit=200', { method: 'GET' })
    setQueueRows(Array.isArray(data) ? data : [])
  }

  const loadEnterpriseProgress = async () => {
    const projects = await request<EnterpriseProjectDTO[]>('/api/enterprise-projects', { method: 'GET' })
    const safeProjects = Array.isArray(projects) ? projects : []
    const progressList = await Promise.all(
      safeProjects.map(async project => {
        const progress = await request<EnterpriseProjectProgressDTO>(`/api/enterprise-projects/${project.id}/progress`, { method: 'GET' })
        return { project, progress }
      }),
    )
    const flatRows: EnterpriseRow[] = []
    for (const item of progressList) {
      const progressItems = Array.isArray(item.progress?.items) ? item.progress.items : []
      for (const row of progressItems) {
        flatRows.push({
          ...row,
          projectId: item.project.id,
          projectName: item.project.name || `项目-${item.project.id}`,
        })
      }
    }
    flatRows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    setEnterpriseRows(flatRows)
  }

  const loadAll = async () => {
    setLoading(true)
    try {
      await Promise.all([loadQueue(), loadEnterpriseProgress()])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载进度失败')
    }
    finally {
      setLoading(false)
    }
  }

  const openDetail = async (jobId: number) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailResult(null)
    try {
      const data = await request<FileParseJobDTO>(`/api/files/parse-jobs/${jobId}`, { method: 'GET' })
      if (data?.latestResult)
        setDetailResult(data.latestResult)
      else
        msgApi.warning('解析结果尚未生成')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '获取解析详情失败')
    }
    finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadAll()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const stats = useMemo(() => {
    const total = queueRows.length
    const running = queueRows.filter(item => item.parseStatus === 'pending' || item.parseStatus === 'running').length
    const failed = queueRows.filter(item => item.parseStatus === 'failed' || item.parseStatus === 'cancelled').length
    const succeeded = queueRows.filter(item => item.parseStatus === 'succeeded').length
    return { total, running, failed, succeeded }
  }, [queueRows])

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="文件提取进度"
        extra={(
          <Space>
            <Tag color="blue">总数 {stats.total}</Tag>
            <Tag color="processing">处理中 {stats.running}</Tag>
            <Tag color="success">完成 {stats.succeeded}</Tag>
            <Tag color="error">失败 {stats.failed}</Tag>
            <Button onClick={loadAll} loading={loading}>刷新</Button>
          </Space>
        )}
      >
        <Tabs
          items={[
            {
              key: 'file-manage',
              label: '统一文件解析队列',
              children: (
                <Table<FileParseQueueItemDTO>
                  rowKey={row => `${row.jobId}`}
                  loading={loading}
                  dataSource={queueRows}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  columns={[
                    { title: '任务ID', dataIndex: 'jobId', width: 90 },
                    { title: '文件', dataIndex: 'fileName', width: 220 },
                    { title: '来源', dataIndex: 'sourceScope', width: 130, render: value => value || '-' },
                    { title: '项目', dataIndex: 'projectName', width: 180, render: value => value || '-' },
                    { title: '分类', dataIndex: 'manualCategory', width: 120, render: value => value || '-' },
                    { title: 'fileId/v', width: 120, render: (_, row) => `${row.fileId}/v${row.versionNo}` },
                    { title: '文件类型', dataIndex: 'fileType', width: 100, render: value => value || '-' },
                    { title: '来源类型', dataIndex: 'sourceType', width: 120, render: value => value || '-' },
                    { title: '提取方式', dataIndex: 'parseStrategy', width: 140, render: value => value || '-' },
                    { title: 'Docling状态', dataIndex: 'ocrTaskStatus', width: 120, render: value => value || '-' },
                    { title: 'Docling待完成', dataIndex: 'ocrPending', width: 120, render: value => value ? <Tag color="processing">是</Tag> : '-' },
                    { title: '状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
                    { title: '阶段', dataIndex: 'currentStage', width: 120, render: value => value || '-' },
                    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: value => formatShanghaiDateTime(value) },
                    { title: 'Docling错误', dataIndex: 'ocrError', width: 220, render: value => value || '-' },
                    { title: '错误', dataIndex: 'errorMessage', width: 220, render: value => value || '-' },
                    {
                      title: '操作',
                      width: 130,
                      fixed: 'right',
                      render: (_, row) => (
                        <Button size="small" onClick={() => openDetail(row.jobId)}>
                          查看完整结果
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'enterprise',
              label: '企业项目文件进度',
              children: (
                <Table<EnterpriseRow>
                  rowKey={row => `${row.projectId}-${row.jobId}`}
                  loading={loading}
                  dataSource={enterpriseRows}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  columns={[
                    { title: '项目', dataIndex: 'projectName', width: 220 },
                    { title: '文件', dataIndex: 'fileName', width: 220 },
                    { title: '分类', dataIndex: 'manualCategory', width: 110 },
                    { title: '文件类型', dataIndex: 'fileTypeGroup', width: 100 },
                    { title: '解析状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
                    { title: '向量状态', dataIndex: 'vectorStatus', width: 110, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
                    { title: '阶段', dataIndex: 'currentStage', width: 120 },
                    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: value => formatShanghaiDateTime(value) },
                    {
                      title: '操作',
                      width: 120,
                      render: (_, row) => (
                        <Button size="small" type="link" onClick={() => router.push(`/app/enterprise-projects/${row.projectId}`)}>
                          查看项目
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="完整解析结果"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={1000}
      >
        {detailLoading
          ? <div className="py-6 text-sm text-gray-500">加载中...</div>
          : detailResult
            ? <ParsedDocumentViewer result={detailResult as any} />
            : <div className="py-6 text-sm text-gray-500">暂无可展示结果</div>}
      </Modal>
    </div>
  )
}
