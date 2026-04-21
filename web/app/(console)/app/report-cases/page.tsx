'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Table, Tag, message } from 'antd'
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
  categories: unknown
}

type ReportCaseDTO = {
  id: number
  templateId: number
  name: string
  subjectId: number
  subjectName: string
  status: 'draft' | 'processing' | 'pending_review' | 'ready'
  summary?: {
    fileCount?: number
    readyCount?: number
    reviewPendingCount?: number
    needsOCRCount?: number
  }
}

type FileDTO = {
  id: number
  bizKey: string
  latestVersionNo: number
  latestVersion?: {
    originName: string
    mimeType: string
  }
}

type ReportCaseFileDTO = {
  id: number
  caseId: number
  fileId: number
  versionNo: number
  manualCategory: string
  suggestedSubCategory: string
  finalSubCategory: string
  status: string
  reviewStatus: string
  confidence: number
  fileType: string
  sourceType: string
  parseStatus: string
  ocrPending: boolean
  isScannedSuspected: boolean
  processingNotes?: unknown
}

type ExtractionFactDTO = {
  id: number
  caseFileId: number
  factKey: string
  factType: string
  confidence: number
  reviewStatus: string
  factValue: unknown
}

type FactSourceRefDTO = {
  id: number
  factId: number
  fileId: number
  versionNo: number
  sliceId: number
  tableId: number
  fragmentId: number
  cellId: number
  pageNo: number
  bbox?: unknown
  quoteText: string
  tableCellRef?: string
}

type DocumentSliceDTO = {
  id: number
  sliceType: string
  sourceType: string
  title: string
  pageStart: number
  pageEnd: number
  cleanText: string
  parseStatus: string
  ocrPending: boolean
}

type DocumentTableDTO = {
  id: number
  title: string
  pageStart: number
  pageEnd: number
  columnCount: number
  headerRowCount: number
  sourceType: string
  parseStatus: string
}

type DocumentTableFragmentDTO = {
  id: number
  tableId: number
  pageNo: number
  rowStart: number
  rowEnd: number
  fragmentOrder: number
}

type DocumentTableCellDTO = {
  id: number
  tableId: number
  fragmentId: number
  rowIndex: number
  colIndex: number
  rawText: string
  normalizedValue: string
}

type AssemblyItemDTO = {
  id: number
  templateSlotKey: string
  itemType: string
  factId: number
  displayOrder: number
  snapshotValue: unknown
}

type ReviewQueueItemDTO = {
  caseFile: ReportCaseFileDTO
  facts: ExtractionFactDTO[]
  sourceRefs: FactSourceRefDTO[]
}

type ReportCaseDetailDTO = {
  case: ReportCaseDTO
  files: ReportCaseFileDTO[]
  slices: DocumentSliceDTO[]
  tables: DocumentTableDTO[]
  tableFragments: DocumentTableFragmentDTO[]
  tableCells: DocumentTableCellDTO[]
  facts: ExtractionFactDTO[]
  sourceRefs: FactSourceRefDTO[]
  assemblyItems: AssemblyItemDTO[]
}

type AssemblyViewDTO = {
  case: ReportCaseDTO
  items: AssemblyItemDTO[]
  facts: ExtractionFactDTO[]
  sourceRefs: FactSourceRefDTO[]
}

type SubjectAssetDTO = {
  id: number
  subjectId: number
  subjectName: string
  assetType: string
  assetKey: string
  factId: number
  status: string
}

const categoryOptions = ['主体', '区域', '财务', '项目', '反担保', '反担保财报']

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const parseBBoxMeta = (bbox: unknown): Record<string, unknown> => {
  if (!bbox)
    return {}
  if (typeof bbox === 'object')
    return bbox as Record<string, unknown>
  if (typeof bbox !== 'string')
    return {}
  try {
    return JSON.parse(bbox) as Record<string, unknown>
  }
  catch {
    return {}
  }
}

