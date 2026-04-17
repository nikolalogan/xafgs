'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Button, Card, Input, Space, Table, Tag, message } from 'antd'
import { formatShanghaiDateTime } from '@/lib/time'

type EnterpriseProjectDTO = {
  id: number
  enterpriseId: number
  templateId: number
  reportCaseId: number
  name: string
  status: string
  createdAt: string
  updatedAt: string
}

type ApiResponse<T> = {
  message?: string
  data?: T
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
  if (status === 'completed')
    return 'success'
  if (status === 'failed')
    return 'error'
  if (status === 'processing')
    return 'processing'
  return 'default'
}

function EnterpriseProjectsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<EnterpriseProjectDTO[]>([])
  const initialEnterpriseId = useMemo(() => {
    const raw = searchParams.get('enterpriseId') || ''
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : ''
  }, [searchParams])
  const [enterpriseIdInput, setEnterpriseIdInput] = useState(initialEnterpriseId)

  useEffect(() => {
    setEnterpriseIdInput(initialEnterpriseId)
  }, [initialEnterpriseId])

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
    })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app/enterprise-projects')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const fetchList = async () => {
    setLoading(true)
    try {
      const search = new URLSearchParams()
      const parsed = Number(enterpriseIdInput)
      if (Number.isFinite(parsed) && parsed > 0)
        search.set('enterpriseId', String(parsed))
      const suffix = search.toString()
      const data = await request<EnterpriseProjectDTO[]>(`/api/enterprise-projects${suffix ? `?${suffix}` : ''}`, { method: 'GET' })
      setItems(Array.isArray(data) ? data : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载项目列表失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [initialEnterpriseId])

  const applyFilter = () => {
    const parsed = Number(enterpriseIdInput)
    if (enterpriseIdInput.trim() === '') {
      router.push('/app/enterprise-projects')
      return
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      msgApi.warning('企业 ID 需为正整数')
      return
    }
    router.push(`/app/enterprise-projects?enterpriseId=${parsed}`)
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="项目列表"
        extra={(
          <Space>
            <Button onClick={() => router.push('/app/enterprises')}>返回企业列表</Button>
            <Button onClick={fetchList} loading={loading}>刷新</Button>
          </Space>
        )}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            value={enterpriseIdInput}
            onChange={event => setEnterpriseIdInput(event.target.value)}
            placeholder="按企业 ID 过滤"
            style={{ width: 220 }}
          />
          <Button type="primary" onClick={applyFilter}>筛选</Button>
          <Button onClick={() => {
            setEnterpriseIdInput('')
            router.push('/app/enterprise-projects')
          }}
          >
            重置
          </Button>
          {initialEnterpriseId ? <Tag color="blue">企业 ID: {initialEnterpriseId}</Tag> : <Tag>全部企业</Tag>}
        </div>

        <Table<EnterpriseProjectDTO>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            { title: '项目ID', dataIndex: 'id', width: 90 },
            { title: '项目名称', dataIndex: 'name', width: 220 },
            { title: '企业ID', dataIndex: 'enterpriseId', width: 100 },
            { title: '模板ID', dataIndex: 'templateId', width: 100 },
            { title: '报告实例ID', dataIndex: 'reportCaseId', width: 110 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (value: string) => <Tag color={parseStatusColor(value)}>{value || '-'}</Tag>,
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 180,
              render: value => formatShanghaiDateTime(value),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, record) => (
                <Button size="small" type="link" onClick={() => router.push(`/app/enterprise-projects/${record.id}`)}>
                  查看详情
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}

export default function EnterpriseProjectsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">加载中...</div>}>
      <EnterpriseProjectsPageContent />
    </Suspense>
  )
}
