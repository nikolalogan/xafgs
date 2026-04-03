'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Popconfirm, Space, Table, Tag, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'

type TemplateStatus = 'active' | 'disabled'
type TemplateOutputType = 'text' | 'html'

type TemplateDTO = {
  id: number
  templateKey: string
  name: string
  description: string
  engine: string
  outputType: TemplateOutputType
  status: TemplateStatus
  createdAt: string
  updatedAt: string
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const statusColorMap: Record<TemplateStatus, string> = {
  active: 'green',
  disabled: 'default',
}

const statusLabelMap: Record<TemplateStatus, string> = {
  active: '启用',
  disabled: '停用',
}

const outputTypeLabelMap: Record<TemplateOutputType, string> = {
  text: '文本',
  html: 'HTML',
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function TemplatesPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<TemplateDTO[]>([])

  const { role: currentRole, hydrated } = useConsoleRole()

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
	      router.push('/?redirect=/app/templates')
	      throw new Error('未登录或登录已过期')
	    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问（仅管理员可用）')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const data = await request<TemplateDTO[]>('/api/templates', { method: 'GET' })
      setTemplates(Array.isArray(data) ? data : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载模板失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  const remove = async (template: TemplateDTO) => {
    try {
      await request<boolean>(`/api/templates/${template.id}`, { method: 'DELETE' })
      msgApi.success('删除模板成功')
      fetchTemplates()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '删除模板失败')
    }
  }

  if (!hydrated) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-sm text-gray-500">加载中...</div>
      </div>
    )
  }

  if (currentRole !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">模板配置仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">模板列表</div>
          <Button type="primary" onClick={() => router.push('/app/templates/new')}>新增模板</Button>
        </div>
        <Table<TemplateDTO>
          rowKey="id"
          loading={loading}
          dataSource={templates}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 90 },
            { title: 'Key', dataIndex: 'templateKey', width: 200 },
            { title: '名称', dataIndex: 'name', width: 220 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (status: TemplateStatus) => (
                <Tag color={statusColorMap[status]}>
                  {statusLabelMap[status]}
                </Tag>
              ),
            },
            {
              title: '输出',
              dataIndex: 'outputType',
              width: 120,
              render: (outputType: TemplateOutputType) => outputTypeLabelMap[outputType] || outputType,
            },
            { title: '更新时间', dataIndex: 'updatedAt', width: 220 },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              render: (_, record) => (
                <Space>
                  <Button size="small" onClick={() => router.push(`/app/templates/${record.id}/edit`)}>编辑</Button>
                  <Popconfirm
                    title="确认删除该模板？"
                    description={`${record.name}（${record.templateKey}）`}
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => remove(record)}
                  >
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}
