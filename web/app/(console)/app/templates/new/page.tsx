'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Select, Space, message } from 'antd'
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

type PreviewResponse = {
  rendered: string
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

export default function TemplateNewPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [submitting, setSubmitting] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<{ outputType: TemplateOutputType, rendered: string } | null>(null)
  const [form] = Form.useForm()

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
	      router.push('/?redirect=/app/templates/new')
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

  const previewNow = async () => {
    try {
      const values = await form.validateFields()
      setPreviewLoading(true)
      const contextObject = parseContextJson(values.defaultContextJson || '')
      const result = await request<PreviewResponse>('/api/templates/preview', {
        method: 'POST',
        body: JSON.stringify({
          content: values.content || '',
          contextJson: contextObject,
        }),
      })
      setPreview({ outputType: values.outputType, rendered: result.rendered || '' })
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
      const created = await request<TemplateDTO>('/api/templates', {
        method: 'POST',
        body: JSON.stringify({
          templateKey: values.templateKey,
          name: values.name,
          description: values.description || '',
          engine: 'jinja2',
          outputType: values.outputType,
          status: values.status,
          content: values.content,
          defaultContextJson: contextObject,
        }),
      })
      msgApi.success('创建模板成功')
      router.push(`/app/templates/${created.id}/edit`)
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
          <div className="text-sm font-semibold text-gray-900">新增模板</div>
          <Space>
            <Button onClick={() => router.push('/app/templates')}>返回列表</Button>
            <Button onClick={previewNow} loading={previewLoading}>预览</Button>
            <Button type="primary" onClick={submit} loading={submitting}>保存</Button>
          </Space>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-4">
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                templateKey: '',
                name: '',
                description: '',
                outputType: 'html',
                status: 'active',
                content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{ title }}</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui; background: #0f172a; color: rgba(255,255,255,0.92); }
      .wrap { max-width: 920px; margin: 0 auto; padding: 24px 14px 40px; }
      .hero {
        padding: 18px 18px;
        border-radius: 18px;
        background: radial-gradient(900px 380px at 20% 10%, rgba(96,165,250,0.28), transparent 55%),
                    radial-gradient(740px 320px at 80% 20%, rgba(167,139,250,0.22), transparent 55%),
                    rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
      }
      .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; margin-top: 12px; }
      .card { grid-column: span 3; padding: 14px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
      .label { color: rgba(255,255,255,0.68); font-size: 12px; }
      .value { margin-top: 8px; font-size: 20px; font-weight: 700; }
      @media (max-width: 960px) { .card { grid-column: span 6; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hero">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px">
          <div>
            <div style="font-size:12px; color:rgba(255,255,255,0.68)">{{ brand }}</div>
            <div style="font-size:16px; font-weight:700; margin-top:6px">{{ subtitle }}</div>
            <div style="font-size:12px; color:rgba(255,255,255,0.52); margin-top:6px">{{ period.start }} - {{ period.end }}</div>
          </div>
          <div style="font-size:12px; color:rgba(255,255,255,0.68)">👤 {{ user.name }} · {{ user.roleLabel }}</div>
        </div>
      </div>

      <div class="grid">
        {% for kpi in kpis %}
          <div class="card">
            <div class="label">{{ kpi.label }}</div>
            <div class="value">{{ kpi.value }}</div>
            {% if kpi.trend == "up" %}
              <div style="margin-top:8px; color: rgba(34,197,94,0.95); font-size:12px">▲ {{ kpi.delta }}</div>
            {% else %}
              <div style="margin-top:8px; color: rgba(239,68,68,0.95); font-size:12px">▼ {{ kpi.delta }}</div>
            {% endif %}
          </div>
        {% endfor %}
      </div>
    </div>
  </body>
</html>`,
                defaultContextJson: `{
  "title": "周报概览",
  "brand": "SXFG 运营中心",
  "subtitle": "现代化模板示例（gonja / Jinja2 语法）",
  "period": { "start": "2026-03-24", "end": "2026-03-30" },
  "user": { "name": "默认管理员", "roleLabel": "管理员" },
  "kpis": [
    { "label": "活跃工作流", "value": "18", "delta": "+12%", "trend": "up" },
    { "label": "成功执行", "value": "3,482", "delta": "+6%", "trend": "up" },
    { "label": "失败率", "value": "0.42%", "delta": "-0.08%", "trend": "down" },
    { "label": "平均耗时", "value": "187ms", "delta": "-14ms", "trend": "down" }
  ]
}`,
              }}
            >
              <Form.Item name="templateKey" label="Template Key" rules={[{ required: true, message: '请输入 templateKey' }]}>
                <Input placeholder="如: order_notice_v1" />
              </Form.Item>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="模板名称" />
              </Form.Item>
              <Form.Item name="description" label="描述">
                <Input placeholder="可选" />
              </Form.Item>
              <div className="grid grid-cols-2 gap-3">
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
              <Form.Item name="content" label="模板内容" rules={[{ required: true, message: '请输入模板内容' }]}>
                <Input.TextArea autoSize={{ minRows: 10, maxRows: 24 }} placeholder="Jinja2 模板内容" />
              </Form.Item>
              <Form.Item name="defaultContextJson" label="默认 Context（JSON）">
                <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} placeholder='例如: {"name":"SXFG"}' />
              </Form.Item>
            </Form>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">预览</div>
              <div className="text-xs text-gray-500">后端渲染（gonja）</div>
            </div>
            {!preview && (
              <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                点击“预览”生成渲染结果
              </div>
            )}
            {preview?.outputType === 'html' && (
              <iframe
                title="template-preview"
                sandbox=""
                srcDoc={preview.rendered}
                className="h-[560px] w-full rounded-md border border-gray-200 bg-white"
              />
            )}
            {preview?.outputType === 'text' && (
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
