'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Select, message } from 'antd'
import WorkflowCanvas from '../WorkflowCanvas'
import { parseDifyWorkflowDSL, toDifyWorkflowDSL } from '../dify/core/dsl'
import type { DifyWorkflowDSL } from '../dify/core/types'

type WorkflowStatus = 'active' | 'disabled'

type WorkflowDetailDTO = {
  id: number
  workflowKey: string
  name: string
  description: string
  status: WorkflowStatus
  dsl: Record<string, unknown>
}

type WorkflowDTO = {
  id: number
  workflowKey: string
  name: string
  description: string
  status: WorkflowStatus
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const defaultDSL = {
  nodes: [
    {
      id: 'start',
      type: 'custom',
      position: { x: 80, y: 200 },
      data: {
        title: '开始',
        type: 'start',
        config: { variables: [] },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

type WorkflowConfigPageProps = {
  workflowId?: number
}

export default function WorkflowConfigPage({ workflowId }: WorkflowConfigPageProps) {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [initialCanvasDSL, setInitialCanvasDSL] = useState<DifyWorkflowDSL>(parseDifyWorkflowDSL(defaultDSL))
  const [editedCanvasDSL, setEditedCanvasDSL] = useState<DifyWorkflowDSL>(parseDifyWorkflowDSL(defaultDSL))
  const [showAdvancedJSON, setShowAdvancedJSON] = useState(false)
  const [advancedDSLText, setAdvancedDSLText] = useState(toDifyWorkflowDSL(parseDifyWorkflowDSL(defaultDSL)))
  const [form] = Form.useForm()
  const [hydrated, setHydrated] = useState(false)
  const [currentRole, setCurrentRole] = useState<'admin' | 'user' | 'guest'>('guest')
  const isCreate = workflowId === undefined

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
      router.push('/login?redirect=/app/workflows')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  useEffect(() => {
    if (isCreate) {
      form.setFieldsValue({
        workflowKey: '',
        name: '',
        description: '',
        status: 'active',
      })
      const dsl = parseDifyWorkflowDSL(defaultDSL)
      setInitialCanvasDSL(dsl)
      setEditedCanvasDSL(dsl)
      setAdvancedDSLText(toDifyWorkflowDSL(dsl))
      return
    }

    const loadDetail = async () => {
      setLoading(true)
      try {
        const detail = await request<WorkflowDetailDTO>(`/api/workflows/${workflowId}`, { method: 'GET' })
        form.setFieldsValue({
          workflowKey: detail.workflowKey,
          name: detail.name,
          description: detail.description,
          status: detail.status,
        })
        const dsl = parseDifyWorkflowDSL(detail.dsl ?? defaultDSL)
        setInitialCanvasDSL(dsl)
        setEditedCanvasDSL(dsl)
        setAdvancedDSLText(toDifyWorkflowDSL(dsl))
      }
      catch (error) {
        msgApi.error(error instanceof Error ? error.message : '加载工作流失败')
      }
      finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [form, isCreate, msgApi, workflowId])

  const save = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const parsedDSL = editedCanvasDSL as Record<string, unknown>

      if (isCreate) {
        const created = await request<WorkflowDTO>('/api/workflows', {
          method: 'POST',
          body: JSON.stringify({
            workflowKey: values.workflowKey,
            name: values.name,
            description: values.description,
            status: values.status,
            dsl: parsedDSL,
          }),
        })
        msgApi.success('创建工作流成功')
        router.replace(`/app/workflows/${created.id}`)
        return
      }

      await request<WorkflowDTO>(`/api/workflows/${workflowId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          status: values.status,
          dsl: parsedDSL,
        }),
      })
      msgApi.success('保存工作流成功')
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('out of date'))
        return
      msgApi.error(error instanceof Error ? error.message : '保存失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  const applyAdvancedJSON = () => {
    try {
      const parsedDSL = parseDifyWorkflowDSL(advancedDSLText)
      setInitialCanvasDSL(parsedDSL)
      setEditedCanvasDSL(parsedDSL)
      setAdvancedDSLText(toDifyWorkflowDSL(parsedDSL))
      msgApi.success('已应用高级 JSON 配置')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '高级 JSON 格式错误')
    }
  }

  if (!hydrated) {
    return (
      <div className="space-y-3">
        {contextHolder}
        <Form form={form} style={{ display: 'none' }} />
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="text-sm text-gray-500">加载中...</div>
        </div>
      </div>
    )
  }

  if (currentRole === 'guest') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <Form form={form} style={{ display: 'none' }} />
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">请先登录后再访问工作流配置。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">
            {isCreate ? '新建工作流配置' : '编辑工作流配置'}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => router.push('/app/workflows')}>返回列表</Button>
            <Button type="primary" loading={submitting} onClick={save}>保存</Button>
          </div>
        </div>
        <Form form={form} layout="vertical" disabled={loading}>
          <Form.Item
            label="Workflow Key"
            name="workflowKey"
            rules={[{ required: true, message: '请输入 workflowKey' }]}
          >
            <Input placeholder="例如：order_risk_check" disabled={!isCreate} />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="请输入工作流名称" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="请输入工作流描述" />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select
              options={[
                { label: '启用', value: 'active' },
                { label: '停用', value: 'disabled' },
              ]}
            />
          </Form.Item>
        </Form>
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">可视化编排</div>
            <Button
              size="small"
              onClick={() => setShowAdvancedJSON(prev => !prev)}
            >
              {showAdvancedJSON ? '收起高级 JSON' : '高级 JSON'}
            </Button>
          </div>
          <WorkflowCanvas
            initialDSL={initialCanvasDSL}
            onDSLChange={(dsl) => {
              setEditedCanvasDSL(dsl)
              if (showAdvancedJSON)
                setAdvancedDSLText(toDifyWorkflowDSL(dsl))
            }}
          />
          {showAdvancedJSON && (
            <div className="mt-3 space-y-2">
              <Input.TextArea
                value={advancedDSLText}
                onChange={event => setAdvancedDSLText(event.target.value)}
                rows={12}
                placeholder="请输入 DSL JSON"
              />
              <div className="flex justify-end">
                <Button size="small" onClick={applyAdvancedJSON}>应用到画布</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
