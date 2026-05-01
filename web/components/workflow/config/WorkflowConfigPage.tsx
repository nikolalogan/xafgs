'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, InputNumber, Select, message } from 'antd'
import WorkflowCanvas from '../WorkflowCanvas'
import WorkflowEditorFrame from '../module/WorkflowEditorFrame'
import WorkflowModuleShell from '../module/WorkflowModuleShell'
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
  currentPublishedVersionNo: number
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

const menuOptions = [
  { label: '储备', value: 'reserve' },
  { label: '评审', value: 'review' },
  { label: '保后', value: 'postloan' },
]

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' },
]

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
  const [currentPublishedVersionNo, setCurrentPublishedVersionNo] = useState(0)
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
        menuKey: 'reserve',
        status: 'active',
        breakerWindowMinutes: 1,
        breakerMaxRequests: 5,
      })
      const dsl = parseDifyWorkflowDSL(defaultDSL)
      setInitialCanvasDSL(dsl)
      setEditedCanvasDSL(dsl)
      setCurrentPublishedVersionNo(0)
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
          menuKey: detail.menuKey || 'reserve',
          status: detail.status,
          breakerWindowMinutes: detail.breakerWindowMinutes || 1,
          breakerMaxRequests: detail.breakerMaxRequests || 5,
        })
        const dsl = parseDifyWorkflowDSL((detail.dsl as unknown as DifyWorkflowDSL) ?? defaultDSL)
        setInitialCanvasDSL(dsl)
        setEditedCanvasDSL(dsl)
        setCurrentPublishedVersionNo(Number(detail.currentPublishedVersionNo || 0))
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
            description: '',
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
          description: '',
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
    <WorkflowModuleShell
      title={isCreate ? '新建工作流' : '编辑工作流'}
      description="保留当前工作流 DSL 与运行接口，只替换工作流模块的编辑器页面组织方式。"
      actions={(
        <>
          <Button onClick={() => router.push('/app/workflows')}>返回列表</Button>
          <Button type="primary" loading={submitting} onClick={save}>保存</Button>
        </>
      )}
    >
      {contextHolder}
      <Form form={form} layout="vertical" disabled={loading}>
        <WorkflowEditorFrame
          header={(
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {isCreate ? 'Create Mode' : 'Edit Mode'}
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {isCreate ? '配置新的工作流骨架' : '维护现有工作流定义'}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Form.Item
                    label="Workflow Key"
                    name="workflowKey"
                    rules={[{ required: true, message: '请输入 workflowKey' }]}
                    className="mb-0"
                  >
                    <Input placeholder="例如：order_risk_check" disabled={!isCreate} />
                  </Form.Item>
                  <Form.Item
                    label="工作流名称"
                    name="name"
                    rules={[{ required: true, message: '请输入名称' }]}
                    className="mb-0"
                  >
                    <Input placeholder="请输入工作流名称" />
                  </Form.Item>
                  <Form.Item
                    label="上级菜单"
                    name="menuKey"
                    rules={[{ required: true, message: '请选择上级菜单' }]}
                    className="mb-0"
                  >
                    <Select options={menuOptions} />
                  </Form.Item>
                  <Form.Item
                    label="状态"
                    name="status"
                    rules={[{ required: true, message: '请选择状态' }]}
                    className="mb-0"
                  >
                    <Select options={statusOptions} />
                  </Form.Item>
                </div>
              </div>
              <div className="grid min-w-[260px] gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 xl:w-[320px] xl:grid-cols-1">
                <Form.Item label="熔断窗口（分钟）" name="breakerWindowMinutes" rules={[{ required: true, message: '请输入分钟' }]} className="mb-0">
                  <InputNumber min={1} precision={0} className="!w-full" placeholder="分钟" />
                </Form.Item>
                <Form.Item label="熔断阈值（次数）" name="breakerMaxRequests" rules={[{ required: true, message: '请输入次数' }]} className="mb-0">
                  <InputNumber min={1} precision={0} className="!w-full" placeholder="次数" />
                </Form.Item>
              </div>
            </div>
          )}
          canvas={(
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workflow Canvas</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">可视化编排</div>
                </div>
                <Button size="small" onClick={() => setShowAdvancedJSON(prev => !prev)}>
                  {showAdvancedJSON ? '收起高级 JSON' : '高级 JSON'}
                </Button>
              </div>
              <WorkflowCanvas
                ref={canvasRef}
                initialDSL={initialCanvasDSL}
                workflowId={workflowId}
                currentPublishedVersionNo={currentPublishedVersionNo}
                onDSLChange={showAdvancedJSON ? handleDSLChange : undefined}
              />
            </div>
          )}
          sidebar={showAdvancedJSON
            ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-slate-900">高级 JSON</div>
                  <Input.TextArea
                    value={advancedDSLText}
                    onChange={event => setAdvancedDSLText(event.target.value)}
                    rows={16}
                    placeholder="请输入 DSL JSON"
                  />
                  <div className="flex justify-end">
                    <Button size="small" onClick={applyAdvancedJSON}>应用到画布</Button>
                  </div>
                </div>
              )
            : undefined}
        />
      </Form>
    </WorkflowModuleShell>
  )
}
