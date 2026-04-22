'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Collapse, Descriptions, Space, Tag, message } from 'antd'
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
}

type EnterpriseProjectVectorConfirmResultDTO = {
  projectId: number
  total: number
  enqueued: number
  skipped: number
  failed: number
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

export default function EnterpriseProjectConfirmPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [editingCaseFileID, setEditingCaseFileID] = useState(0)
  const [detail, setDetail] = useState<EnterpriseProjectDetailDTO | null>(null)
  const [caseDetail, setCaseDetail] = useState<ReportCaseDetailDTO | null>(null)
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
      } else {
        setCaseDetail(null)
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
      router.push(`/app/enterprise-projects/${projectId}/finance`)
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '向量确认失败')
    } finally {
      setConfirming(false)
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
                      <span
                        className={item.parseStatus === 'succeeded' && isTextualCaseFile(item.caseFileId) ? 'cursor-pointer font-medium text-blue-600' : 'font-medium'}
                        onClick={() => {
                          if (item.parseStatus !== 'succeeded' || !isTextualCaseFile(item.caseFileId))
                            return
                          setEditingCaseFileID(prev => prev === item.caseFileId ? 0 : item.caseFileId)
                        }}
                      >
                        {item.fileName}
                      </span>
                      <Tag color={parseStatusColor(item.parseStatus)}>{item.parseStatus}</Tag>
                      {shouldShowVectorStatus(item.vectorStatus) ? <Tag color={parseStatusColor(item.vectorStatus)}>{item.vectorStatus}</Tag> : null}
                      <span className="text-xs text-gray-500">{normalizeStageText(item.currentStage || '-')}</span>
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

                      {item.parseStatus === 'succeeded' && isTextualCaseFile(item.caseFileId) && editingCaseFileID === item.caseFileId && (
                        <CaseFileBlockEditor
                          projectId={projectId}
                          caseFileId={item.caseFileId}
                          fileName={item.fileName}
                          enabled
                        />
                      )}
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
