'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Collapse, Descriptions, Input, Space, Tag, message } from 'antd'
import { formatShanghaiDateTime } from '@/lib/time'
import ProjectWorkflowSteps from '@/components/enterprise-projects/ProjectWorkflowSteps'
import CaseFileBlockEditor from '@/components/enterprise-projects/CaseFileBlockEditor'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type CategoryItem = {
  key: string
  name: string
  required?: boolean
}

type EnterpriseProjectDetailDTO = {
  project: {
    id: number
    enterpriseId: number
    templateId: number
    reportCaseId: number
    name: string
    status: string
  }
  enterprise: {
    id: number
    shortName: string
    unifiedCreditCode: string
  }
  template: {
    id: number
    name: string
    templateKey: string
  }
  categories: CategoryItem[]
  uploadedFilesByCategory: Array<{
    category: string
    items: Array<{
      caseFileId: number
      fileId: number
      versionNo: number
      fileName: string
      manualCategory: string
      parseStatus: string
      vectorStatus: string
      currentStage: string
      lastError: string
      lastUpdatedTime: string
    }>
  }>
}

type DocumentSliceDTO = {
  id: number
  caseFileId: number
  fileId: number
  versionNo: number
  pageStart: number
  pageEnd: number
  sliceType: string
  sourceType: string
  title: string
  titleLevel: number
  cleanText: string
  rawText: string
  bbox: unknown
  createdAt: string
}

type DocumentTableDTO = {
  id: number
  caseFileId: number
  fileId: number
  versionNo: number
  title: string
  pageStart: number
  pageEnd: number
  headerRowCount: number
  columnCount: number
  sourceType: string
  parseStatus: string
  isCrossPage: boolean
  bbox: unknown
  createdAt: string
}

type DocumentTableFragmentDTO = {
  id: number
  caseFileId: number
  fileId: number
  versionNo: number
  tableId: number
  pageNo: number
  partIndex: number
  totalParts: number
  summaryText: string
  tableJson: unknown
  createdAt: string
}

type DocumentTableCellDTO = {
  id: number
  caseFileId: number
  fileId: number
  versionNo: number
  tableId: number
  rowIndex: number
  colIndex: number
  rowSpan: number
  colSpan: number
  rawText: string
  normalizedValue: string
  dataType: string
  confidence: number
  bbox: unknown
  createdAt: string
}

type ReportCaseDetailDTO = {
  case: { id: number }
  files: Array<{
    id: number
    fileType: string
    sourceType: string
    finalSubCategory: string
    updatedAt: string
  }>
  slices: DocumentSliceDTO[]
  tables: DocumentTableDTO[]
  tableFragments: DocumentTableFragmentDTO[]
  tableCells: DocumentTableCellDTO[]
}

type EnterpriseProjectVectorConfirmResultDTO = {
  projectId: number
  total: number
  enqueued: number
  skipped: number
  failed: number
}

