'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, InputNumber, Select, message } from 'antd'
import WorkflowCanvas from '../WorkflowCanvas'
import { parseDifyWorkflowDSL, toDifyWorkflowDSL } from '../dify/core/dsl'
import type { DifyWorkflowDSL } from '../dify/core/types'
import { BlockEnum } from '../dify/core/types'
import type { WorkflowCanvasHandle } from '../WorkflowCanvas'

type WorkflowStatus = 'active' | 'disabled'

type WorkflowDetailDTO = {
  id: number
  workflowKey: string
  name: string
  description: string
  menuKey: string
  status: WorkflowStatus
  breakerWindowMinutes: number
  breakerMaxRequests: number
  dsl: Record<string, unknown>
}

type WorkflowDTO = {
  id: number
  workflowKey: string
  name: string
  description: string
  menuKey: string
  status: WorkflowStatus
  breakerWindowMinutes: number
  breakerMaxRequests: number
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

const defaultDSL: DifyWorkflowDSL = {
  nodes: [
    {
      id: 'start',
      type: 'custom',
      position: { x: 80, y: 200 },
      data: {
        title: '开始',
        type: BlockEnum.Start,
        config: { variables: [] },
      },
    },
    {
      id: 'end',
      type: 'custom',
      position: { x: 420, y: 200 },
      data: {
        title: '结束',
        type: BlockEnum.End,
        config: { outputs: [{ name: 'result', source: '{{start}}' }] },
      },
    },
  ],
  edges: [
    { id: 'e-start-end', source: 'start', target: 'end', type: 'custom' },
  ],
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
  const canvasRef = useRef<WorkflowCanvasHandle | null>(null)
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
      router.push('/?redirect=/app/workflows')
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
        menuKey: 'reserve',
        status: 'active',
        breakerWindowMinutes: 1,
        breakerMaxRequests: 5,
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
          menuKey: detail.menuKey || 'reserve',
          status: detail.status,
          breakerWindowMinutes: detail.breakerWindowMinutes || 1,
          breakerMaxRequests: detail.breakerMaxRequests || 5,
        })
        const dsl = parseDifyWorkflowDSL((detail.dsl as unknown as DifyWorkflowDSL) ?? defaultDSL)
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
      canvasRef.current?.flushActiveNode()
      const values = await form.validateFields()
      setSubmitting(true)
      const latestDsl = canvasRef.current?.getDSL() ?? editedCanvasDSL
      const parsedDSL = latestDsl as Record<string, unknown>
      setEditedCanvasDSL(latestDsl)
      if (showAdvancedJSON)
        setAdvancedDSLText(toDifyWorkflowDSL(latestDsl))

      if (isCreate) {
        const created = await request<WorkflowDTO>('/api/workflows', {
          method: 'POST',
          body: JSON.stringify({
            workflowKey: values.workflowKey,
            name: values.name,
            description: values.description,
            menuKey: values.menuKey,
            status: values.status,
            breakerWindowMinutes: Number(values.breakerWindowMinutes),
            breakerMaxRequests: Number(values.breakerMaxRequests),
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
          menuKey: values.menuKey,
          status: values.status,
          breakerWindowMinutes: Number(values.breakerWindowMinutes),
          breakerMaxRequests: Number(values.breakerMaxRequests),
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

  const handleDSLChange = useCallback((dsl: DifyWorkflowDSL) => {
    if (!showAdvancedJSON)
      return
    setEditedCanvasDSL(dsl)
    setAdvancedDSLText(toDifyWorkflowDSL(dsl))
  }, [showAdvancedJSON])

  useEffect(() => {
    if (!showAdvancedJSON)
      return
    const latestDsl = canvasRef.current?.getDSL()
    if (!latestDsl)
      return
    setEditedCanvasDSL(latestDsl)
    setAdvancedDSLText(toDifyWorkflowDSL(latestDsl))
  }, [showAdvancedJSON])

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

  if (currentRole !== 'admin') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <Form form={form} style={{ display: 'none' }} />
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
          <Form.Item label="熔断频率" required>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">每</span>
              <Form.Item
                name="breakerWindowMinutes"
                noStyle
                rules={[{ required: true, message: '请输入分钟' }]}
              >
                <InputNumber min={1} precision={0} className="!w-[120px]" placeholder="分钟" />
              </Form.Item>
              <span className="text-sm text-gray-500">分钟</span>
              <Form.Item
                name="breakerMaxRequests"
                noStyle
                rules={[{ required: true, message: '请输入次数' }]}
              >
                <InputNumber min={1} precision={0} className="!w-[120px]" placeholder="次数" />
              </Form.Item>
              <span className="text-sm text-gray-500">次</span>
            </div>
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
            ref={canvasRef}
            initialDSL={initialCanvasDSL}
            workflowId={workflowId}
            onDSLChange={showAdvancedJSON ? handleDSLChange : undefined}
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
