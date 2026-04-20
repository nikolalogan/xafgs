'use client'

import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Input, Row, Select, Space, Switch, Tabs, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { CopyOutlined, DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import DOMPurify from 'dompurify'
import { isSingleUploadOversized, MAX_SINGLE_UPLOAD_TEXT } from '@/lib/upload-limit'

type LayoutParsingResponse = {
  logId?: string
  errorCode?: number
  errorMsg?: string
  result?: {
    layoutParsingResults?: Array<{
      prunedResult?: Record<string, unknown>
      markdown?: {
        text?: string
      }
    }>
  }
  modelMeta?: Record<string, unknown>
  metaExtensions?: Record<string, unknown>
}

type APIEnvelope<T> = {
  message?: string
  data?: T
}

type RequestOptions = {
  model: 'glm_ocr'
  fileType: 0 | 1
  visualize: boolean
  logId: string
  useTableRecognition: boolean
  useRegionDetection: boolean
  useFormulaRecognition: boolean
}

const DEFAULT_OPTIONS: RequestOptions = {
  model: 'glm_ocr',
  fileType: 0,
  visualize: false,
  logId: '',
  useTableRecognition: true,
  useRegionDetection: true,
  useFormulaRecognition: true,
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const base64 = raw.includes(',') ? raw.split(',')[1] || '' : raw
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const detectFileType = (file: File, base64: string): 0 | 1 => {
  const normalized = String(base64 || '').trim()
  if (!normalized) {
    return 0
  }
  try {
    const bytes = atob(normalized.slice(0, 120))
    if (bytes.startsWith('%PDF-')) {
      return 0
    }
  } catch {}
  const lowerName = String(file.name || '').toLowerCase()
  const lowerMime = String(file.type || '').toLowerCase()
  if (lowerMime.includes('application/pdf') || lowerName.endsWith('.pdf')) {
    return 0
  }
  return 1
}

const unwrapLayoutPayload = (value: unknown): LayoutParsingResponse => {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const payload = value as APIEnvelope<LayoutParsingResponse> & LayoutParsingResponse
  if (payload.data && typeof payload.data === 'object') {
    return payload.data
  }
  return payload
}

const getAccessToken = () => {
  if (typeof window === 'undefined') {
    return ''
  }
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

const renderMarkdownHTML = (markdown: string) => {
  const value = String(markdown || '').trim()
  if (!value) {
    return <Empty description="暂无 Markdown 结果" />
  }
  const safeHTML = DOMPurify.sanitize(value.includes('<') ? value : `<pre>${value}</pre>`)
  return <div className="ocr-rich-html text-sm leading-6" dangerouslySetInnerHTML={{ __html: safeHTML }} />
}

export default function OCRDemoV3Page() {
  const [msgApi, contextHolder] = message.useMessage()
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null)
  const [options, setOptions] = useState<RequestOptions>(DEFAULT_OPTIONS)
  const [submitting, setSubmitting] = useState(false)
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<LayoutParsingResponse | null>(null)

  const canSubmit = useMemo(() => !!uploadFile?.originFileObj && !submitting, [uploadFile, submitting])
  const layoutResults = useMemo(() => Array.isArray(result?.result?.layoutParsingResults) ? result?.result?.layoutParsingResults || [] : [], [result])
  const mergedMarkdown = useMemo(() => layoutResults.map(item => String(item?.markdown?.text || '').trim()).filter(Boolean).join('\n\n'), [layoutResults])

  const buildPayload = (base64: string, file: File) => {
    const payload: Record<string, unknown> = {
      model: options.model,
      file: base64,
      fileType: detectFileType(file, base64),
      visualize: options.visualize,
      useTableRecognition: options.useTableRecognition,
      useRegionDetection: options.useRegionDetection,
      useFormulaRecognition: options.useFormulaRecognition,
    }
    if (options.logId.trim()) {
      payload.logId = options.logId.trim()
    }
    return payload
  }

  const runParse = async () => {
    const file = uploadFile?.originFileObj
    if (!file) {
      msgApi.warning('请先上传文件')
      return
    }
    if (isSingleUploadOversized(file)) {
      msgApi.error(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
      return
    }
    setSubmitting(true)
    try {
      const base64 = await toBase64(file)
      const payload = buildPayload(base64, file)
      setLastRequest(payload)
      const token = getAccessToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const response = await fetch('/api/ocr/table-repair-preview', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const raw = await response.json() as unknown
      const parsed = unwrapLayoutPayload(raw)
      if (!response.ok) {
        throw new Error(parsed.errorMsg || `请求失败(${response.status})`)
      }
      setResult(parsed)
      if (Number(parsed.errorCode || 0) === 0) {
        msgApi.success('解析完成')
      } else {
        msgApi.warning(parsed.errorMsg || '解析返回错误')
      }
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '解析失败')
    } finally {
      setSubmitting(false)
    }
  }

  const copyRequest = async () => {
    if (!lastRequest) {
      msgApi.warning('暂无请求参数')
      return
    }
    try {
      await navigator.clipboard.writeText(pretty(lastRequest))
      msgApi.success('已复制请求参数')
    } catch {
      msgApi.error('复制失败')
    }
  }

  const downloadResponse = () => {
    if (!result) {
      msgApi.warning('暂无返回结果')
      return
    }
    const blob = new Blob([pretty(result)], { type: 'application/json;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `glm-ocr-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(href)
  }

  return (
    <Space direction="vertical" size={16} className="w-full">
      {contextHolder}
      <Alert
        type="info"
        showIcon
        message="GLM 文档解析官方在线演示（后端代理）"
        description="页面按官方 demo 流程重做：上传文件 -> 发起解析 -> 查看 Markdown/结构化结果/原始JSON。"
      />
      <Row gutter={16} align="top">
        <Col span={8}>
          <Card title="输入参数" extra={<Button icon={<ReloadOutlined />} onClick={() => setOptions(DEFAULT_OPTIONS)}>重置</Button>}>
            <Space direction="vertical" size={12} className="w-full">
              <Upload
                beforeUpload={() => false}
                maxCount={1}
                fileList={uploadFile ? [uploadFile] : []}
                onChange={({ fileList }) => setUploadFile(fileList[0] || null)}
              >
                <Button icon={<UploadOutlined />}>上传文件（PDF/图片）</Button>
              </Upload>
              <Select
                value={options.model}
                options={[{ label: 'glm_ocr', value: 'glm_ocr' }]}
                onChange={value => setOptions(prev => ({ ...prev, model: value as 'glm_ocr' }))}
              />
              <Input
                placeholder="可选：logId"
                value={options.logId}
                onChange={event => setOptions(prev => ({ ...prev, logId: event.target.value }))}
              />
              <Space>
                <Typography.Text>可视化</Typography.Text>
                <Switch checked={options.visualize} onChange={value => setOptions(prev => ({ ...prev, visualize: value }))} />
              </Space>
              <Space>
                <Typography.Text>表格识别</Typography.Text>
                <Switch checked={options.useTableRecognition} onChange={value => setOptions(prev => ({ ...prev, useTableRecognition: value }))} />
              </Space>
              <Space>
                <Typography.Text>版面检测</Typography.Text>
                <Switch checked={options.useRegionDetection} onChange={value => setOptions(prev => ({ ...prev, useRegionDetection: value }))} />
              </Space>
              <Space>
                <Typography.Text>公式识别</Typography.Text>
                <Switch checked={options.useFormulaRecognition} onChange={value => setOptions(prev => ({ ...prev, useFormulaRecognition: value }))} />
              </Space>
              <Space>
                <Button type="primary" onClick={runParse} loading={submitting} disabled={!canSubmit}>开始解析</Button>
                <Button icon={<CopyOutlined />} onClick={copyRequest}>复制请求</Button>
              </Space>
            </Space>
          </Card>
        </Col>
        <Col span={16}>
          <Card
            title="解析结果"
            extra={(
              <Space>
                <Button icon={<DownloadOutlined />} onClick={downloadResponse}>下载JSON</Button>
              </Space>
            )}
          >
            {!result
              ? (
                  <Empty description="请先上传文件并发起解析" />
                )
              : (
                  <Tabs
                    defaultActiveKey="markdown"
                    items={[
                      {
                        key: 'markdown',
                        label: 'Markdown',
                        children: renderMarkdownHTML(mergedMarkdown),
                      },
                      {
                        key: 'structured',
                        label: '结构化结果',
                        children: (
                          <Space direction="vertical" size={12} className="w-full">
                            <Typography.Text>logId: {result.logId || '-'}</Typography.Text>
                            <Typography.Text>errorCode: {String(result.errorCode ?? '-')}</Typography.Text>
                            <Typography.Text>errorMsg: {result.errorMsg || '-'}</Typography.Text>
                            <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{pretty(result.result?.layoutParsingResults || [])}</pre>
                            <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{pretty(result.modelMeta || {})}</pre>
                            <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{pretty(result.metaExtensions || {})}</pre>
                          </Space>
                        ),
                      },
                      {
                        key: 'raw',
                        label: '原始响应',
                        children: <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{pretty(result)}</pre>,
                      },
                    ]}
                  />
                )}
          </Card>
        </Col>
      </Row>
      <style jsx global>{`
        .ocr-rich-html table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #d9d9d9;
          margin: 8px 0;
        }
        .ocr-rich-html tr {
          border: 1px solid #d9d9d9;
        }
        .ocr-rich-html th,
        .ocr-rich-html td {
          border: 1px solid #d9d9d9;
          padding: 6px 8px;
          vertical-align: top;
        }
      `}</style>
    </Space>
  )
}