const parseProcessingNotes = (notes: unknown): Record<string, unknown> => {
  if (!notes)
    return {}
  if (typeof notes === 'object')
    return notes as Record<string, unknown>
  if (typeof notes !== 'string')
    return {}
  try {
    return JSON.parse(notes) as Record<string, unknown>
  }
  catch {
    return {}
  }
}

const formatPdfDiagnosticSummary = (notes: unknown) => {
  const parsed = parseProcessingNotes(notes)
  const diagnostics = parsed.pdfDiagnostics as Record<string, unknown> | undefined
  if (!diagnostics)
    return '-'
  const pageCount = Number(diagnostics.pageCount || 0)
  const decodeMode = String(diagnostics.decodeMode || '-')
  const hasTextOperators = diagnostics.hasTextOperators ? '有文本操作符' : '无文本操作符'
  const decodeFailed = diagnostics.decodeFailed ? '解码失败' : '解码正常'
  const pages = Array.isArray(diagnostics.pages) ? diagnostics.pages as Array<Record<string, unknown>> : []
  const pageSummary = pages.slice(0, 3).map(page => `P${page.pageNo}: ${page.charCount || 0}字`).join('，')
  return `${decodeMode} / ${hasTextOperators} / ${decodeFailed}${pageCount > 0 ? ` / ${pageCount}页` : ''}${pageSummary ? ` / ${pageSummary}` : ''}`
}

const formatSourceLocator = (ref: FactSourceRefDTO) => {
  const bbox = parseBBoxMeta(ref.bbox)
  const pageNo = Number(bbox.page ?? ref.pageNo ?? 0)
  const blockNo = Number(bbox.block ?? 0)
  const parts: string[] = []
  if (pageNo > 0)
    parts.push(`第${pageNo}页`)
  if (blockNo > 0)
    parts.push(`块${blockNo}`)
  if (ref.cellId) {
    const cellRef = ref.tableCellRef?.includes('!')
      ? ref.tableCellRef.split('!').pop()
      : ref.tableCellRef
    if (cellRef)
      parts.push(`单元格${cellRef}`)
    else
      parts.push('表格单元格')
    return parts.join(' / ')
  }
  if (ref.sliceId) {
    parts.push('文本切片')
    return parts.join(' / ')
  }
  if (ref.tableId) {
    parts.push('表格')
    return parts.join(' / ')
  }
  return parts.join(' / ') || `文件#${ref.fileId}`
}

  const statusColorMap: Record<string, string> = {
  draft: 'default',
  processing: 'processing',
  pending_review: 'warning',
  ready: 'success',
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  needs_ocr: 'warning',
  parsed: 'processing',
  failed: 'error',
}

