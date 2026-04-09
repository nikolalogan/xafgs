'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Checkbox, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, message } from 'antd'
import { buildExternalRuleInputs, buildLocalRuleInputs, buildPreparedFields, evaluateDynamicFieldStates, evaluateDynamicFieldValidations, validateDynamicInput, type DynamicField, type DynamicFieldState } from '@/components/workflow/dify/core/dynamic-form-rules'

type ConsoleRole = 'admin' | 'user' | 'guest'
type ExecutionStatus = 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'

type WorkflowExecutionSummary = {
  id: string
  workflowId: number
  workflowName: string
  menuKey: string
  starterUserId: number
  status: ExecutionStatus
  waitingNodeId?: string
  waitingNodeTitle?: string
  error?: string
  createdAt: string
  updatedAt: string
}

type WorkflowExecution = {
  id: string
  workflowId: number
  workflowName: string
  menuKey: string
  starterUserId: number
  status: ExecutionStatus
  waitingInput?: {
    nodeId: string
    nodeTitle: string
    schema: Record<string, unknown>
  }
  workflowDsl?: {
    nodes?: Array<{
      data?: {
        type?: string
        config?: Record<string, unknown>
      }
    }>
  }
  variables?: Record<string, unknown>
  outputs?: Record<string, unknown>
  nodeStates: Record<string, { status: string }>
  error?: string
  createdAt: string
  updatedAt: string
}

type WorkflowTaskPage = {
  items: WorkflowExecutionSummary[]
  page: number
  pageSize: number
  total: number
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

type TemplateDetailDTO = {
  id: number
  name: string
  templateKey: string
  outputType: 'text' | 'html'
  content: string
}

type TemplatePreviewResponse = {
  rendered: string
}

const menuLabelMap: Record<string, string> = {
  reserve: '储备',
  review: '评审',
  postloan: '保后',
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const normalizeWaitingFields = (schema?: Record<string, unknown>): DynamicField[] => {
  if (!schema || !Array.isArray(schema.fields))
    return []
  return schema.fields.map((item) => {
    const entry = isObject(item) ? item : {}
    const normalizeOptions = (options: unknown) => {
      if (!Array.isArray(options))
        return [] as Array<{ label: string, value: string }>
      return options.map((option) => {
        if (typeof option === 'string')
          return { label: option, value: option }
        if (isObject(option)) {
          const value = typeof option.value === 'string' ? option.value : String(option.value ?? '')
          const label = typeof option.label === 'string' ? option.label : value
          return { label, value }
        }
        const value = String(option ?? '')
        return { label: value, value }
      }).filter(option => option.value)
    }
    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      label: typeof entry.label === 'string' ? entry.label : '',
      type: entry.type === 'paragraph'
        ? 'paragraph'
        : entry.type === 'number'
          ? 'number'
          : entry.type === 'select'
            ? 'select'
            : entry.type === 'checkbox'
              ? 'checkbox'
              : 'text',
      required: Boolean(entry.required),
      options: normalizeOptions(entry.options),
      defaultValue: entry.defaultValue,
      visibleWhen: typeof entry.visibleWhen === 'string' ? entry.visibleWhen : undefined,
      validateWhen: typeof entry.validateWhen === 'string' ? entry.validateWhen : undefined,
      placeholder: typeof entry.placeholder === 'string' ? entry.placeholder : undefined,
      multiSelect: Boolean(entry.multiSelect),
      min: typeof entry.min === 'number' ? entry.min : undefined,
      max: typeof entry.max === 'number' ? entry.max : undefined,
      step: typeof entry.step === 'number' ? entry.step : undefined,
    } satisfies DynamicField
  }).filter(field => field.name)
}

const renderStatus = (status: ExecutionStatus) => {
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-2 text-rose-600">
        <span aria-hidden="true">!</span>
        失败
      </span>
    )
  }
  if (status === 'waiting_input') {
    return (
      <span className="inline-flex items-center gap-2 text-blue-600">
        <span className="inline-block size-2 rounded-full bg-blue-500 animate-pulse" />
        等待输入
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-2 text-blue-600">
        <span className="inline-block size-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        执行中
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-2 text-emerald-600">
        <span aria-hidden="true">✓</span>
        已完成
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 text-gray-500">
      <span aria-hidden="true">-</span>
      已取消
    </span>
  )
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const ensureExportFileName = (raw: string) => {
  const value = String(raw || '').trim()
  if (!value)
    return 'output'
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 64)
}

