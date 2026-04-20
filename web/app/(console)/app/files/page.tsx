'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Collapse, Descriptions, Form, Input, Modal, Popconfirm, Space, Table, Tabs, Tag, Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'
import { MAX_SINGLE_UPLOAD_TEXT, isSingleUploadOversized } from '@/lib/upload-limit'
import ParsedDocumentViewer from '@/components/files/ParsedDocumentViewer'

type FileVersionDTO = {
  id: number
  fileId: number
  versionNo: number
  originName: string
  mimeType: string
  sizeBytes: number
  checksum: string
  storageKey: string
  status: 'uploading' | 'uploaded' | 'failed'
  createdAt: string
  updatedAt: string
}

type FileDTO = {
  id: number
  bizKey: string
  latestVersionNo: number
  status: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
  latestVersion?: FileVersionDTO
}

type UploadSessionDTO = {
  id: string
  fileId: number
  targetVersionNo: number
  status: string
  expiresAt: string
  createdAt: string
  updatedAt: string
}

type FilePickerValue = {
  file: File | null
  fileList: UploadFile[]
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

type FileParseResultDTO = {
  version: FileVersionDTO
  profile: {
    parseStrategy?: string
    fileType?: string
    sourceType?: string
    pageCount?: number
    hasTextLayer?: boolean
  }
  ocrPending?: boolean
  ocrTaskId?: number
  ocrTaskStatus?: string
  ocrProvider?: string
  ocrError?: string
  sliceCount: number
  tableCount: number
  figureCount: number
  fragmentCount: number
  cellCount: number
  slices: FileParseSlicePreviewDTO[]
  tables: FileParseTablePreviewDTO[]
  figures: FileParseFigurePreviewDTO[]
}

type FileParseJobDTO = {
  jobId: number
  fileId: number
  versionNo: number
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string
  retryCount: number
  errorMessage?: string
  fileType?: string
  sourceType?: string
  parseStrategy?: string
  ocrTaskStatus?: string
  ocrPending?: boolean
  ocrError?: string
  updatedAt?: string
  startedAt?: string
  finishedAt?: string
  latestResult?: FileParseResultDTO
  resultReady?: boolean
  requestIgnored?: boolean
}

type ParseProfile = FileParseResultDTO['profile']

type FileParseSlicePreviewDTO = {
  sliceType: string
  title: string
  pageStart: number
  pageEnd: number
  sourceRef: string
  bbox: Record<string, unknown> | null
  cleanText: string
  confidence: number
  parseStatus: string
}

type FileParseTableCellPreviewDTO = {
  text: string
  sourceRef: string
}

type FileParseTableRowPreviewDTO = {
  rowIndex: number
  cells: FileParseTableCellPreviewDTO[]
}

type FileParseTablePreviewDTO = {
  title: string
  pageStart: number
  pageEnd: number
  headerRowCount: number
  columnCount: number
  sourceRef: string
  bbox: Record<string, unknown> | null
  previewRows: FileParseTableRowPreviewDTO[]
}

type FileParseFigurePreviewDTO = {
  title: string
  figureType: string
  pageNo: number
  sourceRef: string
  bbox: Record<string, unknown> | null
  cleanText: string
  regions: FileParseFigureRegionPreviewDTO[]
  confidence: number
  parseStatus: string
}

type FileParseFigureRegionPreviewDTO = {
  rowIndex: number
  region: string
  text: string
  sourceRef: string
  bbox: Record<string, unknown> | null
}

type KnowledgeIndexStatusDTO = {
  fileId: number
  versionNo: number
  status: 'pending' | 'running' | 'succeeded' | 'failed' | string
  retryCount: number
  errorMessage?: string
  startedAt?: string
  finishedAt?: string
  updatedAt?: string
}

type KnowledgeSearchHitDTO = {
  fileId: number
  versionNo: number
  chunkIndex: number
  chunkText: string
  chunkSummary: string
  sourceType: string
  pageStart: number
  pageEnd: number
  sourceRef: string
  bbox: Record<string, unknown> | null
  score: number
  retrievalType: 'semantic' | 'keyword' | 'hybrid' | string
  semanticScore: number
  keywordScore: number
  finalScore: number
}

type KnowledgeSearchResultDTO = {
  hits: KnowledgeSearchHitDTO[]
}

type ReindexFormValue = {
  fileId: string
  versionNo: string
}

type SearchFormValue = {
  query: string
  topK: string
  minScore: string
  fileIds: string
  bizKey: string
  subjectId: string
  projectId: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const formatSize = (value: number) => {
  if (!Number.isFinite(value) || value <= 0)
    return '0 B'
  if (value < 1024)
    return `${value} B`
  if (value < 1024 * 1024)
    return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const formatBoolean = (value?: boolean) => {
  if (value === true)
    return '是'
  if (value === false)
    return '否'
  return '-'
}

const getParseTaskKey = (fileID: number, versionNo: number) => `${fileID}:${versionNo}`

const getParseStrategyLabel = (profile?: ParseProfile) => {
  if (!profile)
    return '-'
  return profile.parseStrategy || '-'
}

const formatFigureType = (value?: string) => {
  if (!value)
    return '-'
  switch (value) {
    case 'structure_chart':
      return '结构图'
    case 'flow_chart':
      return '流程图'
    case 'org_chart':
      return '组织结构图'
    default:
      return '图表示意'
  }
}

const formatFigureRegion = (value?: string) => {
  switch (value) {
    case 'left':
      return '左区'
    case 'right':
      return '右区'
    case 'center':
      return '中区'
    default:
      return value || '-'
  }
}

const copyText = async (value: string) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard)
    throw new Error('当前环境不支持复制')
  await navigator.clipboard.writeText(value)
}

const stringifyKeyPart = (value: unknown) => {
  if (value == null)
    return 'null'
  if (typeof value === 'string')
    return value
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

const buildSliceRowKey = (row: FileParseSlicePreviewDTO) => [
  row.sliceType,
  row.sourceRef,
  row.title || 'untitled',
  `${row.pageStart}-${row.pageEnd}`,
  stringifyKeyPart(row.bbox),
  (row.cleanText || '').slice(0, 120),
].join('-')

const buildTableRowKey = (row: FileParseTablePreviewDTO) => `${row.title}-${row.sourceRef}-${row.pageStart}-${row.pageEnd}`

const buildFigureRowKey = (row: FileParseFigurePreviewDTO) => `${row.figureType}-${row.sourceRef}-${row.title}-${row.pageNo}`

const buildKnowledgeHitRowKey = (row: KnowledgeSearchHitDTO) => `${row.fileId}-${row.versionNo}-${row.chunkIndex}-${row.sourceRef}`

const parsePositiveInt = (value: string) => {
  const number = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(number) || number <= 0)
    return 0
  return number
}

const parseNonNegativeInt = (value: string) => {
  const number = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(number) || number < 0)
    return 0
  return number
}