export default function ReportCasesPage() {
  const router = useRouter()
  const { role, hydrated } = useConsoleRole()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<ReportTemplateDTO[]>([])
  const [cases, setCases] = useState<ReportCaseDTO[]>([])
  const [files, setFiles] = useState<FileDTO[]>([])
  const [selectedCase, setSelectedCase] = useState<ReportCaseDetailDTO | null>(null)
  const [assembly, setAssembly] = useState<AssemblyViewDTO | null>(null)
  const [subjectAssets, setSubjectAssets] = useState<SubjectAssetDTO[]>([])
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItemDTO[]>([])
  const [caseForm] = Form.useForm()
  const [attachForm] = Form.useForm()
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, { decision: 'approved' | 'rejected', finalSubCategory?: string }>>({})

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
      router.push('/?redirect=/app/report-cases')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const refreshBase = async () => {
    setLoading(true)
    try {
      const [templateRows, caseRows, fileRows] = await Promise.all([
        request<ReportTemplateDTO[]>('/api/report-templates', { method: 'GET' }),
        request<ReportCaseDTO[]>('/api/report-cases', { method: 'GET' }),
        request<FileDTO[]>('/api/files', { method: 'GET' }),
      ])
      setTemplates(Array.isArray(templateRows) ? templateRows : [])
      setCases(Array.isArray(caseRows) ? caseRows : [])
      setFiles(Array.isArray(fileRows) ? fileRows : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载失败')
    }
    finally {
      setLoading(false)
    }
  }

  const loadCaseDetail = async (caseId: number) => {
    try {
      const [detail, queue, assemblyView] = await Promise.all([
        request<ReportCaseDetailDTO>(`/api/report-cases/${caseId}`, { method: 'GET' }),
        request<ReviewQueueItemDTO[]>(`/api/report-cases/${caseId}/review-queue`, { method: 'GET' }),
        request<AssemblyViewDTO>(`/api/report-cases/${caseId}/assembly`, { method: 'GET' }),
      ])
      setSelectedCase(detail)
      setReviewQueue(Array.isArray(queue) ? queue : [])
      setAssembly(assemblyView)
      if ((detail.case.subjectId ?? 0) > 0) {
        const assetRows = await request<SubjectAssetDTO[]>(`/api/subjects/${detail.case.subjectId}/assets`, { method: 'GET' })
        setSubjectAssets(Array.isArray(assetRows) ? assetRows : [])
      } else {
        setSubjectAssets([])
      }
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载报告实例失败')
    }
  }

  useEffect(() => {
    if (hydrated && role !== 'guest')
      refreshBase()
  }, [hydrated, role])

  const templateOptions = useMemo(() => templates.map(item => ({ label: `${item.name}（${item.templateKey}）`, value: item.id })), [templates])
  const fileOptions = useMemo(() => files.map(item => ({
    label: `${item.id} - ${item.latestVersion?.originName || item.bizKey}`,
    value: item.id,
  })), [files])

  const createCase = async () => {
    try {
      const values = await caseForm.validateFields()
      await request('/api/report-cases', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      msgApi.success('报告实例已创建')
      caseForm.resetFields()
      refreshBase()
    }
    catch (error) {
      if (error instanceof Error)
        msgApi.error(error.message)
    }
  }

  const attachFile = async () => {
    if (!selectedCase) {
      msgApi.warning('请先选择报告实例')
      return
    }
    try {
      const values = await attachForm.validateFields()
      await request(`/api/report-cases/${selectedCase.case.id}/files`, {
        method: 'POST',
        body: JSON.stringify(values),
      })
      msgApi.success('文件已挂接')
      attachForm.resetFields()
      await Promise.all([refreshBase(), loadCaseDetail(selectedCase.case.id)])
    }
    catch (error) {
      if (error instanceof Error)
        msgApi.error(error.message)
    }
  }

  const processCase = async () => {
    if (!selectedCase) {
      msgApi.warning('请先选择报告实例')
      return
    }
    try {
      await request(`/api/report-cases/${selectedCase.case.id}/process`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      })
      msgApi.success('处理完成，已进入复核队列')
      await Promise.all([refreshBase(), loadCaseDetail(selectedCase.case.id)])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '处理失败')
    }
  }

  const downloadCaseFile = async (fileId: number, versionNo: number) => {
    const token = getToken()
    if (!token) {
      msgApi.error('缺少登录令牌，请重新登录后再试')
      return
    }
    const query = versionNo > 0 ? `?versionNo=${encodeURIComponent(String(versionNo))}` : ''
    try {
      const response = await fetch(`/api/files/${fileId}/download${query}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      })
      if (!response.ok) {
        let message = '下载失败'
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const payload = await response.json() as ApiResponse<unknown>
          message = payload.message || message
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const matched = disposition.match(/filename="?([^"]+)"?/)
      const fileName = matched?.[1] || `file-${fileId}-v${versionNo || 1}`
      const objectURL = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectURL
      anchor.download = decodeURIComponent(fileName)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(objectURL)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '下载失败')
    }
  }

  const submitReview = async () => {
    if (!selectedCase) {
      msgApi.warning('请先选择报告实例')
      return
    }
    const decisions = Object.entries(reviewDecisions).map(([caseFileId, item]) => ({
      caseFileId: Number(caseFileId),
      decision: item.decision,
      finalSubCategory: item.finalSubCategory || '',
    }))
    if (!decisions.length) {
      msgApi.warning('请先填写复核结果')
      return
    }
    try {
      await request(`/api/report-cases/${selectedCase.case.id}/review-decisions`, {
        method: 'POST',
        body: JSON.stringify({ decisions }),
      })
      msgApi.success('复核结果已提交')
      setReviewDecisions({})
      await Promise.all([refreshBase(), loadCaseDetail(selectedCase.case.id)])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '提交复核失败')
    }
  }

  if (!hydrated) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">{contextHolder}<div className="text-sm text-gray-500">加载中...</div></div>
  }

  if (role === 'guest') {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">{contextHolder}<div className="text-sm text-gray-500">请先登录。</div></div>
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card title="新建报告实例" extra={(
        <Space>
          <Button onClick={() => router.push('/app/report-templates')}>报告模板</Button>
          <Button onClick={refreshBase} loading={loading}>刷新</Button>
        </Space>
      )}
      >
        <Form form={caseForm} layout="inline">
          <Form.Item name="templateId" label="报告模板" rules={[{ required: true, message: '请选择模板' }]}>
            <Select style={{ width: 280 }} options={templateOptions} />
          </Form.Item>
          <Form.Item name="name" label="实例名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input style={{ width: 220 }} placeholder="例如：城投主体准入报告" />
          </Form.Item>
          <Form.Item name="subjectId" label="主体ID">
            <InputNumber min={0} precision={0} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="subjectName" label="主体名称">
            <Input style={{ width: 220 }} placeholder="可选" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={createCase}>创建</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="报告实例列表">
        <Table
          rowKey="id"
          size="small"
          dataSource={cases}
          pagination={false}
          onRow={record => ({ onClick: () => loadCaseDetail(record.id) })}
          rowClassName={record => record.id === selectedCase?.case.id ? 'bg-blue-50' : ''}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 72 },
            { title: '名称', dataIndex: 'name' },
            { title: '主体', render: (_, record) => record.subjectName || record.subjectId || '-' },
            { title: '状态', dataIndex: 'status', render: value => <Tag color={statusColorMap[value] || 'default'}>{value}</Tag> },
            { title: '文件数', render: (_, record) => record.summary?.fileCount ?? 0, width: 90 },
            { title: '待复核', render: (_, record) => record.summary?.reviewPendingCount ?? 0, width: 90 },
            { title: '待OCR', render: (_, record) => record.summary?.needsOCRCount ?? 0, width: 90 },
          ]}
        />
      </Card>

      {selectedCase && (
        <>
          <Card
            title={`实例详情 #${selectedCase.case.id}`}
            extra={(
              <Space>
                <Button onClick={attachFile}>挂接文件</Button>
                <Button type="primary" onClick={processCase}>触发处理</Button>
              </Space>
            )}
          >
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="名称">{selectedCase.case.name}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={statusColorMap[selectedCase.case.status] || 'default'}>{selectedCase.case.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="模板ID">{selectedCase.case.templateId}</Descriptions.Item>
              <Descriptions.Item label="主体">{selectedCase.case.subjectName || selectedCase.case.subjectId || '-'}</Descriptions.Item>
            </Descriptions>
            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">已挂接文件</div>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={selectedCase.files}
                columns={[
                  { title: '文件ID', dataIndex: 'fileId', width: 90 },
                  { title: '版本', dataIndex: 'versionNo', width: 80 },
                  { title: '大类', dataIndex: 'manualCategory', width: 90 },
                  { title: '建议细类', dataIndex: 'suggestedSubCategory' },
                  { title: '最终细类', dataIndex: 'finalSubCategory' },
                  { title: '文件类型', dataIndex: 'fileType', width: 100 },
                  { title: '来源类型', dataIndex: 'sourceType', width: 110 },
                  { title: '解析状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={statusColorMap[value] || 'default'}>{value}</Tag> },
                  { title: '诊断摘要', width: 320, render: (_, record) => <span className="text-xs text-gray-600">{formatPdfDiagnosticSummary(record.processingNotes)}</span> },
                  { title: '置信度', dataIndex: 'confidence', width: 100, render: value => Number(value || 0).toFixed(2) },
                  { title: '复核', dataIndex: 'reviewStatus', width: 110, render: value => <Tag color={statusColorMap[value] || 'default'}>{value}</Tag> },
                  {
                    title: '操作',
                    width: 100,
                    render: (_, record) => (
                      <Button size="small" onClick={() => downloadCaseFile(record.fileId, record.versionNo)}>
                        下载
                      </Button>
                    ),
                  },
                ]}
              />
            </div>
          </Card>

          <Card title="切片与表格">
            <div className="mb-3 text-xs text-gray-500">
              PDF 现按页输出，并补充页内表格候选块；扫描件当前只保留页级占位并标记为待 OCR。
            </div>
            <div className="mb-2 text-sm font-semibold text-gray-900">DocumentSlice</div>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={selectedCase.slices}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 70 },
                { title: '类型', dataIndex: 'sliceType', width: 110 },
                { title: '来源', dataIndex: 'sourceType', width: 110 },
                { title: '标题', dataIndex: 'title', width: 220, ellipsis: true },
                { title: '页码', render: (_, record) => `${record.pageStart}-${record.pageEnd}`, width: 90 },
                { title: '状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={statusColorMap[value] || 'default'}>{value}</Tag> },
                {
                  title: '内容',
                  render: (_, record) => record.cleanText
                    ? <div className="max-w-[640px] whitespace-pre-wrap break-all text-xs text-gray-700">{record.cleanText}</div>
                    : <span className="text-xs text-gray-400">{record.ocrPending ? '待 OCR' : '-'}</span>,
                },
              ]}
            />
            <div className="mt-4 mb-2 text-sm font-semibold text-gray-900">DocumentTable</div>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={selectedCase.tables}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 70 },
                { title: '标题', dataIndex: 'title' },
                { title: '页码', render: (_, record) => `${record.pageStart}-${record.pageEnd}`, width: 90 },
                { title: '列数', dataIndex: 'columnCount', width: 80 },
                { title: '表头行', dataIndex: 'headerRowCount', width: 90 },
                { title: '来源', dataIndex: 'sourceType', width: 110 },
                { title: '状态', dataIndex: 'parseStatus', width: 110, render: value => <Tag color={statusColorMap[value] || 'default'}>{value}</Tag> },
              ]}
            />
            <div className="mt-4 mb-2 text-sm font-semibold text-gray-900">DocumentTableFragment</div>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={selectedCase.tableFragments}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 70 },
                { title: '表格ID', dataIndex: 'tableId', width: 90 },
                { title: '页码', dataIndex: 'pageNo', width: 80 },
                { title: '行范围', render: (_, record) => `${record.rowStart}-${record.rowEnd}`, width: 100 },
                { title: '顺序', dataIndex: 'fragmentOrder', width: 80 },
              ]}
            />
            <div className="mt-4 mb-2 text-sm font-semibold text-gray-900">DocumentTableCell</div>
            <Table
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              dataSource={selectedCase.tableCells}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 70 },
                { title: '表格ID', dataIndex: 'tableId', width: 90 },
                { title: '片段ID', dataIndex: 'fragmentId', width: 90 },
                { title: '坐标', render: (_, record) => `R${record.rowIndex}C${record.colIndex}`, width: 100 },
                { title: '内容', dataIndex: 'normalizedValue' },
              ]}
            />
          </Card>

          <Card title="待复核队列" extra={<Button type="primary" onClick={submitReview}>提交复核</Button>}>
            <div className="space-y-3">
              {reviewQueue.length === 0 && <div className="text-sm text-gray-500">当前没有待复核项。</div>}
              {reviewQueue.map(item => (
                <div key={item.caseFile.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">
                      文件 #{item.caseFile.fileId} / {item.caseFile.manualCategory} / {item.caseFile.suggestedSubCategory}
                    </div>
                    <Tag color="warning">{item.caseFile.reviewStatus}</Tag>
                  </div>
                  <div className="mb-3 text-xs text-gray-500">
                    来源文件将通过 <code>fact -&gt; source_ref -&gt; file/version/page</code> 链路保留，可继续扩展到 OCR/表格单元格。
                  </div>
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={item.facts}
                    columns={[
                      { title: '事实键', dataIndex: 'factKey' },
                      { title: '事实类型', dataIndex: 'factType', width: 120 },
                      { title: '置信度', dataIndex: 'confidence', width: 100, render: value => Number(value || 0).toFixed(2) },
                      {
                        title: '来源',
                        width: 260,
                        render: (_, record) => {
                          const refs = item.sourceRefs.filter(ref => ref.factId === record.id)
                          return refs.map((ref) => {
                            const locator = formatSourceLocator(ref)
                            return `文件#${ref.fileId}/v${ref.versionNo} / ${locator}: ${ref.quoteText || ref.tableCellRef || '-'}`
                          }).join('；') || '-'
                        },
                      },
                    ]}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-12">
                    <Select
                      style={{ width: 160 }}
                      placeholder="复核结论"
                      value={reviewDecisions[item.caseFile.id]?.decision}
                      onChange={(value: 'approved' | 'rejected') => setReviewDecisions(prev => ({
                        ...prev,
                        [item.caseFile.id]: { ...prev[item.caseFile.id], decision: value },
                      }))}
                      options={[
                        { label: '通过', value: 'approved' },
                        { label: '驳回', value: 'rejected' },
                      ]}
                    />
                    <Input
                      style={{ width: 260 }}
                      placeholder="最终细类（可选修正）"
                      value={reviewDecisions[item.caseFile.id]?.finalSubCategory}
                      onChange={event => setReviewDecisions(prev => ({
                        ...prev,
                        [item.caseFile.id]: { ...prev[item.caseFile.id], finalSubCategory: event.target.value },
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="组装视图">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={assembly?.items || []}
              columns={[
                { title: '槽位', dataIndex: 'templateSlotKey', width: 120 },
                { title: '类型', dataIndex: 'itemType', width: 100 },
                { title: '排序', dataIndex: 'displayOrder', width: 80 },
                {
                  title: '快照',
                  render: (_, record) => <pre className="m-0 max-w-[720px] overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(record.snapshotValue, null, 2)}</pre>,
                },
              ]}
            />
          </Card>

          <Card title="主体资产池">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={subjectAssets}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 70 },
                { title: '主体', dataIndex: 'subjectName' },
                { title: '资产类型', dataIndex: 'assetType', width: 120 },
                { title: '资产键', dataIndex: 'assetKey' },
                { title: '事实ID', dataIndex: 'factId', width: 100 },
                { title: '状态', dataIndex: 'status', width: 100, render: value => <Tag color={statusColorMap[value] || 'default'}>{value}</Tag> },
              ]}
            />
          </Card>
        </>
      )}
      <Card title="挂接文件说明">
        <Form form={attachForm} layout="inline">
          <Form.Item name="fileId" label="文件" rules={[{ required: true, message: '请选择文件' }]}>
            <Select style={{ width: 320 }} options={fileOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="manualCategory" label="人工大类" rules={[{ required: true, message: '请选择大类' }]}>
            <Select style={{ width: 160 }} options={categoryOptions.map(item => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item>
            <Button onClick={attachFile} disabled={!selectedCase}>挂接到当前实例</Button>
          </Form.Item>
        </Form>
        <div className="mt-3 text-xs text-gray-500">
          当前版本已实现：报告模板、实例、文件挂接、真实 DocumentSlice 落库、扫描件待 OCR 状态、表格对象与 cell 级来源回链骨架。OCR 服务暂未接入，仅预留 provider 口子。
        </div>
      </Card>
    </div>
  )
}