const buildRenderedHtmlDocument = (rendered: { html: string, outputType: 'text' | 'html', templateName: string }) => {
  const title = ensureExportFileName(rendered.templateName || 'template')
  const body = rendered.outputType === 'text'
    ? `<pre style="white-space:pre-wrap; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace; margin: 0;">${escapeHtml(String(rendered.html ?? ''))}</pre>`
    : String(rendered.html ?? '')
  return {
    title,
    htmlDoc: `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body>${body}</body></html>`,
  }
}

const downloadBlob = (blob: Blob, filename: string) => {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(href)
}

export default function WorkflowTasksPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [role, setRole] = useState<ConsoleRole>('guest')
  const [hydrated, setHydrated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<WorkflowExecutionSummary[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [menuFilter, setMenuFilter] = useState<string>('')
  const [keyword, setKeyword] = useState('')

  const [resumeModalOpen, setResumeModalOpen] = useState(false)
  const [resultModalOpen, setResultModalOpen] = useState(false)
  const [selectedExecutionID, setSelectedExecutionID] = useState('')
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecution | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [resumeSubmitting, setResumeSubmitting] = useState(false)
  const [resultLoading, setResultLoading] = useState(false)

  const [waitingInput, setWaitingInput] = useState<Record<string, unknown>>({})
  const [templatePreview, setTemplatePreview] = useState<{ templateName: string, outputType: 'text' | 'html', html: string } | null>(null)
  const [templateError, setTemplateError] = useState('')

  useEffect(() => {
    const raw = (window.localStorage.getItem('sxfg_user_role') || window.localStorage.getItem('user_role') || 'guest').toLowerCase()
    if (raw === 'admin' || raw === 'user') {
      setRole(raw)
    }
    else {
      setRole('guest')
    }
    setHydrated(true)
  }, [])

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
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
      router.push('/?redirect=/app/workflow-tasks')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const fetchTasks = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(nextPage))
      params.set('pageSize', String(nextPageSize))
      if (statusFilter)
        params.set('status', statusFilter)
      if (menuFilter)
        params.set('menuKey', menuFilter)
      if (keyword.trim())
        params.set('keyword', keyword.trim())
      const data = await request<WorkflowTaskPage>(`/api/workflow/tasks?${params.toString()}`, { method: 'GET' })
      setTasks(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total || 0))
      setPage(Number(data?.page || nextPage))
      setPageSize(Number(data?.pageSize || nextPageSize))
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载任务失败')
    }
    finally {
      setLoading(false)
    }
  }

  const fetchTaskDetail = async (executionID: string) => {
    if (!executionID)
      return null
    setDetailLoading(true)
    try {
      const data = await request<WorkflowExecution>(`/api/workflow/tasks/${executionID}`, { method: 'GET' })
      setSelectedExecution(data)
      return data
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载任务详情失败')
      return null
    }
    finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    if (!hydrated || role === 'guest')
      return
    fetchTasks(1, pageSize)
  }, [hydrated, role, statusFilter, menuFilter])

  const waitingFields = useMemo(() => normalizeWaitingFields(selectedExecution?.waitingInput?.schema), [selectedExecution?.waitingInput?.schema])
  const waitingPreparedFields = useMemo(() => {
    if (!selectedExecution?.waitingInput?.nodeId)
      return []
    return buildPreparedFields(waitingFields, selectedExecution.waitingInput.nodeId)
  }, [selectedExecution?.waitingInput?.nodeId, waitingFields])
  const waitingExternalRuleInputs = useMemo(() => {
    return buildExternalRuleInputs(waitingPreparedFields, (selectedExecution?.variables ?? {}) as Record<string, unknown>)
  }, [selectedExecution?.variables, waitingPreparedFields])
  const waitingLocalRuleInputs = useMemo(() => {
    if (!selectedExecution?.waitingInput?.nodeId)
      return {}
    return buildLocalRuleInputs(selectedExecution.waitingInput.nodeId, waitingInput)
  }, [selectedExecution?.waitingInput?.nodeId, waitingInput])
  const waitingFieldStates = useMemo(() => {
    return evaluateDynamicFieldStates(waitingPreparedFields, {
      ...waitingExternalRuleInputs,
      ...waitingLocalRuleInputs,
    })
  }, [waitingExternalRuleInputs, waitingLocalRuleInputs, waitingPreparedFields])
  const waitingValidateErrors = useMemo(() => {
    const map = evaluateDynamicFieldValidations(waitingPreparedFields, {
      ...waitingExternalRuleInputs,
      ...waitingLocalRuleInputs,
    })
    const output: Record<string, string | null> = {}
    waitingPreparedFields.forEach((field) => {
      output[field.name] = map.get(field.name) ?? null
    })
    return output
  }, [waitingExternalRuleInputs, waitingLocalRuleInputs, waitingPreparedFields])

  const onOpenResume = async (item: WorkflowExecutionSummary) => {
    setSelectedExecutionID(item.id)
    setSelectedExecution(null)
    setWaitingInput({})
    setResumeModalOpen(true)
    const detail = await fetchTaskDetail(item.id)
    if (!detail?.waitingInput?.schema)
      return
    const normalizedFields = normalizeWaitingFields(detail.waitingInput.schema)
    const initialValues: Record<string, unknown> = {}
    normalizedFields.forEach((field) => {
      initialValues[field.name] = field.defaultValue ?? ''
    })
    setWaitingInput(initialValues)
  }

  const findEndTemplateID = (execution: WorkflowExecution) => {
    const nodes = Array.isArray(execution.workflowDsl?.nodes) ? execution.workflowDsl?.nodes : []
    for (const node of nodes || []) {
      const type = String(node?.data?.type || '').trim().toLowerCase()
      if (type !== 'end')
        continue
      const templateID = Number(node?.data?.config?.templateId ?? 0)
      if (Number.isFinite(templateID) && templateID > 0)
        return templateID
    }
    return 0
  }

  const renderTemplatePreviewIfNeeded = async (execution: WorkflowExecution) => {
    const templateID = findEndTemplateID(execution)
    if (templateID <= 0) {
      setTemplatePreview(null)
      setTemplateError('')
      return
    }
    try {
      const detail = await request<TemplateDetailDTO>(`/api/templates/${templateID}`, { method: 'GET' })
      const contextJson = isObject(execution.outputs) ? execution.outputs : { output: execution.outputs }
      const preview = await request<TemplatePreviewResponse>('/api/templates/preview', {
        method: 'POST',
        body: JSON.stringify({
          content: detail.content,
          contextJson,
        }),
      })
      setTemplatePreview({
        templateName: detail.name || detail.templateKey || String(detail.id),
        outputType: detail.outputType === 'text' ? 'text' : 'html',
        html: preview.rendered || '',
      })
      setTemplateError('')
    }
    catch (error) {
      setTemplatePreview(null)
      setTemplateError(error instanceof Error ? error.message : '模板渲染失败')
    }
  }

  const onOpenResult = async (item: WorkflowExecutionSummary) => {
    setSelectedExecutionID(item.id)
    setSelectedExecution(null)
    setTemplatePreview(null)
    setTemplateError('')
    setResultModalOpen(true)
    setResultLoading(true)
    const detail = await fetchTaskDetail(item.id)
    if (detail) {
      await renderTemplatePreviewIfNeeded(detail)
    }
    setResultLoading(false)
  }

  const onDownloadOutputJSON = () => {
    if (!selectedExecution)
      return
    const content = JSON.stringify(selectedExecution.outputs ?? {}, null, 2)
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const filename = `${ensureExportFileName(selectedExecution.workflowName || 'workflow')}-${selectedExecution.id}-output.json`
    downloadBlob(blob, filename)
  }

  const onDownloadExecutionSnapshotJSON = () => {
    if (!selectedExecution)
      return
    const snapshot = {
      id: selectedExecution.id,
      workflowId: selectedExecution.workflowId,
      workflowName: selectedExecution.workflowName,
      menuKey: selectedExecution.menuKey,
      starterUserId: selectedExecution.starterUserId,
      status: selectedExecution.status,
      waitingInput: selectedExecution.waitingInput ?? null,
      variables: selectedExecution.variables ?? {},
      outputs: selectedExecution.outputs ?? {},
      nodeStates: selectedExecution.nodeStates ?? {},
      error: selectedExecution.error ?? '',
      createdAt: selectedExecution.createdAt,
      updatedAt: selectedExecution.updatedAt,
      exportedAt: new Date().toISOString(),
    }
    const content = JSON.stringify(snapshot, null, 2)
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const filename = `${ensureExportFileName(selectedExecution.workflowName || 'workflow')}-${selectedExecution.id}-snapshot.json`
    downloadBlob(blob, filename)
  }

  const onDownloadTemplateHTML = () => {
    if (!templatePreview)
      return
    const { title, htmlDoc } = buildRenderedHtmlDocument(templatePreview)
    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' })
    downloadBlob(blob, `${title}.html`)
  }

  const onDownloadTemplatePDF = async () => {
    if (!templatePreview)
      return
    try {
      const [{ jsPDF }, html2canvasModule] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ])
      const html2canvas = html2canvasModule.default
      const { title, htmlDoc } = buildRenderedHtmlDocument(templatePreview)

      const sandbox = document.createElement('iframe')
      sandbox.style.position = 'fixed'
      sandbox.style.left = '-100000px'
      sandbox.style.top = '0'
      sandbox.style.width = '1200px'
      sandbox.style.height = '800px'
      sandbox.style.opacity = '0'
      sandbox.srcdoc = htmlDoc
      document.body.appendChild(sandbox)

      await new Promise<void>((resolve, reject) => {
        sandbox.onload = () => resolve()
        sandbox.onerror = () => reject(new Error('渲染失败'))
      })

      const target = sandbox.contentDocument?.body
      if (!target) {
        document.body.removeChild(sandbox)
        throw new Error('PDF 渲染失败')
      }

      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      })
      const pageWidth = 595.28
      const pageHeight = 841.89
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
      const imgWidth = pageWidth
      const imgHeight = canvas.height * (imgWidth / canvas.width)
      let remainHeight = imgHeight
      let position = 0
      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      remainHeight -= pageHeight
      while (remainHeight > 0) {
        position = remainHeight - imgHeight
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        remainHeight -= pageHeight
      }
      pdf.save(`${title}.pdf`)
      document.body.removeChild(sandbox)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '导出 PDF 失败')
    }
  }

  const onResume = async () => {
    if (!selectedExecution?.waitingInput?.nodeId || !selectedExecutionID)
      return
    const validation = validateDynamicInput(waitingFields, waitingInput, waitingFieldStates, waitingValidateErrors)
    if (!validation.ok) {
      msgApi.error(validation.message || '输入校验失败')
      return
    }

    try {
      setResumeSubmitting(true)
      await request(`/api/workflow/tasks/${selectedExecutionID}/resume`, {
        method: 'POST',
        body: JSON.stringify({
          nodeId: selectedExecution.waitingInput.nodeId,
          input: validation.normalized,
        }),
      })
      msgApi.success('提交成功，任务继续执行')
      setResumeModalOpen(false)
      await fetchTasks(page, pageSize)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '提交失败')
    }
    finally {
      setResumeSubmitting(false)
    }
  }

  const onCancelRunning = async (executionID: string) => {
    if (!executionID)
      return
    try {
      await request(`/api/workflow/executions/${executionID}`, {
        method: 'DELETE',
      })
      msgApi.success('任务已终止')
      await fetchTasks(page, pageSize)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '终止任务失败')
    }
  }

  if (!hydrated) {
    return <div className="text-sm text-gray-500">加载中...</div>
  }

  if (role === 'guest') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">请先登录后再查看任务中心。</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <Space wrap>
          <Select
            style={{ width: 160 }}
            placeholder="状态"
            allowClear
            value={statusFilter || undefined}
            onChange={(value) => {
              setStatusFilter(value || '')
              setPage(1)
            }}
            options={[
              { label: '执行中', value: 'running' },
              { label: '等待输入', value: 'waiting_input' },
              { label: '已完成', value: 'completed' },
              { label: '失败', value: 'failed' },
              { label: '已取消', value: 'cancelled' },
            ]}
          />
          <Select
            style={{ width: 140 }}
            placeholder="职能菜单"
            allowClear
            value={menuFilter || undefined}
            onChange={(value) => {
              setMenuFilter(value || '')
              setPage(1)
            }}
            options={[
              { label: '储备', value: 'reserve' },
              { label: '评审', value: 'review' },
              { label: '保后', value: 'postloan' },
            ]}
          />
          <Input
            style={{ width: 260 }}
            placeholder="搜索流程名或任务ID"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            onPressEnter={() => fetchTasks(1, pageSize)}
          />
          <Button type="primary" onClick={() => fetchTasks(1, pageSize)}>查询</Button>
        </Space>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <Table<WorkflowExecutionSummary>
          rowKey="id"
          loading={loading}
          dataSource={tasks}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
          }}
          onChange={(pagination) => {
            const nextPage = Number(pagination.current || 1)
            const nextPageSize = Number(pagination.pageSize || 20)
            fetchTasks(nextPage, nextPageSize)
          }}
          columns={[
            { title: '任务ID', dataIndex: 'id', width: 220, ellipsis: true },
            { title: '流程名称', dataIndex: 'workflowName', width: 180, ellipsis: true },
            {
              title: '职能',
              dataIndex: 'menuKey',
              width: 100,
              render: value => menuLabelMap[String(value || '')] || '-',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 150,
              render: value => renderStatus(value as ExecutionStatus),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 180,
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 180,
            },
            {
              title: '操作',
              dataIndex: 'operation',
              width: 220,
              render: (_value, record) => {
                if (record.status === 'running')
                  return (
                    <Popconfirm
                      title="确认终止该任务？"
                      description="终止后当前执行将结束。"
                      okText="终止"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onCancelRunning(record.id)}
                    >
                      <Button size="small" danger>终止</Button>
                    </Popconfirm>
                  )
                if (record.status === 'waiting_input')
                  return <Button size="small" type="primary" onClick={() => onOpenResume(record)}>补充数据</Button>
                if (record.status === 'completed' || record.status === 'failed')
                  return <Button size="small" onClick={() => onOpenResult(record)}>输出结果</Button>
                return <span className="text-gray-400">-</span>
              },
            },
          ]}
        />
      </div>

      <Modal
        title="补充数据并继续"
        width={760}
        open={resumeModalOpen}
        onCancel={() => {
          setResumeModalOpen(false)
          setSelectedExecutionID('')
          setSelectedExecution(null)
          setWaitingInput({})
        }}
        onOk={onResume}
        confirmLoading={resumeSubmitting}
        okText="提交并继续"
      >
        {detailLoading && <div className="text-sm text-gray-500">加载中...</div>}
        {!detailLoading && selectedExecution?.status === 'waiting_input' && selectedExecution.waitingInput && (
          <div className="space-y-3">
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              待补充节点：{selectedExecution.waitingInput.nodeTitle || selectedExecution.waitingInput.nodeId}
            </div>
            {!!resumeSubmitting && (
              <div className="rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                正在提交当前输入并继续执行，请稍候。
              </div>
            )}
            {waitingFieldStates.filter(item => item.visible).length === 0 && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该节点暂无可填写字段" />
            )}
            <DynamicForm fieldStates={waitingFieldStates} values={waitingInput} onChange={setWaitingInput} />
          </div>
        )}
        {!detailLoading && selectedExecution?.status !== 'waiting_input' && (
          <div className="text-sm text-gray-500">当前任务已不处于等待输入状态，请刷新列表后重试。</div>
        )}
      </Modal>

      <Modal
        title="输出结果"
        width={960}
        open={resultModalOpen}
        onCancel={() => {
          setResultModalOpen(false)
          setSelectedExecutionID('')
          setSelectedExecution(null)
          setTemplatePreview(null)
          setTemplateError('')
        }}
        footer={null}
      >
        {(detailLoading || resultLoading) && <div className="text-sm text-gray-500">加载中...</div>}
        {!detailLoading && !resultLoading && selectedExecution && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>任务ID：{selectedExecution.id}</div>
              <div>流程：{selectedExecution.workflowName || '-'}</div>
              <div>状态：{renderStatus(selectedExecution.status)}</div>
              <div>更新时间：{selectedExecution.updatedAt}</div>
            </div>

            {(templatePreview || templateError) && (
              <div className="rounded border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">模板预览</div>
                  {templatePreview && (
                    <Space>
                      <Button size="small" onClick={onDownloadTemplateHTML}>导出 HTML</Button>
                      <Button size="small" onClick={onDownloadTemplatePDF}>导出 PDF</Button>
                    </Space>
                  )}
                </div>
                {templateError && <div className="mb-2 text-sm text-rose-600">{templateError}</div>}
                {templatePreview && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">模板：{templatePreview.templateName}</div>
                    {templatePreview.outputType === 'html'
                      ? (
                          <iframe
                            title="execution-template-preview"
                            className="h-[520px] w-full rounded border border-gray-200 bg-white"
                            srcDoc={templatePreview.html}
                          />
                        )
                      : (
                          <pre className="max-h-72 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">{templatePreview.html}</pre>
                        )}
                  </div>
                )}
              </div>
            )}

            <div className="rounded border border-gray-200 p-3">
              <div className="mb-2 text-sm font-semibold text-gray-900">输出结果</div>
              <Space>
                <Button size="small" onClick={onDownloadOutputJSON}>下载输出结果</Button>
                <Button size="small" onClick={onDownloadExecutionSnapshotJSON}>下载执行快照</Button>
              </Space>
            </div>

            <div className="rounded border border-gray-200 p-3">
              <div className="mb-2 text-sm font-semibold text-gray-900">报错信息</div>
              {selectedExecution.error
                ? <div className="text-sm text-rose-600">{selectedExecution.error}</div>
                : <div className="text-sm text-gray-500">无</div>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function DynamicForm({
  fields,
  fieldStates,
  values,
  onChange,
}: {
  fields?: DynamicField[]
  fieldStates?: DynamicFieldState[]
  values: Record<string, unknown>
  onChange: (nextValues: Record<string, unknown>) => void
}) {
  const normalizedStates = fieldStates ?? (fields ?? []).map(item => ({
    item,
    visible: true,
    visibleError: null,
    validateError: null,
  }))
  const visibleStates = normalizedStates.filter(state => state.visible)

  if (!visibleStates.length)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无可配置字段" />

  const [form] = Form.useForm()
  useEffect(() => {
    form.setFieldsValue(values)
  }, [form, values])

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      onValuesChange={(_changed, allValues) => onChange(allValues)}
      className="m-0"
    >
      {visibleStates.map((state) => {
        const field = state.item
        const label = `${field.label || field.name}${field.required ? ' *' : ''}`
        const help = state.visibleError || state.validateError || undefined
        const validateStatus = help ? 'error' : undefined
        if (field.type === 'checkbox') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} valuePropName="checked" help={help} validateStatus={validateStatus}>
              <Checkbox>勾选</Checkbox>
            </Form.Item>
          )
        }
        if (field.type === 'paragraph') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
            </Form.Item>
          )
        }
        if (field.type === 'number') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          )
        }
        if (field.type === 'select') {
          return (
            <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
              <Select
                allowClear
                mode={field.multiSelect ? 'multiple' : undefined}
                placeholder="请选择"
                options={field.options.map(option => ({
                  label: option.label || option.value,
                  value: option.value,
                }))}
              />
            </Form.Item>
          )
        }
        return (
          <Form.Item key={field.name} name={field.name} label={label} help={help} validateStatus={validateStatus}>
            <Input />
          </Form.Item>
        )
      })}
    </Form>
  )
}