const parsePositiveFloat = (value: string, fallback: number) => {
  const number = Number.parseFloat(String(value || '').trim())
  if (!Number.isFinite(number) || number <= 0)
    return fallback
  return number
}

const parseFileIDs = (value: string) => String(value || '')
  .split(',')
  .map(item => parsePositiveInt(item))
  .filter(item => item > 0)

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

const createUploadPickerProps = (
  onChange: (value: FilePickerValue) => void,
  onOversized?: (file: File) => void,
): UploadProps => ({
  multiple: false,
  maxCount: 1,
  beforeUpload: (file) => {
    const rawFile = file as File
    if (isSingleUploadOversized(rawFile)) {
      onOversized?.(rawFile)
      return Upload.LIST_IGNORE
    }
    return false
  },
  showUploadList: true,
  onChange: ({ fileList }) => {
    const latest = fileList.at(-1)
    onChange({
      file: latest?.originFileObj ?? null,
      fileList: latest ? [latest] : [],
    })
  },
  onRemove: () => {
    onChange({ file: null, fileList: [] })
    return true
  },
})

export default function FilesPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()

  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<FileDTO[]>([])

  const [uploading, setUploading] = useState(false)
  const [newFileObject, setNewFileObject] = useState<File | null>(null)
  const [newFileList, setNewFileList] = useState<UploadFile[]>([])
  const [newVersionFileMap, setNewVersionFileMap] = useState<Record<number, File | null>>({})
  const [newVersionFileListMap, setNewVersionFileListMap] = useState<Record<number, UploadFile[]>>({})
  const [form] = Form.useForm()
  const [reindexForm] = Form.useForm<ReindexFormValue>()
  const [searchForm] = Form.useForm<SearchFormValue>()

  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionRows, setVersionRows] = useState<FileVersionDTO[]>([])
  const [versionTargetFileID, setVersionTargetFileID] = useState<number>(0)
  const [parseLoadingMap, setParseLoadingMap] = useState<Record<string, boolean>>({})
  const [deleteLoadingMap, setDeleteLoadingMap] = useState<Record<number, boolean>>({})
  const [parseResultModalOpen, setParseResultModalOpen] = useState(false)
  const [parseJob, setParseJob] = useState<FileParseJobDTO | null>(null)
  const [parseResult, setParseResult] = useState<FileParseResultDTO | null>(null)
  const [parseTargetFileID, setParseTargetFileID] = useState<number>(0)
  const [parseTargetVersionNo, setParseTargetVersionNo] = useState<number>(0)
  const [parseResultLoading, setParseResultLoading] = useState(false)
  const [parseResultError, setParseResultError] = useState('')
  const [parseAutoFetchFailed, setParseAutoFetchFailed] = useState(false)
  const [reindexLoading, setReindexLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [indexStatus, setIndexStatus] = useState<KnowledgeIndexStatusDTO | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchHits, setSearchHits] = useState<KnowledgeSearchHitDTO[]>([])
  const indexPollTimerRef = useRef<number | null>(null)

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
      router.push('/?redirect=/app/files')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问（仅管理员可用）')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')

    return payload.data as T
  }

  const fetchFiles = async () => {
    setLoading(true)
    try {
      const data = await request<FileDTO[]>('/api/files', { method: 'GET' })
      setFiles(Array.isArray(data) ? data : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载文件列表失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hydrated && currentRole === 'admin')
      fetchFiles()
  }, [hydrated, currentRole])

  const stopIndexPolling = () => {
    if (indexPollTimerRef.current != null) {
      window.clearInterval(indexPollTimerRef.current)
      indexPollTimerRef.current = null
    }
  }

  useEffect(() => () => {
    stopIndexPolling()
  }, [])

  const fetchIndexStatus = async (fileID: number, versionNo: number, silent = false) => {
    if (fileID <= 0) {
      if (!silent)
        msgApi.warning('请先输入合法 fileId')
      return null
    }
    const query = versionNo > 0 ? `?versionNo=${encodeURIComponent(String(versionNo))}` : ''
    if (!silent)
      setStatusLoading(true)
    try {
      const data = await request<KnowledgeIndexStatusDTO>(`/api/files/${fileID}/index-status${query}`, { method: 'GET' })
      setIndexStatus(data)
      return data
    }
    catch (error) {
      if (!silent)
        msgApi.error(error instanceof Error ? error.message : '查询索引状态失败')
      return null
    }
    finally {
      if (!silent)
        setStatusLoading(false)
    }
  }

  const startIndexPolling = (fileID: number, versionNo: number) => {
    stopIndexPolling()
    let attempts = 0
    const maxAttempts = 20
    const poll = async () => {
      attempts++
      const data = await fetchIndexStatus(fileID, versionNo, true)
      if (!data)
        return
      const status = String(data.status || '')
      if (status === 'succeeded') {
        msgApi.success(`索引完成：fileId=${data.fileId} v${data.versionNo}`)
        stopIndexPolling()
        return
      }
      if (status === 'failed') {
        msgApi.error(`索引失败：${data.errorMessage || '未知错误'}`)
        stopIndexPolling()
        return
      }
      if (attempts >= maxAttempts) {
        msgApi.warning('轮询已停止，请手动刷新索引状态')
        stopIndexPolling()
      }
    }
    poll()
    indexPollTimerRef.current = window.setInterval(() => {
      void poll()
    }, 1500)
  }

  const triggerReindex = async () => {
    const fileID = parsePositiveInt(reindexForm.getFieldValue('fileId'))
    const versionNo = parseNonNegativeInt(reindexForm.getFieldValue('versionNo'))
    if (fileID <= 0) {
      msgApi.warning('请先输入合法 fileId')
      return
    }
    setReindexLoading(true)
    try {
      const query = versionNo > 0 ? `?versionNo=${encodeURIComponent(String(versionNo))}` : ''
      const data = await request<KnowledgeIndexStatusDTO>(`/api/files/${fileID}/reindex${query}`, { method: 'POST' })
      setIndexStatus(data)
      msgApi.success(`已触发重建：fileId=${data.fileId} v${data.versionNo}`)
      startIndexPolling(fileID, versionNo)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '触发重建失败')
    }
    finally {
      setReindexLoading(false)
    }
  }

  const queryIndexStatus = async () => {
    const fileID = parsePositiveInt(reindexForm.getFieldValue('fileId'))
    const versionNo = parseNonNegativeInt(reindexForm.getFieldValue('versionNo'))
    await fetchIndexStatus(fileID, versionNo)
  }

  const runKnowledgeSearch = async () => {
    const query = String(searchForm.getFieldValue('query') || '').trim()
    if (!query) {
      msgApi.warning('请输入检索问题 query')
      return
    }
    const topK = parsePositiveInt(searchForm.getFieldValue('topK')) || 12
    const minScore = parsePositiveFloat(searchForm.getFieldValue('minScore'), 0.2)
    const fileIDs = parseFileIDs(searchForm.getFieldValue('fileIds'))
    const payload = {
      query,
      topK,
      minScore,
      fileIds: fileIDs,
      bizKey: String(searchForm.getFieldValue('bizKey') || '').trim(),
      subjectId: parseNonNegativeInt(searchForm.getFieldValue('subjectId')),
      projectId: parseNonNegativeInt(searchForm.getFieldValue('projectId')),
    }
    setSearchLoading(true)
    try {
      const data = await request<KnowledgeSearchResultDTO>('/api/knowledge/search', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const hits = Array.isArray(data?.hits) ? data.hits : []
      setSearchHits(hits)
      msgApi.success(`检索完成，命中 ${hits.length} 条`)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '知识检索失败')
    }
    finally {
      setSearchLoading(false)
    }
  }

  const copyKnowledgeHits = async () => {
    if (searchHits.length === 0) {
      msgApi.warning('当前无可复制的命中结果')
      return
    }
    const content = searchHits.map((hit, index) => {
      const summary = String(hit.chunkSummary || hit.chunkText || '').trim()
      return [
        `[${index + 1}] fileId=${hit.fileId} v${hit.versionNo} chunk=${hit.chunkIndex}`,
        `sourceRef=${hit.sourceRef || '-'} retrieval=${hit.retrievalType || '-'}`,
        `score=${Number(hit.finalScore || hit.score || 0).toFixed(4)} semantic=${Number(hit.semanticScore || 0).toFixed(4)} keyword=${Number(hit.keywordScore || 0).toFixed(4)}`,
        `text=${summary}`,
      ].join('\n')
    }).join('\n\n')
    try {
      await copyText(content)
      msgApi.success('命中摘要已复制')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  const createSessionAndUpload = async () => {
    const bizKey = String(form.getFieldValue('bizKey') || '').trim()
    if (!bizKey) {
      msgApi.warning('请先输入业务标识 bizKey')
      return
    }
    if (!newFileObject) {
      msgApi.warning('请先选择要上传的文件')
      return
    }
    if (isSingleUploadOversized(newFileObject)) {
      msgApi.warning(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
      return
    }

    setUploading(true)
    try {
      const session = await request<UploadSessionDTO>('/api/files/sessions', {
        method: 'POST',
        body: JSON.stringify({ bizKey }),
      })
      const body = new FormData()
      body.append('file', newFileObject)
      await request(`/api/files/sessions/${session.id}/content`, {
        method: 'POST',
        body,
      })
      msgApi.success(`上传成功，fileId=${session.fileId}`)
      setNewFileObject(null)
      setNewFileList([])
      form.resetFields()
      fetchFiles()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '上传失败')
    }
    finally {
      setUploading(false)
    }
  }

  const uploadNewVersion = async (fileID: number) => {
    const selected = newVersionFileMap[fileID]
    if (!selected) {
      msgApi.warning('请先为该文件选择新版本文件')
      return
    }
    if (isSingleUploadOversized(selected)) {
      msgApi.warning(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
      return
    }
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', selected)
      await request(`/api/files/${fileID}/versions`, {
        method: 'POST',
        body,
      })
      msgApi.success(`文件 ${fileID} 新版本上传成功`)
      setNewVersionFileMap(prev => ({ ...prev, [fileID]: null }))
      setNewVersionFileListMap(prev => ({ ...prev, [fileID]: [] }))
      fetchFiles()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '上传新版本失败')
    }
    finally {
      setUploading(false)
    }
  }

  const openVersions = async (fileID: number) => {
    setVersionTargetFileID(fileID)
    setVersionModalOpen(true)
    setVersionLoading(true)
    try {
      const rows = await request<FileVersionDTO[]>(`/api/files/${fileID}/versions`, { method: 'GET' })
      setVersionRows(Array.isArray(rows) ? rows : [])
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载版本失败')
      setVersionRows([])
    }
    finally {
      setVersionLoading(false)
    }
  }

  const resolveVersion = async (fileID: number, versionNo: number) => {
    try {
      const data = await request<FileVersionDTO>(`/api/files/${fileID}/resolve?versionNo=${versionNo}`, { method: 'GET' })
      msgApi.success(`解析成功：v${data.versionNo}，storageKey=${data.storageKey}`)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '解析失败')
    }
  }

  const parseVersion = async (fileID: number, versionNo: number, fromManualButton = false) => {
    const taskKey = getParseTaskKey(fileID, versionNo)
    if (!fromManualButton)
      setParseLoadingMap(prev => ({ ...prev, [taskKey]: true }))
    setParseTargetFileID(fileID)
    setParseTargetVersionNo(versionNo)
    setParseResultModalOpen(true)
    setParseJob(null)
    setParseResult(null)
    setParseResultError('')
    setParseAutoFetchFailed(false)
    setParseResultLoading(true)
    try {
      const query = versionNo > 0 ? `?versionNo=${encodeURIComponent(String(versionNo))}` : ''
      if (!fromManualButton) {
        const enqueueResult = await request<FileParseJobDTO>(`/api/files/${fileID}/parse${query}`, { method: 'POST' })
        setParseJob(enqueueResult)
      }

      let lastJob: FileParseJobDTO | null = null
      for (let index = 0; index < 20; index++) {
        const job = await request<FileParseJobDTO>(`/api/files/${fileID}/parse${query}`, { method: 'GET' })
        lastJob = job
        setParseJob(job)
        if (job.latestResult) {
          setParseResult(job.latestResult)
          setParseResultError('')
          setParseAutoFetchFailed(false)
          msgApi.success(`解析完成：v${job.latestResult.version.versionNo}，strategy=${getParseStrategyLabel(job.latestResult.profile)}，table=${job.latestResult.tableCount}，figure=${job.latestResult.figureCount}`)
          return
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new Error(job.errorMessage || `解析任务${job.status === 'failed' ? '失败' : '已取消'}`)
        }
        if (fromManualButton)
          break
        await sleep(1200)
      }
      if (lastJob && (lastJob.status === 'pending' || lastJob.status === 'running')) {
        setParseResultError(`任务状态：${lastJob.status}，请稍后点击“手动获取解析结果”刷新`)
        setParseAutoFetchFailed(true)
      }
    }
    catch (error) {
      const messageText = error instanceof Error ? error.message : '触发解析失败'
      setParseResultError(messageText)
      setParseAutoFetchFailed(true)
      msgApi.error(messageText)
    }
    finally {
      setParseResultLoading(false)
      if (!fromManualButton)
        setParseLoadingMap(prev => ({ ...prev, [taskKey]: false }))
    }
  }

  const copyParseSummary = async () => {
    if (!parseResult)
      return
    try {
      await copyText(JSON.stringify(parseResult, null, 2))
      msgApi.success('解析摘要已复制')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  const triggerDownload = (fileID: number, versionNo?: number) => {
    const query = versionNo && versionNo > 0 ? `?versionNo=${encodeURIComponent(String(versionNo))}` : ''
    const link = document.createElement('a')
    link.href = `/api/files/${fileID}/download${query}`
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const deleteFile = async (fileID: number) => {
    setDeleteLoadingMap(prev => ({ ...prev, [fileID]: true }))
    try {
      await request<boolean>(`/api/files/${fileID}`, { method: 'DELETE' })
      if (versionModalOpen && versionTargetFileID === fileID) {
        setVersionModalOpen(false)
        setVersionRows([])
        setVersionTargetFileID(0)
      }
      msgApi.success(`文件 ${fileID} 删除成功`)
      await fetchFiles()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '删除文件失败')
    }
    finally {
      setDeleteLoadingMap(prev => ({ ...prev, [fileID]: false }))
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
        <div className="mt-2 text-sm text-gray-500">文件管理仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">新增文件上传</div>
          <Button onClick={fetchFiles} loading={loading}>刷新列表</Button>
        </div>
        <Form form={form} layout="inline">
          <Form.Item label="bizKey" name="bizKey" rules={[{ required: true, message: '请输入 bizKey' }]}>
            <Input placeholder="例如: template_asset" style={{ width: 260 }} />
          </Form.Item>
          <Form.Item label="文件">
            <Upload
              {...createUploadPickerProps(({ file, fileList }) => {
                setNewFileObject(file)
                setNewFileList(fileList)
              }, () => {
                msgApi.warning(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
              })}
              fileList={newFileList}
            >
              <Button>选择文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item>
            <Button type="primary" loading={uploading} onClick={createSessionAndUpload}>创建会话并上传</Button>
          </Form.Item>
        </Form>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-gray-900">文件列表</div>
        <Table<FileDTO>
          rowKey="id"
          loading={loading}
          dataSource={files}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 90 },
            { title: 'bizKey', dataIndex: 'bizKey', width: 180 },
            { title: '最新版本', dataIndex: 'latestVersionNo', width: 100 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (status: FileDTO['status']) => <Tag color={status === 'active' ? 'green' : 'default'}>{status}</Tag>,
            },
            {
              title: '最新文件',
              width: 220,
              render: (_, record) => record.latestVersion?.originName || '-',
            },
            {
              title: '大小',
              width: 120,
              render: (_, record) => formatSize(record.latestVersion?.sizeBytes || 0),
            },
            { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
            {
              title: '操作',
              width: 360,
              render: (_, record) => (
                <Space wrap>
                  <Upload
                    {...createUploadPickerProps(({ file, fileList }) => {
                      setNewVersionFileMap(prev => ({ ...prev, [record.id]: file }))
                      setNewVersionFileListMap(prev => ({ ...prev, [record.id]: fileList }))
                    }, () => {
                      msgApi.warning(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
                    })}
                    fileList={newVersionFileListMap[record.id] || []}
                  >
                    <Button size="small">选择版本文件</Button>
                  </Upload>
                  <Button size="small" loading={uploading} onClick={() => uploadNewVersion(record.id)}>上传新版本</Button>
                  <Button size="small" onClick={() => openVersions(record.id)}>查看版本</Button>
                  <Button size="small" onClick={() => triggerDownload(record.id)}>下载</Button>
                  <Button size="small" onClick={() => resolveVersion(record.id, 0)}>解析最新引用</Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={Boolean(parseLoadingMap[getParseTaskKey(record.id, 0)])}
                    onClick={() => parseVersion(record.id, 0)}
                  >
                    解析
                  </Button>
                  <Popconfirm
                    title="确认删除该文件？"
                    description="会物理删除该文件的全部版本及存储内容，操作不可恢复。"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => deleteFile(record.id)}
                  >
                    <Button size="small" danger loading={Boolean(deleteLoadingMap[record.id])}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-gray-900">索引与检索测试</div>
        <Tabs
          items={[
            {
              key: 'index-test',
              label: '索引测试',
              children: (
                <div className="space-y-3">
                  <Form form={reindexForm} layout="inline" initialValues={{ fileId: '', versionNo: '0' }}>
                    <Form.Item label="fileId" name="fileId">
                      <Input placeholder="例如: 101" style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item label="versionNo" name="versionNo">
                      <Input placeholder="0=最新版本" style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item>
                      <Space wrap>
                        <Button type="primary" loading={reindexLoading} onClick={triggerReindex}>触发重建</Button>
                        <Button loading={statusLoading} onClick={queryIndexStatus}>查询状态</Button>
                        <Button onClick={() => {
                          stopIndexPolling()
                          setIndexStatus(null)
                        }}
                        >
                          清空
                        </Button>
                      </Space>
                    </Form.Item>
                  </Form>

                  {indexStatus
                    ? (
                        <Descriptions bordered size="small" column={2}>
                          <Descriptions.Item label="fileId">{indexStatus.fileId}</Descriptions.Item>
                          <Descriptions.Item label="versionNo">{indexStatus.versionNo}</Descriptions.Item>
                          <Descriptions.Item label="状态">
                            <Tag color={
                              indexStatus.status === 'succeeded'
                                ? 'green'
                                : indexStatus.status === 'failed'
                                  ? 'red'
                                  : indexStatus.status === 'running'
                                    ? 'blue'
                                    : 'gold'
                            }
                            >
                              {indexStatus.status}
                            </Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="重试次数">{indexStatus.retryCount}</Descriptions.Item>
                          <Descriptions.Item label="错误信息" span={2}>{indexStatus.errorMessage || '-'}</Descriptions.Item>
                          <Descriptions.Item label="startedAt">{indexStatus.startedAt || '-'}</Descriptions.Item>
                          <Descriptions.Item label="finishedAt">{indexStatus.finishedAt || '-'}</Descriptions.Item>
                          <Descriptions.Item label="updatedAt" span={2}>{indexStatus.updatedAt || '-'}</Descriptions.Item>
                        </Descriptions>
                      )
                    : null}
                </div>
              ),
            },
            {
              key: 'search-test',
              label: '检索测试',
              children: (
                <div className="space-y-3">
                  <Form
                    form={searchForm}
                    layout="vertical"
                    initialValues={{
                      query: '',
                      topK: '12',
                      minScore: '0.2',
                      fileIds: '',
                      bizKey: '',
                      subjectId: '',
                      projectId: '',
                    }}
                  >
                    <Form.Item label="query" name="query">
                      <Input.TextArea rows={2} placeholder="例如：请总结项目可研中的核心风险" />
                    </Form.Item>
                    <Space wrap>
                      <Form.Item label="topK" name="topK">
                        <Input style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item label="minScore" name="minScore">
                        <Input style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item label="fileIds" name="fileIds">
                        <Input placeholder="逗号分隔，如 101,102" style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item label="bizKey" name="bizKey">
                        <Input placeholder="可选，精确过滤" style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item label="subjectId" name="subjectId">
                        <Input placeholder="可选" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item label="projectId" name="projectId">
                        <Input placeholder="可选" style={{ width: 120 }} />
                      </Form.Item>
                    </Space>
                    <Space wrap>
                      <Button type="primary" loading={searchLoading} onClick={runKnowledgeSearch}>执行检索</Button>
                      <Button onClick={() => {
                        searchForm.setFieldsValue({
                          query: '',
                          topK: '12',
                          minScore: '0.2',
                          fileIds: '',
                          bizKey: '',
                          subjectId: '',
                          projectId: '',
                        })
                        setSearchHits([])
                      }}
                      >
                        重置
                      </Button>
                      <Button onClick={copyKnowledgeHits}>复制命中摘要</Button>
                    </Space>
                  </Form>

                  <Table<KnowledgeSearchHitDTO>
                    rowKey={buildKnowledgeHitRowKey}
                    loading={searchLoading}
                    size="small"
                    dataSource={searchHits}
                    pagination={{ pageSize: 8, showSizeChanger: false }}
                    columns={[
                      { title: 'fileId', dataIndex: 'fileId', width: 90 },
                      { title: '版本', dataIndex: 'versionNo', width: 80 },
                      { title: 'chunk', dataIndex: 'chunkIndex', width: 80 },
                      {
                        title: '召回',
                        dataIndex: 'retrievalType',
                        width: 100,
                        render: (value: string) => {
                          const normalized = String(value || '').toLowerCase()
                          if (normalized === 'hybrid')
                            return <Tag color="purple">hybrid</Tag>
                          if (normalized === 'semantic')
                            return <Tag color="blue">semantic</Tag>
                          if (normalized === 'keyword')
                            return <Tag color="green">keyword</Tag>
                          return <Tag>{value || '-'}</Tag>
                        },
                      },
                      { title: 'semantic', dataIndex: 'semanticScore', width: 100, sorter: (a, b) => a.semanticScore - b.semanticScore, render: (value: number) => Number(value || 0).toFixed(4) },
                      { title: 'keyword', dataIndex: 'keywordScore', width: 100, sorter: (a, b) => a.keywordScore - b.keywordScore, render: (value: number) => Number(value || 0).toFixed(4) },
                      { title: 'final', dataIndex: 'finalScore', width: 100, sorter: (a, b) => a.finalScore - b.finalScore, defaultSortOrder: 'descend', render: (value: number, row) => Number(value || row.score || 0).toFixed(4) },
                      { title: 'sourceRef', dataIndex: 'sourceRef', width: 180, render: (value: string) => value || '-' },
                      { title: '摘要', dataIndex: 'chunkSummary', width: 240, render: (value: string, row) => value || row.chunkText || '-' },
                      { title: '命中文本', dataIndex: 'chunkText', render: (value: string) => value || '-' },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title={`文件 ${versionTargetFileID} 的版本列表`}
        open={versionModalOpen}
        onCancel={() => setVersionModalOpen(false)}
        footer={null}
        width={960}
      >
        <Table<FileVersionDTO>
          rowKey="id"
          loading={versionLoading}
          dataSource={versionRows}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          columns={[
            { title: '版本', dataIndex: 'versionNo', width: 90 },
            { title: '文件名', dataIndex: 'originName', width: 200 },
            { title: 'MIME', dataIndex: 'mimeType', width: 160 },
            { title: '大小', width: 100, render: (_, row) => formatSize(row.sizeBytes) },
            { title: '状态', dataIndex: 'status', width: 100 },
            { title: '上传时间', dataIndex: 'createdAt', width: 180 },
            {
              title: '操作',
              width: 220,
              render: (_, row) => (
                <Space wrap>
                  <Button size="small" onClick={() => triggerDownload(row.fileId, row.versionNo)}>下载</Button>
                  <Button size="small" onClick={() => resolveVersion(row.fileId, row.versionNo)}>解析引用</Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={Boolean(parseLoadingMap[getParseTaskKey(row.fileId, row.versionNo)])}
                    onClick={() => parseVersion(row.fileId, row.versionNo)}
                  >
                    解析
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title={
          parseResult
            ? `解析结果 · 文件 ${parseResult.version.fileId} / v${parseResult.version.versionNo}`
            : parseTargetFileID > 0
              ? `解析结果 · 文件 ${parseTargetFileID} / v${parseTargetVersionNo > 0 ? parseTargetVersionNo : 'latest'}`
              : '解析结果'
        }
        open={parseResultModalOpen}
        onCancel={() => setParseResultModalOpen(false)}
        footer={(
          <Space>
            {(!parseResult || parseAutoFetchFailed) && parseTargetFileID > 0 && (
              <Button
                loading={parseResultLoading}
                onClick={() => parseVersion(parseTargetFileID, parseTargetVersionNo, true)}
              >
                手动获取解析结果
              </Button>
            )}
            <Button key="close" type="primary" onClick={() => setParseResultModalOpen(false)}>
              关闭
            </Button>
          </Space>
        )}
        width={880}
      >
        {parseResultLoading && !parseResult && (
          <div className="mb-3 text-sm text-gray-500">正在解析并获取结果，请稍候...</div>
        )}
        {!parseResult && parseJob && (
          <Descriptions bordered size="small" column={2} className="mb-3">
            <Descriptions.Item label="任务ID">{parseJob.jobId}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={
                parseJob.status === 'succeeded'
                  ? 'green'
                  : parseJob.status === 'failed'
                    ? 'red'
                    : parseJob.status === 'running'
                      ? 'blue'
                      : 'gold'
              }
              >
                {parseJob.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="重试次数">{parseJob.retryCount}</Descriptions.Item>
            <Descriptions.Item label="提取方式">{parseJob.parseStrategy || '-'}</Descriptions.Item>
            <Descriptions.Item label="OCR状态">{parseJob.ocrTaskStatus || (parseJob.ocrPending ? 'pending' : '-')}</Descriptions.Item>
            <Descriptions.Item label="OCR待完成">{parseJob.ocrPending ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="文件类型">{parseJob.fileType || '-'}</Descriptions.Item>
            <Descriptions.Item label="来源类型">{parseJob.sourceType || '-'}</Descriptions.Item>
            <Descriptions.Item label="OCR错误" span={2}>{parseJob.ocrError || '-'}</Descriptions.Item>
            <Descriptions.Item label="错误信息" span={2}>{parseJob.errorMessage || '-'}</Descriptions.Item>
          </Descriptions>
        )}
        {parseResultError && !parseResult && (
          <Alert className="mb-3" type="warning" showIcon message={parseResultError} description="自动获取结果失败，可点击“手动获取解析结果”重试。" />
        )}
        {parseResult
          ? (
              <div className="space-y-4">
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="文件名" span={2}>{parseResult.version.originName}</Descriptions.Item>
                  <Descriptions.Item label="文件ID">{parseResult.version.fileId}</Descriptions.Item>
                  <Descriptions.Item label="版本号">{parseResult.version.versionNo}</Descriptions.Item>
                  <Descriptions.Item label="MIME">{parseResult.version.mimeType}</Descriptions.Item>
                  <Descriptions.Item label="大小">{formatSize(parseResult.version.sizeBytes)}</Descriptions.Item>
                  <Descriptions.Item label="解析策略">{getParseStrategyLabel(parseResult.profile)}</Descriptions.Item>
                  <Descriptions.Item label="来源类型">{parseResult.profile?.sourceType || '-'}</Descriptions.Item>
                  <Descriptions.Item label="文件类型">{parseResult.profile?.fileType || '-'}</Descriptions.Item>
                  <Descriptions.Item label="页数">{parseResult.profile?.pageCount ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="文本层">{formatBoolean(parseResult.profile?.hasTextLayer)}</Descriptions.Item>
                </Descriptions>
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="Slice 数">{parseResult.sliceCount}</Descriptions.Item>
                  <Descriptions.Item label="表格数">{parseResult.tableCount}</Descriptions.Item>
                  <Descriptions.Item label="OCR 状态">{parseResult.ocrTaskStatus || (parseResult.ocrPending ? 'pending' : '-')}</Descriptions.Item>
                  <Descriptions.Item label="OCR Provider">{parseResult.ocrProvider || '-'}</Descriptions.Item>
                  <Descriptions.Item label="OCR 任务ID">{parseResult.ocrTaskId || '-'}</Descriptions.Item>
                  <Descriptions.Item label="OCR 错误">{parseResult.ocrError || '-'}</Descriptions.Item>
                  <Descriptions.Item label="图表候选数">{parseResult.figureCount}</Descriptions.Item>
                  <Descriptions.Item label="表格片段数">{parseResult.fragmentCount}</Descriptions.Item>
                  <Descriptions.Item label="单元格数">{parseResult.cellCount}</Descriptions.Item>
                </Descriptions>
                <div className="flex justify-end">
                  <Button onClick={copyParseSummary}>复制解析摘要</Button>
                </div>
                <ParsedDocumentViewer result={parseResult} />
                <Collapse
                  className="mt-3"
                  items={[
                    {
                      key: 'debug-details',
                      label: '调试明细（原分块/表格/图表候选）',
                      children: (
                        <Tabs
                          items={[
                            {
                              key: 'slices',
                              label: `Slices (${parseResult.slices.length})`,
                              children: (
                                <Table<FileParseSlicePreviewDTO>
                                  rowKey={buildSliceRowKey}
                                  size="small"
                                  pagination={{ pageSize: 6, showSizeChanger: false }}
                                  dataSource={parseResult.slices}
                                  columns={[
                                    { title: '类型', dataIndex: 'sliceType', width: 140 },
                                    { title: '标题', dataIndex: 'title', width: 220, render: value => value || '-' },
                                    { title: '来源', dataIndex: 'sourceRef', width: 160 },
                                    { title: '状态', dataIndex: 'parseStatus', width: 110 },
                                    { title: '置信度', dataIndex: 'confidence', width: 100, render: value => Number(value || 0).toFixed(2) },
                                    { title: '内容摘要', dataIndex: 'cleanText', render: value => value || '-' },
                                  ]}
                                />
                              ),
                            },
                            {
                              key: 'tables',
                              label: `Tables (${parseResult.tables.length})`,
                              children: (
                                <Table<FileParseTablePreviewDTO>
                                  rowKey={buildTableRowKey}
                                  size="small"
                                  pagination={{ pageSize: 6, showSizeChanger: false }}
                                  expandable={{
                                    expandedRowRender: record => (
                                      <Table<FileParseTableRowPreviewDTO>
                                        rowKey={row => `${record.sourceRef}-${row.rowIndex}`}
                                        size="small"
                                        pagination={false}
                                        dataSource={record.previewRows}
                                        columns={[
                                          { title: '行', dataIndex: 'rowIndex', width: 80 },
                                          {
                                            title: '单元格预览',
                                            render: (_, row) => row.cells.map(cell => `${cell.text} (${cell.sourceRef})`).join(' | ') || '-',
                                          },
                                        ]}
                                      />
                                    ),
                                    rowExpandable: record => record.previewRows.length > 0,
                                  }}
                                  dataSource={parseResult.tables}
                                  columns={[
                                    { title: '标题', dataIndex: 'title', width: 220 },
                                    { title: '来源', dataIndex: 'sourceRef', width: 160 },
                                    { title: '列数', dataIndex: 'columnCount', width: 90 },
                                    { title: '表头行', dataIndex: 'headerRowCount', width: 90 },
                                    { title: '页码', render: (_, row) => row.pageStart === row.pageEnd ? `第${row.pageStart}页` : `第${row.pageStart}-${row.pageEnd}页`, width: 120 },
                                  ]}
                                />
                              ),
                            },
                            {
                              key: 'figures',
                              label: `图表候选 (${parseResult.figures.length})`,
                              children: (
                                <Table<FileParseFigurePreviewDTO>
                                  rowKey={buildFigureRowKey}
                                  size="small"
                                  pagination={{ pageSize: 6, showSizeChanger: false }}
                                  expandable={{
                                    expandedRowRender: record => (
                                      <Table<FileParseFigureRegionPreviewDTO>
                                        rowKey={row => `${record.sourceRef}-${row.rowIndex}-${row.region}-${row.text}`}
                                        size="small"
                                        pagination={false}
                                        dataSource={record.regions}
                                        columns={[
                                          { title: '行', dataIndex: 'rowIndex', width: 80 },
                                          { title: '区域', dataIndex: 'region', width: 100, render: value => formatFigureRegion(value) },
                                          { title: '来源', dataIndex: 'sourceRef', width: 160 },
                                          { title: '节点文本', dataIndex: 'text', render: value => value || '-' },
                                        ]}
                                      />
                                    ),
                                    rowExpandable: record => record.regions.length > 0,
                                  }}
                                  dataSource={parseResult.figures}
                                  columns={[
                                    { title: '标题', dataIndex: 'title', width: 260 },
                                    { title: '图示类型', dataIndex: 'figureType', width: 120, render: value => formatFigureType(value) },
                                    { title: '来源', dataIndex: 'sourceRef', width: 160 },
                                    { title: '状态', dataIndex: 'parseStatus', width: 110 },
                                    { title: '置信度', dataIndex: 'confidence', width: 100, render: value => Number(value || 0).toFixed(2) },
                                    { title: '内容摘要', dataIndex: 'cleanText', render: value => value || '-' },
                                  ]}
                                />
                              ),
                            },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </div>
            )
          : null}
      </Modal>
    </div>
  )
}
