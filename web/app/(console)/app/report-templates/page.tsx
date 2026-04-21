'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useConsoleRole } from '@/lib/useConsoleRole'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type ReportTemplateDTO = {
  id: number
  templateKey: string
  name: string
  description: string
  status: 'active' | 'disabled'
}

type UserDTO = {
  id: number
  username: string
  name: string
  role: 'admin' | 'user'
}

type ReportTemplateSharedUserDTO = {
  id: number
  username: string
  name: string
  role: 'admin' | 'user'
}

const DEFAULT_TEMPLATE_CATEGORIES = [
  { key: 'subject', name: '主体', required: true, isTable: false },
  { key: 'region', name: '区域', required: true, isTable: false },
  { key: 'finance', name: '财务', required: true, isTable: false },
  { key: 'project', name: '项目', required: false, isTable: false },
  { key: 'counter_guarantee', name: '反担保', required: false, isTable: false },
  { key: 'counter_guarantee_finance', name: '反担保财报', required: false, isTable: false },
  { key: 'other', name: '其他', required: false, isTable: false },
]

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function ReportTemplatesPage() {
  const router = useRouter()
  const { role, hydrated } = useConsoleRole()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<ReportTemplateDTO[]>([])
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareSaving, setShareSaving] = useState(false)
  const [sharingTemplate, setSharingTemplate] = useState<ReportTemplateDTO | null>(null)
  const [allUsers, setAllUsers] = useState<UserDTO[]>([])
  const [sharedUserIds, setSharedUserIds] = useState<number[]>([])
  const [createForm] = Form.useForm()
  const isAdmin = role === 'admin'

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (!(init?.body instanceof FormData))
      headers['content-type'] = 'application/json'
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`

    const response = await fetch(url, { ...init, headers, credentials: 'include' })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app/report-templates')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const rows = await request<ReportTemplateDTO[]>('/api/report-templates', { method: 'GET' })
      setTemplates(Array.isArray(rows) ? rows : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载模板失败')
    }
    finally {
      setLoading(false)
    }
  }

  const loadUsers = async () => {
    if (!isAdmin)
      return
    try {
      const users = await request<UserDTO[]>('/api/users', { method: 'GET' })
      setAllUsers((users || []).filter(user => user.role === 'user'))
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载用户失败')
    }
  }

  useEffect(() => {
    if (hydrated && (role === 'admin' || role === 'user'))
      loadTemplates()
  }, [hydrated, role])

  useEffect(() => {
    if (hydrated && isAdmin)
      loadUsers()
  }, [hydrated, isAdmin])

  const createTemplate = async () => {
    try {
      const values = await createForm.validateFields()
      setCreating(true)
      const payload = {
        templateKey: values.templateKey,
        name: values.name,
        description: values.description || '',
        status: values.status,
        categoriesJson: DEFAULT_TEMPLATE_CATEGORIES,
        processingConfigJson: {},
        contentMarkdown: values.contentMarkdown || '## 新章节\n\n请编辑内容。',
        editorConfigJson: {},
        annotationsJson: [],
      }
      const created = await request<ReportTemplateDTO>('/api/report-templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      msgApi.success('模板已创建')
      setCreateOpen(false)
      createForm.resetFields()
      await loadTemplates()
      router.push(`/app/report-templates/${created.id}`)
    }
    catch (error) {
      if (error instanceof Error)
        msgApi.error(error.message)
    }
    finally {
      setCreating(false)
    }
  }

  const openShareModal = async (template: ReportTemplateDTO) => {
    if (!isAdmin)
      return
    setSharingTemplate(template)
    setShareOpen(true)
    setShareLoading(true)
    try {
      const sharedUsers = await request<ReportTemplateSharedUserDTO[]>(`/api/report-templates/${template.id}/share-users`, { method: 'GET' })
      setSharedUserIds((sharedUsers || []).map(item => item.id))
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载共享用户失败')
    }
    finally {
      setShareLoading(false)
    }
  }

  const saveShareUsers = async () => {
    if (!isAdmin || !sharingTemplate)
      return
    setShareSaving(true)
    try {
      await request<ReportTemplateSharedUserDTO[]>(`/api/report-templates/${sharingTemplate.id}/share-users`, {
        method: 'PUT',
        body: JSON.stringify({ userIds: sharedUserIds }),
      })
      msgApi.success('共享用户已更新')
      setShareOpen(false)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '保存共享失败')
    }
    finally {
      setShareSaving(false)
    }
  }

  const columns = useMemo<ColumnsType<ReportTemplateDTO>>(() => {
    const baseColumns: ColumnsType<ReportTemplateDTO> = [
      {
        title: '模板名称',
        dataIndex: 'name',
        key: 'name',
      },
      {
        title: '模板键',
        dataIndex: 'templateKey',
        key: 'templateKey',
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (value: ReportTemplateDTO['status']) => value === 'active'
          ? <Tag color="green">启用</Tag>
          : <Tag color="default">停用</Tag>,
      },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true,
      },
      {
        title: '操作',
        key: 'actions',
        width: 220,
        render: (_, row) => (
          <Space>
            <Button type="link" onClick={() => router.push(`/app/report-templates/${row.id}`)}>进入编辑</Button>
            {isAdmin && <Button type="link" onClick={() => openShareModal(row)}>共享</Button>}
          </Space>
        ),
      },
    ]
    return baseColumns
  }, [isAdmin, router])

  if (!hydrated) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">{contextHolder}<div className="text-sm text-gray-500">加载中...</div></div>
  }

  if (role === 'guest') {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">{contextHolder}<div className="text-sm text-gray-500">请先登录。</div></div>
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="报告模板列表"
        extra={(
          <Space>
            <Button onClick={loadTemplates} loading={loading}>刷新</Button>
            {isAdmin && <Button onClick={() => setCreateOpen(true)}>新建模板</Button>}
          </Space>
        )}
      >
        <Typography.Paragraph type="secondary">
          点击“进入编辑”打开独立编辑页；共享权限在列表页统一管理。
        </Typography.Paragraph>
        <Table<ReportTemplateDTO>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={templates}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </Card>

      <Modal
        open={createOpen}
        title="新建报告模板"
        onCancel={() => setCreateOpen(false)}
        onOk={createTemplate}
        confirmLoading={creating}
      >
        <Form form={createForm} layout="vertical" initialValues={{ status: 'active', contentMarkdown: '## 新章节\n\n请编辑内容。' }}>
          <Form.Item name="templateKey" label="templateKey" rules={[{ required: true, message: '请输入 templateKey' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          </Form.Item>
          <Form.Item name="contentMarkdown" label="初始内容（用于生成首版文档）">
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={shareOpen}
        title={sharingTemplate ? `共享：${sharingTemplate.name}` : '共享设置'}
        onCancel={() => setShareOpen(false)}
        onOk={saveShareUsers}
        confirmLoading={shareSaving}
        destroyOnHidden
      >
        <div className="space-y-2">
          <Typography.Text type="secondary">选择可协同编辑的普通用户（可多选）</Typography.Text>
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="选择普通用户"
            value={sharedUserIds}
            loading={shareLoading}
            options={allUsers.map(user => ({
              value: user.id,
              label: `${user.name}（${user.username}）`,
            }))}
            onChange={values => setSharedUserIds(values)}
          />
        </div>
      </Modal>
    </div>
  )
}
