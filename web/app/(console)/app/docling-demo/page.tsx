'use client'

import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Tabs, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { CopyOutlined, DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { isSingleUploadOversized, MAX_SINGLE_UPLOAD_TEXT } from '@/lib/upload-limit'

type ParseEngine = 'docling' | 'glm_ocr'

type ConvertResponse = {
  filename?: string
  durationMs?: number
  markdown?: string
  text?: string
  document?: Record<string, unknown>
  imageOcrApplied?: boolean
  imageOcrCount?: number
  imageOcrSkippedCount?: number
}

type GLMOCRResponse = {
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

type ParseResult = {
  engine: ParseEngine
  data: ConvertResponse | GLMOCRResponse
}

type APIEnvelope<T> = {
  message?: string
  data?: T
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

const isImageFile = (file: File) => {
  const lowerName = String(file.name || '').toLowerCase()
  const lowerMime = String(file.type || '').toLowerCase()
  return lowerMime.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/.test(lowerName)
}

const detectOCRFileType = (file: File, base64: string): 0 | 1 => {
  const normalized = String(base64 || '').trim()
  if (normalized) {
    try {
      const bytes = atob(normalized.slice(0, 120))
      if (bytes.startsWith('%PDF-')) {
        return 0
      }
    } catch {}
  }
  const lowerName = String(file.name || '').toLowerCase()
  const lowerMime = String(file.type || '').toLowerCase()
  if (lowerMime.includes('application/pdf') || lowerName.endsWith('.pdf')) {
    return 0
  }
  return 1
}

const unwrapOCRPayload = (value: unknown): GLMOCRResponse => {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const payload = value as APIEnvelope<GLMOCRResponse> & GLMOCRResponse
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

export default function DoclingDemoPage() {
  const [msgApi, contextHolder] = message.useMessage()
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null)
  const [engine, setEngine] = useState<ParseEngine>('docling')
  const [submitting, setSubmitting] = useState(false)
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)

  const canSubmit = useMemo(() => !!uploadFile?.originFileObj && !submitting, [uploadFile, submitting])
  const ocrMarkdown = useMemo(() => {
    if (result?.engine !== 'glm_ocr') {
      return ''
    }
    const data = result.data as GLMOCRResponse
    const layoutResults = Array.isArray(data.result?.layoutParsingResults) ? data.result?.layoutParsingResults || [] : []
    return layoutResults.map(item => String(item?.markdown?.text || '').trim()).filter(Boolean).join('\n\n')
  }, [result])

  const runConvert = async () => {
    const file = uploadFile?.originFileObj
    if (!file) {
      msgApi.warning('请先上传文件')
      return
    }
    if (isSingleUploadOversized(file)) {
      msgApi.error(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
      return
    }
    if (engine === 'docling' && isImageFile(file)) {
      msgApi.warning('图片文件请使用 GLM OCR')
      return
    }

    setSubmitting(true)
    try {
      const base64 = await toBase64(file)
      if (engine === 'glm_ocr') {
        const payload = {
          model: 'glm_ocr',
          file: base64,
          fileType: detectOCRFileType(file, base64),
          visualize: false,
          useTableRecognition: true,
          useRegionDetection: true,
          useFormulaRecognition: true,
        }
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
        const parsed = unwrapOCRPayload(raw)
        if (!response.ok) {
          throw new Error(parsed.errorMsg || `请求失败(${response.status})`)
        }
        setResult({ engine, data: parsed })
        msgApi.success('GLM OCR 解析完成')
        return
      }

      const payload = {
        file: base64,
        filename: file.name,
      }
      setLastRequest(payload)
      const response = await fetch('/docling/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const raw = await response.json() as ConvertResponse & { detail?: string }
      if (!response.ok) {
        throw new Error(raw.detail || `请求失败(${response.status})`)
      }
      setResult({ engine, data: raw })
      msgApi.success('Docling 转换完成')
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '处理失败')
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
    const blob = new Blob([pretty(result.data)], { type: 'application/json;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `docling-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(href)
  }

  return (
    <Space orientation="vertical" size={16} className="w-full">
      {contextHolder}
      <Alert
        type="info"
        showIcon
        title="Docling 文档转换示例"
        description="Docling 默认使用离线文本层转换，并将文档内图片区域的 GLM OCR 结果按接近 Docling 的 Markdown 块结构原位写回正文；纯图片文件或扫描 PDF 仍建议切换 GLM OCR。"
      />

      <Row gutter={16} align="top">
        <Col span={8}>
          <Card title="输入参数" extra={<Button icon={<ReloadOutlined />} onClick={() => { setUploadFile(null); setResult(null); setLastRequest(null) }}>重置</Button>}>
            <Space orientation="vertical" size={12} className="w-full">
              <Upload
                beforeUpload={() => false}
                maxCount={1}
                fileList={uploadFile ? [uploadFile] : []}
                onChange={({ fileList }) => {
                  const nextFile = fileList[0] || null
                  setUploadFile(nextFile)
                  if (nextFile?.originFileObj && isImageFile(nextFile.originFileObj)) {
                    setEngine('glm_ocr')
                  }
                }}
              >
                <Button icon={<UploadOutlined />}>上传文件</Button>
              </Upload>
              <Select
                value={engine}
                options={[
                  { label: 'Docling 文本层', value: 'docling' },
                  { label: 'GLM OCR', value: 'glm_ocr' },
                ]}
                onChange={value => setEngine(value)}
              />
              <Typography.Text type="secondary">
                Docling 调用 `/docling/convert`；GLM OCR 调用 `/api/ocr/table-repair-preview`。
              </Typography.Text>
              <Space>
                <Button type="primary" onClick={runConvert} loading={submitting} disabled={!canSubmit}>开始转换</Button>
                <Button icon={<CopyOutlined />} onClick={copyRequest}>复制请求</Button>
              </Space>
            </Space>
          </Card>
        </Col>

        <Col span={16}>
          <Card
            title="转换结果"
            extra={<Button icon={<DownloadOutlined />} onClick={downloadResponse}>下载 JSON</Button>}
          >
            {!result
              ? (
                  <Empty description="请先上传文件并发起转换" />
                )
              : (
                  <Tabs
                    defaultActiveKey="markdown"
                    items={[
                      {
                        key: 'markdown',
                        label: 'Markdown',
                        children: <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{result.engine === 'docling' ? String((result.data as ConvertResponse).markdown || '') : ocrMarkdown}</pre>,
                      },
                      {
                        key: 'text',
                        label: result.engine === 'docling' ? '纯文本' : 'OCR 结构',
                        children: <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{result.engine === 'docling' ? String((result.data as ConvertResponse).text || '') : pretty((result.data as GLMOCRResponse).result?.layoutParsingResults || [])}</pre>,
                      },
                      {
                        key: 'document',
                        label: '结构化 JSON',
                        children: <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{result.engine === 'docling' ? pretty((result.data as ConvertResponse).document || {}) : pretty((result.data as GLMOCRResponse).metaExtensions || {})}</pre>,
                      },
                      {
                        key: 'raw',
                        label: '原始响应',
                        children: (
                          <Space orientation="vertical" size={12} className="w-full">
                            <Typography.Text>engine: {result.engine === 'docling' ? 'Docling 文本层' : 'GLM OCR'}</Typography.Text>
                            {result.engine === 'docling' && <Typography.Text>filename: {((result.data as ConvertResponse).filename) || '-'}</Typography.Text>}
                            {result.engine === 'docling' && <Typography.Text>durationMs: {String((result.data as ConvertResponse).durationMs ?? '-')}</Typography.Text>}
                            {result.engine === 'docling' && <Typography.Text>imageOcrApplied: {String(Boolean((result.data as ConvertResponse).imageOcrApplied))}</Typography.Text>}
                            {result.engine === 'docling' && <Typography.Text>imageOcrCount: {String((result.data as ConvertResponse).imageOcrCount ?? 0)}</Typography.Text>}
                            {result.engine === 'docling' && <Typography.Text>imageOcrSkippedCount: {String((result.data as ConvertResponse).imageOcrSkippedCount ?? 0)}</Typography.Text>}
                            <pre className="text-xs overflow-auto whitespace-pre-wrap m-0">{pretty(result.data)}</pre>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