type EnterpriseProjectFileManualAdjustResultDTO = {
  projectId: number
  caseFileId: number
  finalSubCategory: string
  updatedAt: string
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const parseStatusColor = (status: string) => {
  if (status === 'succeeded' || status === 'completed')
    return 'success'
  if (status === 'failed' || status === 'status_error')
    return 'error'
  if (status === 'cancelled')
    return 'warning'
  if (status === 'running' || status === 'processing')
    return 'processing'
  return 'default'
}

const shouldShowVectorStatus = (status: string) => {
  return Boolean(status && status !== 'not_enqueued')
}

const normalizeStageText = (value: string) => {
  if (value === '向量未入队')
    return '待确认'
  return value
}

const safeJSONString = (value: unknown) => {
  try {
    if (value == null)
      return ''
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function EnterpriseProjectConfirmPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [savingCaseFileID, setSavingCaseFileID] = useState(0)
  const [detail, setDetail] = useState<EnterpriseProjectDetailDTO | null>(null)
  const [caseDetail, setCaseDetail] = useState<ReportCaseDetailDTO | null>(null)
  const [manualAdjustByCaseFileID, setManualAdjustByCaseFileID] = useState<Record<number, string>>({})
  const projectId = Number(params?.projectId || 0)

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, { ...init, headers, credentials: 'include' })
    const payload = await response.json() as ApiResponse<T>
    if (response.status === 401) {
      router.push('/?redirect=/app/enterprise-projects')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadData = async () => {
    if (!projectId)
      return
    setLoading(true)
    try {
      const detailData = await request<EnterpriseProjectDetailDTO>(`/api/enterprise-projects/${projectId}`, { method: 'GET' })
      setDetail(detailData)
      if (detailData?.project?.reportCaseId > 0) {
        const reportCaseData = await request<ReportCaseDetailDTO>(`/api/report-cases/${detailData.project.reportCaseId}`, { method: 'GET' })
        setCaseDetail(reportCaseData)
        const nextManualValues: Record<number, string> = {}
        for (const file of reportCaseData?.files || [])
          nextManualValues[file.id] = String(file?.finalSubCategory || '')
        setManualAdjustByCaseFileID(nextManualValues)
      } else {
        setCaseDetail(null)
        setManualAdjustByCaseFileID({})
      }
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载文件确认数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [projectId])

  const groupedFiles = useMemo(() => {
    const categoryOrder = new Map<string, number>()
    ;(detail?.categories || []).forEach((item, index) => {
      const key = (item?.name || '').trim()
      if (key)
        categoryOrder.set(key, index)
    })

    const groups = new Map<string, EnterpriseProjectDetailDTO['uploadedFilesByCategory'][number]['items']>()
    ;(detail?.uploadedFilesByCategory || []).forEach((group) => {
      const category = (group?.category || '').trim() || '未分类'
      const current = groups.get(category) || []
      groups.set(category, current.concat(Array.isArray(group.items) ? group.items : []))
    })

    return Array.from(groups.entries())
      .sort((a, b) => {
        const leftOrder = categoryOrder.get(a[0]) ?? Number.MAX_SAFE_INTEGER
        const rightOrder = categoryOrder.get(b[0]) ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder)
          return leftOrder - rightOrder
        return a[0].localeCompare(b[0], 'zh-CN')
      })
      .map(([category, items]) => ({ category, items }))
  }, [detail?.categories, detail?.uploadedFilesByCategory])

  const caseSlices = caseDetail?.slices || []
  const caseTables = caseDetail?.tables || []
  const caseTableFragments = caseDetail?.tableFragments || []
  const caseTableCells = caseDetail?.tableCells || []
  const caseFiles = caseDetail?.files || []
  const caseFileMetaMap = useMemo(() => {
    const map = new Map<number, { fileType: string, sourceType: string }>()
    for (const file of caseFiles) {
      map.set(file.id, {
        fileType: String(file?.fileType || ''),
        sourceType: String(file?.sourceType || ''),
      })
    }
    return map
  }, [caseFiles])
  const caseFileFinalSubMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const file of caseFiles)
      map.set(file.id, String(file?.finalSubCategory || ''))
    return map
  }, [caseFiles])
  const isTextualCaseFile = (caseFileId: number) => {
    const meta = caseFileMetaMap.get(caseFileId)
    if (!meta)
      return false
    const sourceType = meta.sourceType.trim().toLowerCase()
    const fileType = meta.fileType.trim().toLowerCase()
    if (sourceType === 'native_text' || sourceType === 'text_layer' || sourceType === 'ocr')
      return true
    return ['txt', 'md', 'markdown', 'doc', 'docx', 'pdf'].includes(fileType)
  }
  const matchByCaseFileOrVersion = <T extends { caseFileId: number, fileId: number, versionNo: number }>(rows: T[], item: { caseFileId: number, fileId: number, versionNo: number }) => {
    const byCaseFile = rows.filter(row => row.caseFileId === item.caseFileId)
    if (byCaseFile.length > 0)
      return byCaseFile
    return rows.filter(row => row.fileId === item.fileId && row.versionNo === item.versionNo)
  }

  const confirmableCount = useMemo(() => {
    let count = 0
    for (const group of groupedFiles) {
      for (const item of group.items) {
        if (item.parseStatus !== 'succeeded')
          continue
        if (item.vectorStatus === 'pending' || item.vectorStatus === 'running' || item.vectorStatus === 'succeeded')
          continue
        count++
      }
    }
    return count
  }, [groupedFiles])

  const confirmVectorization = async () => {
    if (!projectId)
      return
    setConfirming(true)
    try {
      const result = await request<EnterpriseProjectVectorConfirmResultDTO>(`/api/enterprise-projects/${projectId}/confirm-vectorization`, { method: 'POST' })
      msgApi.success(`已处理 ${result.total} 个文件：入队 ${result.enqueued}，跳过 ${result.skipped}，失败 ${result.failed}`)
      router.push(`/app/enterprise-projects/${projectId}/processing`)
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '向量确认失败')
    } finally {
      setConfirming(false)
    }
  }

  const saveManualAdjust = async (caseFileId: number) => {
    if (!projectId || caseFileId <= 0)
      return
    const finalSubCategory = String(manualAdjustByCaseFileID[caseFileId] || '').trim()
    setSavingCaseFileID(caseFileId)
    try {
      const result = await request<EnterpriseProjectFileManualAdjustResultDTO>(
        `/api/enterprise-projects/${projectId}/files/${caseFileId}/manual-adjust`,
        {
          method: 'PATCH',
          body: JSON.stringify({ finalSubCategory }),
        },
      )
      setManualAdjustByCaseFileID(prev => ({ ...prev, [caseFileId]: String(result?.finalSubCategory || '') }))
      setCaseDetail((prev) => {
        if (!prev)
          return prev
        return {
          ...prev,
          files: (prev.files || []).map(file => file.id === caseFileId
            ? { ...file, finalSubCategory: String(result?.finalSubCategory || ''), updatedAt: result?.updatedAt || file.updatedAt }
            : file),
        }
      })
      msgApi.success('当前文件人工调整已保存')
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '保存人工调整失败')
    } finally {
      setSavingCaseFileID(0)
    }
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <ProjectWorkflowSteps projectId={projectId} currentStep={1} />
      <Card
        title="文件确认"
        extra={(
          <Space>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}`)}>返回文件录入</Button>
            <Button onClick={loadData} loading={loading}>刷新</Button>
            <Button type="primary" onClick={confirmVectorization} loading={confirming} disabled={confirmableCount <= 0}>
              一键确认全部并开始向量处理
            </Button>
          </Space>
        )}
      >
        {detail && (
          <Descriptions bordered size="small" column={2} className="mb-3">
            <Descriptions.Item label="项目">{detail.project.name}</Descriptions.Item>
            <Descriptions.Item label="项目状态"><Tag color={parseStatusColor(detail.project.status)}>{detail.project.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="企业">{detail.enterprise.shortName}</Descriptions.Item>
            <Descriptions.Item label="报告模板">{detail.template.name}</Descriptions.Item>
            <Descriptions.Item label="可确认文件数">{confirmableCount}</Descriptions.Item>
            <Descriptions.Item label="报告实例ID">{detail.project.reportCaseId}</Descriptions.Item>
          </Descriptions>
        )}

        <Collapse
          items={groupedFiles.map(group => ({
            key: group.category,
            label: (
              <div className="flex items-center gap-2">
                <span>{group.category}</span>
                <Tag>{group.items.length} 个文件</Tag>
              </div>
            ),
            children: (
              <Collapse
                items={group.items.map(item => ({
                  key: `${item.caseFileId}-${item.fileId}-${item.versionNo}`,
                  label: (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.fileName}</span>
                      <Tag color={parseStatusColor(item.parseStatus)}>{item.parseStatus}</Tag>
                      {shouldShowVectorStatus(item.vectorStatus) ? <Tag color={parseStatusColor(item.vectorStatus)}>{item.vectorStatus}</Tag> : null}
                      <span className="text-xs text-gray-500">{normalizeStageText(item.currentStage || '-')}</span>
                      <Button
                        size="small"
                        type="link"
                        loading={savingCaseFileID === item.caseFileId}
                        disabled={String(manualAdjustByCaseFileID[item.caseFileId] || '').trim() === String(caseFileFinalSubMap.get(item.caseFileId) || '').trim()}
                        onClick={(event) => {
                          event.stopPropagation()
                          saveManualAdjust(item.caseFileId)
                        }}
                      >
                        保存
                      </Button>
                    </div>
                  ),
                  children: (
                    <div className="space-y-3 text-xs">
                      <Descriptions bordered size="small" column={2}>
                        <Descriptions.Item label="文件ID">{item.fileId}</Descriptions.Item>
                        <Descriptions.Item label="版本">{item.versionNo}</Descriptions.Item>
                        <Descriptions.Item label="解析状态"><Tag color={parseStatusColor(item.parseStatus)}>{item.parseStatus}</Tag></Descriptions.Item>
                        {shouldShowVectorStatus(item.vectorStatus) ? <Descriptions.Item label="向量状态"><Tag color={parseStatusColor(item.vectorStatus)}>{item.vectorStatus}</Tag></Descriptions.Item> : null}
                        <Descriptions.Item label="最后更新时间">{formatShanghaiDateTime(item.lastUpdatedTime)}</Descriptions.Item>
                        <Descriptions.Item label="错误信息">{item.lastError || '-'}</Descriptions.Item>
                      </Descriptions>

                      <Card size="small" title="人工调整">
                        <Space>
                          <Input
                            value={manualAdjustByCaseFileID[item.caseFileId] ?? ''}
                            placeholder="请输入最终子分类（可留空）"
                            style={{ width: 260 }}
                            onChange={event => setManualAdjustByCaseFileID(prev => ({ ...prev, [item.caseFileId]: event.target.value }))}
                          />
                          <Button
                            type="primary"
                            loading={savingCaseFileID === item.caseFileId}
                            disabled={String(manualAdjustByCaseFileID[item.caseFileId] || '').trim() === String(caseFileFinalSubMap.get(item.caseFileId) || '').trim()}
                            onClick={() => saveManualAdjust(item.caseFileId)}
                          >
                            保存当前文件
                          </Button>
                        </Space>
                      </Card>

                      {item.parseStatus === 'succeeded' && isTextualCaseFile(item.caseFileId) && (
                        <CaseFileBlockEditor
                          projectId={projectId}
                          caseFileId={item.caseFileId}
                          enabled
                        />
                      )}

                      <Card size="small" title={`切片明细 (${matchByCaseFileOrVersion(caseSlices, item).length})`}>
                        <div className="max-h-64 overflow-auto space-y-2">
                          {matchByCaseFileOrVersion(caseSlices, item).map(slice => (
                            <div key={slice.id} className="rounded border border-gray-100 p-2">
                              <div className="mb-1 flex flex-wrap gap-2">
                                <Tag>{slice.sliceType || '-'}</Tag>
                                <Tag>{slice.sourceType || '-'}</Tag>
                                <Tag>p{slice.pageStart}-{slice.pageEnd}</Tag>
                                {slice.title ? <Tag color="blue">{slice.title}</Tag> : null}
                              </div>
                              <div className="whitespace-pre-wrap break-words text-gray-700">{slice.cleanText || slice.rawText || '-'}</div>
                            </div>
                          ))}
                          {matchByCaseFileOrVersion(caseSlices, item).length === 0 && <div className="text-gray-500">暂无切片明细</div>}
                        </div>
                      </Card>

                      <Card size="small" title={`表格明细 (${matchByCaseFileOrVersion(caseTables, item).length})`}>
                        <div className="max-h-64 overflow-auto space-y-2">
                          {matchByCaseFileOrVersion(caseTables, item).map(table => (
                            <div key={table.id} className="rounded border border-gray-100 p-2">
                              <div className="mb-1 flex flex-wrap gap-2">
                                <Tag color="blue">{table.title || `表格-${table.id}`}</Tag>
                                <Tag>p{table.pageStart}-{table.pageEnd}</Tag>
                                <Tag>列{table.columnCount}</Tag>
                                <Tag>表头{table.headerRowCount}</Tag>
                              </div>
                              <pre className="overflow-auto rounded bg-gray-50 p-2">{safeJSONString(table.bbox)}</pre>
                            </div>
                          ))}
                          {matchByCaseFileOrVersion(caseTables, item).length === 0 && <div className="text-gray-500">暂无表格明细</div>}
                        </div>
                      </Card>

                      <Card size="small" title={`表格分片 (${matchByCaseFileOrVersion(caseTableFragments, item).length})`}>
                        <div className="max-h-64 overflow-auto space-y-2">
                          {matchByCaseFileOrVersion(caseTableFragments, item).map(fragment => (
                            <div key={fragment.id} className="rounded border border-gray-100 p-2">
                              <div className="mb-1 flex flex-wrap gap-2">
                                <Tag>table#{fragment.tableId}</Tag>
                                <Tag>p{fragment.pageNo}</Tag>
                                <Tag>{fragment.partIndex + 1}/{fragment.totalParts}</Tag>
                              </div>
                              <div className="mb-2 whitespace-pre-wrap break-words text-gray-700">{fragment.summaryText || '-'}</div>
                              <pre className="overflow-auto rounded bg-gray-50 p-2">{safeJSONString(fragment.tableJson)}</pre>
                            </div>
                          ))}
                          {matchByCaseFileOrVersion(caseTableFragments, item).length === 0 && <div className="text-gray-500">暂无表格分片</div>}
                        </div>
                      </Card>

                      <Card size="small" title={`单元格明细 (${matchByCaseFileOrVersion(caseTableCells, item).length})`}>
                        <div className="max-h-64 overflow-auto space-y-2">
                          {matchByCaseFileOrVersion(caseTableCells, item).map(cell => (
                            <div key={cell.id} className="rounded border border-gray-100 p-2">
                              <div className="mb-1 flex flex-wrap gap-2">
                                <Tag>table#{cell.tableId}</Tag>
                                <Tag>r{cell.rowIndex + 1}c{cell.colIndex + 1}</Tag>
                                <Tag>span {cell.rowSpan}x{cell.colSpan}</Tag>
                                <Tag>{cell.dataType || '-'}</Tag>
                              </div>
                              <div className="whitespace-pre-wrap break-words text-gray-700">{cell.normalizedValue || cell.rawText || '-'}</div>
                            </div>
                          ))}
                          {matchByCaseFileOrVersion(caseTableCells, item).length === 0 && <div className="text-gray-500">暂无单元格明细</div>}
                        </div>
                      </Card>
                    </div>
                  ),
                }))}
              />
            ),
          }))}
        />
      </Card>
    </div>
  )
}
