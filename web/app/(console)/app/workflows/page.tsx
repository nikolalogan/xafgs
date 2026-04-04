'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { UploadOutlined } from '@ant-design/icons'
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Upload, message } from 'antd'
import { parseDifyWorkflowDSL } from '@/components/workflow/dify/core/dsl'
import { validateWorkflow } from '@/components/workflow/dify/core/validation'

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

type UploadSessionDTO = {
  id: string
  fileId: number
}

type FileUploadResultDTO = {
  fileId: number
  versionNo: number
}

type WorkflowDSLGenerateResult = {
  model: string
  generatedDsl: Record<string, unknown>
}

type SystemModelOption = {
  name: string
  label: string
  enabled: boolean
}

type SystemConfigDTO = {
  models: SystemModelOption[]
  defaultModel: string
  codeDefaultModel: string
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

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

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
  const [aiCreateOpen, setAICreateOpen] = useState(false)
  const [aiCreating, setAICreating] = useState(false)
  const [aiUploadFile, setAIUploadFile] = useState<File | null>(null)
  const [aiModelOptions, setAIModelOptions] = useState<Array<{ label: string, value: string }>>([{ label: 'GPT-4o mini', value: 'gpt-4o-mini' }])
  const [aiDefaultModel, setAIDefaultModel] = useState('gpt-4o-mini')
  const [aiCreateForm] = Form.useForm<{ workflowKey: string, name: string, menuKey: WorkflowMenuKey, description: string, model: string }>()
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
    const headers: Record<string, string> = {}
    if (!(init?.body instanceof FormData))
      headers['content-type'] = 'application/json'
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

  const fetchSystemConfigForAI = async () => {
    const data = await request<SystemConfigDTO>('/api/system-config', { method: 'GET' })
    const enabledModels = (Array.isArray(data?.models) ? data.models : [])
      .map(item => ({
        name: String(item?.name || '').trim(),
        label: String(item?.label || '').trim(),
        enabled: Boolean(item?.enabled),
      }))
      .filter(item => item.name && item.enabled)
    if (enabledModels.length === 0) {
      setAIModelOptions([{ label: 'GPT-4o mini', value: 'gpt-4o-mini' }])
      setAIDefaultModel('gpt-4o-mini')
      return 'gpt-4o-mini'
    }
    const options = enabledModels.map(item => ({ label: item.label || item.name, value: item.name }))
    const optionSet = new Set(options.map(item => item.value))
    const nextDefault = optionSet.has(String(data?.codeDefaultModel || '').trim())
      ? String(data?.codeDefaultModel || '').trim()
      : (optionSet.has(String(data?.defaultModel || '').trim()) ? String(data?.defaultModel || '').trim() : options[0].value)
    setAIModelOptions(options)
    setAIDefaultModel(nextDefault)
    return nextDefault
  }

  const uploadAIFile = async (file: File) => {
    console.info('[workflow-ai-generate] upload start', { name: file.name, size: file.size })
    const session = await request<UploadSessionDTO>('/api/files/sessions', {
      method: 'POST',
      body: JSON.stringify({ bizKey: `workflow_ai_generate_${Date.now()}` }),
    })
    const formData = new FormData()
    formData.append('file', file)
    const uploaded = await request<FileUploadResultDTO>(`/api/files/sessions/${session.id}/content`, {
      method: 'POST',
      body: formData,
    })
    const result = {
      fileId: Number(uploaded?.fileId || session.fileId || 0),
      versionNo: Number(uploaded?.versionNo || 0),
    }
    console.info('[workflow-ai-generate] upload success', result)
    return result
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

  const openAICreate = async () => {
    try {
      const nextDefault = await fetchSystemConfigForAI()
      const menuKey = selectedMenuKey || 'reserve'
      aiCreateForm.setFieldsValue({
        workflowKey: '',
        name: '',
        menuKey,
        description: '',
        model: nextDefault || aiDefaultModel || 'gpt-4o-mini',
      })
      setAIUploadFile(null)
      setAICreateOpen(true)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载模型配置失败')
    }
  }

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

  const submitAICreate = async () => {
    if (!aiUploadFile) {
      msgApi.warning('请先上传文件')
      return
    }
    try {
      const values = await aiCreateForm.validateFields()
      setAICreating(true)
      let fileRef: { fileId: number, versionNo: number }
      try {
        fileRef = await uploadAIFile(aiUploadFile)
      }
      catch (error) {
        console.warn('[workflow-ai-generate] upload failed', { message: error instanceof Error ? error.message : String(error) })
        throw error
      }
      if (fileRef.fileId <= 0 || fileRef.versionNo <= 0)
        throw new Error('文件上传失败')
      console.info('[workflow-ai-generate] ai-request start', { model: String(values.model || '').trim(), fileId: fileRef.fileId, versionNo: fileRef.versionNo })
      const generated = await request<WorkflowDSLGenerateResult>('/api/workflow/dsl-generate', {
        method: 'POST',
        body: JSON.stringify({
          model: String(values.model || '').trim(),
          description: String(values.description || '').trim(),
          fileId: fileRef.fileId,
          versionNo: fileRef.versionNo,
        }),
      })
      console.info('[workflow-ai-generate] ai-request success', { model: generated.model })
      const parsed = parseDifyWorkflowDSL(generated.generatedDsl as never)
      const issues = validateWorkflow(parsed.nodes, parsed.edges, parsed.workflowParameters ?? [])
      const errors = issues.filter(item => item.level === 'error')
      if (errors.length > 0) {
        const topErrors = errors.slice(0, 3).map(item => item.title).join('；')
        console.warn('[workflow-ai-generate] validate failed', { total: errors.length, titles: errors.slice(0, 10).map(item => item.title) })
        throw new Error(`AI 生成 DSL 校验失败：${topErrors}`)
      }
      console.info('[workflow-ai-generate] validate success')
      const created = await request<WorkflowDTO>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({
          workflowKey: String(values.workflowKey || '').trim(),
          name: String(values.name || '').trim(),
          description: `AI生成：${String(values.description || '').trim()}`,
          menuKey: values.menuKey || 'reserve',
          status: 'active',
          breakerWindowMinutes: 1,
          breakerMaxRequests: 5,
          dsl: generated.generatedDsl,
        }),
      })
      msgApi.success('AI 生成并创建成功')
      setAICreateOpen(false)
      setAIUploadFile(null)
      console.info('[workflow-ai-generate] create success', { workflowId: created.id })
      router.push(`/app/workflows/${created.id}`)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'AI 生成失败'
      console.warn('[workflow-ai-generate] process failed', { message })
      if (message === '未登录或登录已过期')
        return
      msgApi.error(error instanceof Error ? error.message : 'AI 生成失败')
    }
    finally {
      setAICreating(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="space-y-3">
        {contextHolder}
        <Form form={rollbackForm} style={{ display: 'none' }} />
        <Form form={aiCreateForm} style={{ display: 'none' }} />
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
        <Form form={aiCreateForm} style={{ display: 'none' }} />
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">请先登录后再访问工作流配置。</div>
      </div>
    )
  }

  if (currentRole !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <Form form={rollbackForm} style={{ display: 'none' }} />
        <Form form={aiCreateForm} style={{ display: 'none' }} />
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
          <Space>
            <Button onClick={openAICreate}>AI生成</Button>
            <Button type="primary" onClick={() => router.push('/app/workflows/new')}>新增工作流</Button>
          </Space>
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

      <Modal
        title="AI生成工作流"
        open={aiCreateOpen}
        onCancel={() => {
          setAICreateOpen(false)
          setAIUploadFile(null)
        }}
        onOk={submitAICreate}
        okText="生成并创建"
        cancelText="取消"
        confirmLoading={aiCreating}
        destroyOnHidden
      >
        <Form
          form={aiCreateForm}
          layout="vertical"
          initialValues={{
            workflowKey: '',
            name: '',
            menuKey: selectedMenuKey || 'reserve',
            description: '',
            model: aiDefaultModel,
          }}
        >
          <Form.Item
            label="Workflow Key"
            name="workflowKey"
            rules={[{ required: true, message: '请输入 workflowKey' }]}
          >
            <Input placeholder="例如 order_risk_ai" />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如 风险评估流程" />
          </Form.Item>
          <Form.Item
            label="上级菜单"
            name="menuKey"
            rules={[{ required: true, message: '请选择上级菜单' }]}
          >
            <Select
              options={[
                { label: '储备', value: 'reserve' },
                { label: '评审', value: 'review' },
                { label: '保后', value: 'postloan' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="AI模型"
            name="model"
            rules={[{ required: true, message: '请选择模型' }]}
          >
            <Select options={aiModelOptions} />
          </Form.Item>
          <Form.Item
            label="需求描述"
            name="description"
            rules={[{ required: true, message: '请输入需求描述' }]}
          >
            <Input.TextArea rows={4} placeholder="例如 根据附件内容生成审批流程" />
          </Form.Item>
          <Form.Item label="上传文件（必传）" required>
            <Upload
              showUploadList={false}
              multiple={false}
              beforeUpload={(file) => {
                if (file.size > MAX_UPLOAD_BYTES) {
                  msgApi.warning('文件不能超过 50MB')
                  return Upload.LIST_IGNORE
                }
                setAIUploadFile(file as File)
                return false
              }}
            >
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
            <div className="mt-2 text-xs text-gray-500">
              {aiUploadFile ? `已选择：${aiUploadFile.name}` : '暂未选择文件'}
            </div>
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
