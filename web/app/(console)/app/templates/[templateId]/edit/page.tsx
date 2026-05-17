'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Form, Input, Select, Space, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'
import UniverTableEditor, { type UniverTableEditorRef } from '@/components/enterprise-projects/UniverTableEditor'
import UniverTablePreview from '@/components/enterprise-projects/UniverTablePreview'
import {
  createDefaultTemplateWorkbookContent,
  parseTemplateWorkbookContent,
  renderWorkbookPlaceholders,
  serializeTemplateWorkbookContent,
  type TemplateWorkbookContent,
} from '@/lib/table-template-workbook'

type TemplateStatus = 'active' | 'disabled'
type TemplateOutputType = 'text' | 'html'
type TemplateType = 'gonja' | 'table'

type TemplateDetailDTO = {
  id: number
  templateKey: string
  name: string
  description: string
  engine: string
  outputType: TemplateOutputType
  status: TemplateStatus
  templateType: TemplateType
  content: string
  tableContent?: string
  defaultContextJson: unknown
  createdAt: string
  updatedAt: string
}

type TemplateDTO = {
  id: number
  templateKey: string
  name: string
  description: string
  engine: string
  outputType: TemplateOutputType
  status: TemplateStatus
  templateType: TemplateType
  createdAt: string
  updatedAt: string
}

