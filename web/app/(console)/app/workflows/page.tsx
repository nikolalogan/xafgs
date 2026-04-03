'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Form, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'

type WorkflowStatus = 'active' | 'disabled'
type WorkflowMenuKey = '' | 'reserve' | 'review' | 'postloan'

type WorkflowDTO = {
  id: number
  workflowKey: string
  name: string
  description: string
  menuKey: WorkflowMenuKey
  status: WorkflowStatus
  currentDraftVersionNo: number
  currentPublishedVersionNo: number
  createdAt: string
  updatedAt: string
}

type WorkflowVersionDTO = {
  versionNo: number
  createdAt: string
  isDraft: boolean
  isPublished: boolean
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const statusColorMap: Record<WorkflowStatus, string> = {
  active: 'green',
  disabled: 'default',
}

const statusLabelMap: Record<WorkflowStatus, string> = {
  active: '启用',
  disabled: '停用',
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

function WorkflowsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowDTO[]>([])
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<WorkflowDTO | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false)
  const [versionOptions, setVersionOptions] = useState<WorkflowVersionDTO[]>([])
  const [rollbackForm] = Form.useForm()
  const [hydrated, setHydrated] = useState(false)
  const [currentRole, setCurrentRole] = useState<'admin' | 'user' | 'guest'>('guest')

  useEffect(() => {
    const syncRole = () => {
      const raw = (window.localStorage.getItem('sxfg_user_role') || window.localStorage.getItem('user_role') || 'guest').toLowerCase()
      if (raw === 'admin' || raw === 'user') {
        setCurrentRole(raw)
        return
      }
      setCurrentRole('guest')
    }
    syncRole()
    setHydrated(true)
  }, [])

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
	      router.push('/?redirect=/app/workflows')
	      throw new Error('未登录或登录已过期')
	    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  const fetchWorkflows = async () => {
    setLoading(true)
    try {
      const data = await request<WorkflowDTO[]>('/api/workflows', { method: 'GET' })
      setWorkflows(Array.isArray(data) ? data : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载工作流失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkflows()
  }, [])

  const selectedMenuKey = useMemo(() => {
    const raw = (searchParams.get('menuKey') || '').toLowerCase()
    if (raw === 'reserve' || raw === 'review' || raw === 'postloan')
      return raw as WorkflowMenuKey
    return ''
  }, [searchParams])

  const filteredWorkflows = useMemo(() => {
    if (!selectedMenuKey)
      return workflows
    return workflows.filter(item => item.menuKey === selectedMenuKey)
  }, [selectedMenuKey, workflows])

  const menuKeyLabel = useMemo(() => {
    if (selectedMenuKey === 'reserve')
      return '储备'
    if (selectedMenuKey === 'review')
      return '评审'
    if (selectedMenuKey === 'postloan')
      return '保后'
    return ''
  }, [selectedMenuKey])

  const remove = async (workflow: WorkflowDTO) => {
    try {
      await request<boolean>(`/api/workflows/${workflow.id}`, { method: 'DELETE' })
      msgApi.success('删除工作流成功')
      fetchWorkflows()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '删除工作流失败')
    }
  }

  const publish = async (workflow: WorkflowDTO) => {
    try {
      await request<WorkflowDTO>(`/api/workflows/${workflow.id}/publish`, { method: 'POST' })
      msgApi.success('发布工作流成功')
      fetchWorkflows()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '发布工作流失败')
    }
  }

  const offline = async (workflow: WorkflowDTO) => {
    try {
      await request<WorkflowDTO>(`/api/workflows/${workflow.id}/offline`, { method: 'POST' })
      msgApi.success('下线工作流成功')
      fetchWorkflows()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '下线工作流失败')
    }
  }

  const openRollback = (workflow: WorkflowDTO) => {
    const loadVersions = async () => {
      setRollbackTarget(workflow)
      setVersionLoading(true)
      try {
        const versions = await request<WorkflowVersionDTO[]>(`/api/workflows/${workflow.id}/versions`, { method: 'GET' })
        const safeVersions = Array.isArray(versions) ? versions : []
        setVersionOptions(safeVersions)
        const defaultVersion = safeVersions.find(item => item.isPublished)?.versionNo
          || safeVersions[safeVersions.length - 1]?.versionNo
          || 1
        rollbackForm.setFieldsValue({ versionNo: defaultVersion })
        setRollbackModalOpen(true)
      }
      catch (error) {
        msgApi.error(error instanceof Error ? error.message : '加载版本列表失败')
      }
      finally {
        setVersionLoading(false)
      }
    }
    loadVersions()
  }

  const submitRollback = async () => {
    if (!rollbackTarget)
      return
    try {
      setRollbackSubmitting(true)
      const values = await rollbackForm.validateFields()
      await request<WorkflowDTO>(`/api/workflows/${rollbackTarget.id}/rollback`, {
        method: 'POST',
        body: JSON.stringify({
          versionNo: Number(values.versionNo),
        }),
      })
      msgApi.success('回滚工作流成功')
      setRollbackModalOpen(false)
      setRollbackTarget(null)
      setVersionOptions([])
      fetchWorkflows()
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('out of date'))
        return
      msgApi.error(error instanceof Error ? error.message : '回滚工作流失败')
    }
    finally {
      setRollbackSubmitting(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="space-y-3">
        {contextHolder}
        <Form form={rollbackForm} style={{ display: 'none' }} />
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="text-sm text-gray-500">加载中...</div>
        </div>
      </div>
    )
  }

  if (currentRole === 'guest') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <Form form={rollbackForm} style={{ display: 'none' }} />
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">请先登录后再访问工作流配置。</div>
      </div>
    )
  }

  if (currentRole !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <Form form={rollbackForm} style={{ display: 'none' }} />
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">工作流配置仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">
            工作流配置列表{menuKeyLabel ? `（${menuKeyLabel}）` : ''}
          </div>
          <Button type="primary" onClick={() => router.push('/app/workflows/new')}>新增工作流</Button>
        </div>
        <Table<WorkflowDTO>
          rowKey="id"
          loading={loading}
          dataSource={filteredWorkflows}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 90 },
            { title: 'Key', dataIndex: 'workflowKey', width: 220 },
            { title: '名称', dataIndex: 'name', width: 180 },
            {
              title: '菜单',
              dataIndex: 'menuKey',
              width: 110,
              render: (value: WorkflowMenuKey) => {
                if (value === 'reserve')
                  return '储备'
                if (value === 'review')
                  return '评审'
                if (value === 'postloan')
                  return '保后'
                return value
              },
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (status: WorkflowStatus) => (
                <Tag color={statusColorMap[status]}>
                  {statusLabelMap[status]}
                </Tag>
              ),
            },
            { title: '草稿版本', dataIndex: 'currentDraftVersionNo', width: 110 },
            { title: '发布版本', dataIndex: 'currentPublishedVersionNo', width: 110 },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 200,
              render: (value: string) => new Date(value).toLocaleString(),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, record) => (
                <Space>
                  <Button size="small" onClick={() => router.push(`/app/workflows/${record.id}`)}>修改</Button>
                  <Button size="small" onClick={() => router.push(`/app/workflows/${record.id}/run`)}>运行</Button>
                  {record.currentPublishedVersionNo > 0
                    ? <Button size="small" onClick={() => offline(record)}>下线</Button>
                    : <Button size="small" onClick={() => publish(record)}>发布</Button>}
                  <Button size="small" onClick={() => openRollback(record)}>回滚</Button>
                  <Popconfirm
                    title="确认删除该工作流？"
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

      <Modal
        title="回滚工作流"
        open={rollbackModalOpen}
        onCancel={() => {
          setRollbackModalOpen(false)
          setRollbackTarget(null)
          setVersionOptions([])
        }}
        onOk={submitRollback}
        confirmLoading={versionLoading || rollbackSubmitting}
        destroyOnHidden
      >
        <Form form={rollbackForm} layout="vertical">
          <Form.Item
            label="目标版本号"
            name="versionNo"
            rules={[
              { required: true, message: '请选择版本号' },
              {
                validator: (_, value) => {
                  const versionNo = Number(value)
                  if (Number.isInteger(versionNo) && versionNo > 0)
                    return Promise.resolve()
                  return Promise.reject(new Error('版本号必须为正整数'))
                },
              },
            ]}
          >
            <Select
              placeholder="请选择回滚版本"
              options={versionOptions.map(item => ({
                label: `v${item.versionNo}${item.isPublished ? '（已发布）' : ''}${item.isDraft ? '（当前草稿）' : ''} - ${new Date(item.createdAt).toLocaleString()}`,
                value: item.versionNo,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default function WorkflowsPage() {
  return (
    <Suspense
      fallback={(
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="text-sm text-gray-500">加载中...</div>
        </div>
      )}
    >
      <WorkflowsPageInner />
    </Suspense>
  )
}
