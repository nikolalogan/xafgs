'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Space, Table, Tag, message } from 'antd'
import { formatShanghaiDateTime } from '@/lib/time'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type VectorQueueItemDTO = {
  jobId: number
  fileId: number
  versionNo: number
  fileName: string
  status: string
  retryCount: number
  errorMessage: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
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

export default function VectorProgressPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<VectorQueueItemDTO[]>([])

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
      router.push('/?redirect=/app/vector-progress')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await request<VectorQueueItemDTO[]>('/api/knowledge/jobs?limit=300', { method: 'GET' })
      setRows(Array.isArray(data) ? data : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载向量进度失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadData()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const stats = useMemo(() => {
    const total = rows.length
    const running = rows.filter(item => item.status === 'pending' || item.status === 'running').length
    const failed = rows.filter(item => item.status === 'failed' || item.status === 'cancelled').length
    const succeeded = rows.filter(item => item.status === 'succeeded').length
    return { total, running, failed, succeeded }
  }, [rows])

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="向量进度"
        extra={(
          <Space>
            <Tag color="blue">总数 {stats.total}</Tag>
            <Tag color="processing">处理中 {stats.running}</Tag>
            <Tag color="success">完成 {stats.succeeded}</Tag>
            <Tag color="error">失败 {stats.failed}</Tag>
            <Button onClick={loadData} loading={loading}>刷新</Button>
          </Space>
        )}
      >
        <Table<VectorQueueItemDTO>
          rowKey={row => `${row.jobId}`}
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 12, showSizeChanger: true }}
          columns={[
            { title: '任务ID', dataIndex: 'jobId', width: 100 },
            { title: '文件', dataIndex: 'fileName', width: 240, render: value => value || '-' },
            { title: 'fileId/v', width: 120, render: (_, row) => `${row.fileId}/v${row.versionNo}` },
            { title: '状态', dataIndex: 'status', width: 120, render: value => <Tag color={parseStatusColor(String(value || ''))}>{String(value || '-')}</Tag> },
            { title: '重试', dataIndex: 'retryCount', width: 80 },
            { title: '开始时间', dataIndex: 'startedAt', width: 170, render: value => value ? formatShanghaiDateTime(value) : '-' },
            { title: '完成时间', dataIndex: 'finishedAt', width: 170, render: value => value ? formatShanghaiDateTime(value) : '-' },
            { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: value => formatShanghaiDateTime(value) },
            { title: '错误信息', dataIndex: 'errorMessage', render: value => value || '-' },
          ]}
        />
      </Card>
    </div>
  )
}