type PreviewResponse = {
  previewType?: TemplateType
  rendered: string
  tablePayload?: unknown
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

export default function TemplateEditPage() {
  const router = useRouter()
  const routeParams = useParams<{ templateId: string }>()
  const templateIDValue = Number(routeParams.templateId)
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<{ outputType: TemplateOutputType, previewType: TemplateType, rendered: string, tableHtml: string } | null>(null)
  const [tableEditorValue, setTableEditorValue] = useState<TemplateWorkbookContent>(createDefaultTemplateWorkbookContent())
  const [tablePreviewWorkbook, setTablePreviewWorkbook] = useState<Record<string, unknown> | null>(null)
  const [tableCompatError, setTableCompatError] = useState('')
  const tableEditorRef = useState<{ current: UniverTableEditorRef | null }>({ current: null })[0]
  const [gonjaContent, setGonjaContent] = useState('')
  const [tableContentRaw, setTableContentRaw] = useState('')
  const [form] = Form.useForm()
  const templateType = Form.useWatch('templateType', form)
  const contentValue = Form.useWatch('content', form)
  const tableContentValue = Form.useWatch('tableContent', form)

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
      router.push(`/?redirect=/app/templates/${routeParams.templateId}/edit`)
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问（仅管理员可用）')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  const parseContextJson = (raw: string) => {
    const trimmed = (raw || '').trim()
    if (!trimmed)
      return {}
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('defaultContextJson 必须为 JSON object')
    return parsed as Record<string, unknown>
  }

  const fetchDetail = async () => {
    if (!Number.isFinite(templateIDValue) || templateIDValue <= 0) {
      msgApi.error('templateId 不合法')
      return
    }
    setLoading(true)
    try {
      const template = await request<TemplateDetailDTO>(`/api/templates/${templateIDValue}`, { method: 'GET' })
      const contextText = template.defaultContextJson
        ? JSON.stringify(template.defaultContextJson, null, 2)
        : '{}'
      form.setFieldsValue({
        templateKey: template.templateKey,
        name: template.name,
        description: template.description || '',
        outputType: template.outputType,
        status: template.status,
        templateType: template.templateType || 'gonja',
        content: template.content || '',
        tableContent: template.tableContent || '',
        defaultContextJson: contextText,
      })
      setPreview(null)
      setTablePreviewWorkbook(null)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载模板失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [])

  useEffect(() => {
    if (templateType === 'gonja')
      setGonjaContent(String(contentValue || ''))
    if (templateType === 'table')
      setTableContentRaw(String(tableContentValue || ''))
  }, [contentValue, tableContentValue, templateType])

  useEffect(() => {
    if (templateType === 'gonja')
      form.setFieldValue('content', gonjaContent)
    if (templateType === 'table')
      form.setFieldValue('tableContent', tableContentRaw)
  }, [form, gonjaContent, tableContentRaw, templateType])

  useEffect(() => {
    if (templateType !== 'table')
      return
    const parsed = parseTemplateWorkbookContent(tableContentValue)
    if (!String(tableContentValue || '').trim()) {
      const initial = createDefaultTemplateWorkbookContent()
      setTableEditorValue(initial)
      form.setFieldValue('tableContent', serializeTemplateWorkbookContent(initial))
      setTableCompatError('')
      return
    }
    if (!parsed.ok) {
      setTableCompatError(parsed.error)
      return
    }
    setTableCompatError('')
    setTableEditorValue(parsed.value)
  }, [form, tableContentValue, templateType])

  const previewNow = async () => {
    try {
      const values = await form.validateFields()
      setPreviewLoading(true)
      const mappedContext = parseContextJson(values.defaultContextJson || '')
      if (values.templateType === 'table') {
        const snapshot = tableEditorRef.current?.getWorkbookSnapshot()
        if (!snapshot)
          throw new Error('无法获取当前表格内容，请刷新页面重试')
        const tablePayload: TemplateWorkbookContent = { version: 1, workbook: snapshot }
        form.setFieldValue('tableContent', serializeTemplateWorkbookContent(tablePayload))
        setTablePreviewWorkbook(renderWorkbookPlaceholders(tablePayload.workbook, mappedContext))
        setPreview({
          outputType: values.outputType,
          previewType: 'table',
          rendered: '',
          tableHtml: '',
        })
      } else {
        const result = await request<PreviewResponse>('/api/templates/preview', {
          method: 'POST',
          body: JSON.stringify({
            content: values.content || '',
            contextJson: mappedContext,
            templateType: values.templateType,
          }),
        })
        setPreview({
          outputType: values.outputType,
          previewType: 'gonja',
          rendered: result.rendered || '',
          tableHtml: '',
        })
      }
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('out of date'))
        return
      msgApi.error(error instanceof Error ? error.message : '预览失败')
    }
    finally {
      setPreviewLoading(false)
    }
  }

  const submit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const contextObject = parseContextJson(values.defaultContextJson || '')
      const updated = await request<TemplateDTO>(`/api/templates/${templateIDValue}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: values.name,
          description: values.description || '',
          outputType: values.outputType,
          status: values.status,
          content: values.templateType === 'table' ? '' : values.content,
          tableContent: values.templateType === 'table'
            ? serializeTemplateWorkbookContent({
                version: 1,
                workbook: tableEditorRef.current?.getWorkbookSnapshot() || tableEditorValue.workbook,
              })
            : '',
          defaultContextJson: contextObject,
          templateType: values.templateType,
        }),
      })
      msgApi.success('更新模板成功')
      form.setFieldsValue({
        name: updated.name,
        description: updated.description || '',
        outputType: updated.outputType,
        status: updated.status,
        templateType: updated.templateType,
      })
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('out of date'))
        return
      msgApi.error(error instanceof Error ? error.message : '提交失败')
    }
    finally {
      setSubmitting(false)
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
            <div className="text-sm font-semibold text-gray-900">编辑模板</div>
          <Space>
            <Button onClick={() => router.push('/app/templates')}>返回列表</Button>
            <Button onClick={previewNow} loading={previewLoading}>预览</Button>
            <Button type="primary" onClick={submit} loading={submitting} disabled={loading}>保存</Button>
          </Space>
          </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-4">
            <Form form={form} layout="vertical" disabled={loading}>
              <Form.Item name="templateKey" label="Template Key">
                <Input disabled />
              </Form.Item>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="模板名称" />
              </Form.Item>
              <Form.Item name="description" label="描述">
                <Input placeholder="可选" />
              </Form.Item>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Form.Item name="templateType" label="模板类型" rules={[{ required: true, message: '请选择模板类型' }]}>
                  <Select
                    options={[
                      { value: 'gonja', label: 'Gonja 模板' },
                      { value: 'table', label: '表格' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="outputType" label="输出类型" rules={[{ required: true, message: '请选择输出类型' }]}>
                  <Select
                    options={[
                      { value: 'html', label: 'HTML' },
                      { value: 'text', label: '文本' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
                  <Select
                    options={[
                      { value: 'active', label: '启用' },
                      { value: 'disabled', label: '停用' },
                    ]}
                  />
                </Form.Item>
              </div>
              {templateType === 'table'
                ? <Form.Item name="tableContent" hidden rules={[{ required: true, message: '请输入模板内容' }]}><Input /></Form.Item>
                : (
                    <Form.Item name="content" label="模板内容" rules={[{ required: true, message: '请输入模板内容' }]}>
                      <Input.TextArea autoSize={{ minRows: 10, maxRows: 24 }} placeholder="Jinja2 模板内容" />
                    </Form.Item>
                  )}
              <Form.Item name="defaultContextJson" label="默认 Context（JSON）">
                <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} placeholder='例如: {"name":"SXFG"}' />
              </Form.Item>
              {templateType === 'table' && (
                <div className="space-y-2">
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                    <div className="mb-2 text-xs font-medium text-gray-700">表格模板编辑（Univer）</div>
                    {!tableCompatError && (
                      <UniverTableEditor
                        ref={(instance) => {
                          tableEditorRef.current = instance
                        }}
                        workbook={tableEditorValue.workbook}
                      />
                    )}
                    {tableCompatError && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                        当前历史 content 无法解析为 Univer Workbook JSON：{tableCompatError}
                        <div className="mt-2">
                          <Button
                            size="small"
                            onClick={() => {
                              const rebuilt = createDefaultTemplateWorkbookContent()
                              setTableEditorValue(rebuilt)
                              form.setFieldValue('tableContent', serializeTemplateWorkbookContent(rebuilt))
                              setTableCompatError('')
                            }}
                          >
                            重建为新表格
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Form>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            {templateType === 'table' && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">表格预览</div>
                  <div className="text-xs text-gray-500">可编辑 Univer（模板 + 占位符替换）</div>
                </div>
                {!tablePreviewWorkbook && (
                  <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                    点击“预览”生成数据
                  </div>
                )}
                {tablePreviewWorkbook && <UniverTablePreview workbook={tablePreviewWorkbook} />}
              </>
            )}
            {templateType !== 'table' && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">预览</div>
                  <div className="text-xs text-gray-500">后端渲染（gonja）</div>
                </div>
                {!preview && (
                  <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                    点击“预览”生成渲染结果
                  </div>
                )}
              </>
            )}
            {templateType !== 'table' && preview?.previewType === 'gonja' && preview?.outputType === 'html' && (
              <iframe
                title="template-preview"
                sandbox=""
                srcDoc={preview.rendered}
                className="h-[560px] w-full rounded-md border border-gray-200 bg-white"
              />
            )}
            {templateType !== 'table' && preview?.previewType === 'gonja' && preview?.outputType === 'text' && (
              <pre className="h-[560px] w-full overflow-auto rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-800">
                {preview.rendered}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

