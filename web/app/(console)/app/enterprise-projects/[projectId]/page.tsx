'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Descriptions, Popconfirm, Space, Tag, Upload, message } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import ProjectWorkflowSteps from '@/components/enterprise-projects/ProjectWorkflowSteps'
import { MAX_SINGLE_UPLOAD_TEXT, isSingleUploadOversized } from '@/lib/upload-limit'

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

type UploadResult = {
  projectId: number
  items: Array<{ id: number }>
}

type RemoveUploadedFileResult = {
  projectId: number
  caseFileId: number
  message: string
}

const { Dragger } = Upload

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const parseStatusColor = (status: string) => {
  if (status === 'completed')
    return 'success'
  if (status === 'failed')
    return 'error'
  if (status === 'processing')
    return 'processing'
  return 'default'
}

const parseProcessStatusColor = (status: string) => {
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

export default function EnterpriseProjectPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingCaseFileIDs, setRemovingCaseFileIDs] = useState<Record<number, boolean>>({})
  const [detail, setDetail] = useState<EnterpriseProjectDetailDTO | null>(null)
  const [uploadFilesByCategory, setUploadFilesByCategory] = useState<Record<string, UploadFile[]>>({})
  const [showUploaderByCategory, setShowUploaderByCategory] = useState<Record<string, boolean>>({})
  const projectId = Number(params?.projectId || 0)

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
      router.push('/?redirect=/app/enterprises')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const loadDetail = async () => {
    if (!projectId)
      return
    setLoading(true)
    try {
      const data = await request<EnterpriseProjectDetailDTO>(`/api/enterprise-projects/${projectId}`, { method: 'GET' })
      setDetail(data)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载项目详情失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetail()
  }, [projectId])

  const categories = useMemo(() => Array.isArray(detail?.categories) ? detail.categories : [], [detail?.categories])
  const uploadedFilesByCategory = useMemo(() => {
    const source = Array.isArray(detail?.uploadedFilesByCategory) ? detail.uploadedFilesByCategory : []
    const map = new Map<string, EnterpriseProjectDetailDTO['uploadedFilesByCategory'][number]['items']>()
    for (const group of source) {
      const key = (group?.category || '').trim()
      if (!key)
        continue
      map.set(key, Array.isArray(group?.items) ? group.items : [])
    }
    return map
  }, [detail?.uploadedFilesByCategory])
  const getUploadedItemsForCategory = (category: CategoryItem) => {
    const directName = (category.name || '').trim()
    const directKey = (category.key || '').trim()
    const candidates = [directName, directKey].filter(Boolean)
    for (const candidate of candidates) {
      const items = uploadedFilesByCategory.get(candidate)
      if (Array.isArray(items) && items.length >= 0)
        return items
    }
    return [] as EnterpriseProjectDetailDTO['uploadedFilesByCategory'][number]['items']
  }

  const saveAndUploadAll = async () => {
    if (!projectId)
      return
    if (categories.length === 0) {
      msgApi.warning('当前模板未配置分类，无法上传')
      return
    }
    const requiredMissing = categories.find((category) => {
      if (!category.required)
        return false
      const categoryKey = category.key || category.name
      const localCount = (uploadFilesByCategory[categoryKey] || []).length
      const uploadedCount = getUploadedItemsForCategory(category).length
      return localCount + uploadedCount === 0
    })
    if (requiredMissing) {
      msgApi.warning(`请先补充必填分类：${requiredMissing.name}`)
      return
    }

    const readyCategories = categories
      .map((category) => {
        const categoryKey = category.key || category.name
        const files = (uploadFilesByCategory[categoryKey] || [])
          .map(item => item.originFileObj)
          .filter(Boolean) as File[]
        return { category, files }
      })
      .filter(item => item.files.length > 0)
    const oversizedItem = readyCategories
      .flatMap(item => item.files)
      .find(file => isSingleUploadOversized(file))
    if (oversizedItem) {
      msgApi.warning(`存在超限文件（${oversizedItem.name}），单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
      return
    }
    const hasUploadedHistory = categories.some(category => getUploadedItemsForCategory(category).length > 0)

    if (readyCategories.length === 0) {
      if (hasUploadedHistory) {
        msgApi.info('当前没有待上传文件，可继续添加附件或进入文件确认')
        return
      }
      msgApi.warning('请先添加附件，再点击保存')
      return
    }

    setSaving(true)
    try {
      let uploadedCount = 0
      for (const item of readyCategories) {
        const formData = new FormData()
        formData.append('manualCategory', item.category.name)
        for (const file of item.files)
          formData.append('files', file)
        await request<UploadResult>(`/api/enterprise-projects/${projectId}/files`, {
          method: 'POST',
          body: formData,
        })
        uploadedCount += item.files.length
      }
      setUploadFilesByCategory({})
      setShowUploaderByCategory({})
      await loadDetail()
      msgApi.success(`已上传 ${uploadedCount} 个文件，可继续添加或移除附件`)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '提交上传失败')
    }
    finally {
      setSaving(false)
    }
  }

  const removeUploadedFile = async (caseFileID: number) => {
    if (!projectId || !caseFileID)
      return
    setRemovingCaseFileIDs(prev => ({ ...prev, [caseFileID]: true }))
    try {
      const result = await request<RemoveUploadedFileResult>(`/api/enterprise-projects/${projectId}/files/${caseFileID}`, { method: 'DELETE' })
      msgApi.success(result?.message || '已移除附件')
      await loadDetail()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '移除附件失败')
    }
    finally {
      setRemovingCaseFileIDs(prev => {
        const next = { ...prev }
        delete next[caseFileID]
        return next
      })
    }
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <ProjectWorkflowSteps projectId={projectId} currentStep={0} />
      <Card
        title="新增项目-附件准备"
        extra={(
          <Space>
            <Button onClick={() => router.push('/app/enterprise-projects')}>项目列表</Button>
            <Button onClick={() => router.push('/app/enterprises')}>企业列表</Button>
            <Button onClick={loadDetail} loading={loading}>刷新详情</Button>
            <Button type="primary" loading={saving} onClick={saveAndUploadAll}>保存并上传</Button>
          </Space>
        )}
      >
        {detail && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="项目">{detail.project.name}</Descriptions.Item>
            <Descriptions.Item label="项目状态"><Tag color={parseStatusColor(detail.project.status)}>{detail.project.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="企业">{detail.enterprise.shortName}</Descriptions.Item>
            <Descriptions.Item label="统一信用代码">{detail.enterprise.unifiedCreditCode}</Descriptions.Item>
            <Descriptions.Item label="报告模板">{detail.template.name}</Descriptions.Item>
            <Descriptions.Item label="模板键">{detail.template.templateKey}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Card title="按模板分类添加附件（保存后统一上传并排队处理）">
        <div className="space-y-3">
          {categories.length === 0 && <div className="text-sm text-gray-500">当前模板未配置分类。</div>}
          {categories.map((category) => {
            const categoryKey = category.key || category.name
            const fileList = uploadFilesByCategory[categoryKey] || []
            const uploadedItems = getUploadedItemsForCategory(category)
            const totalCount = fileList.length + uploadedItems.length
            const showUploader = Boolean(showUploaderByCategory[categoryKey]) || uploadedItems.length === 0 || fileList.length > 0
            return (
              <div key={categoryKey} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">
                    {category.name}
                    {category.required ? <Tag color="blue" className="ml-2">必填</Tag> : null}
                  </div>
                  <Space size={4}>
                    <Tag>{totalCount} 个附件</Tag>
                    <Tag>已上传 {uploadedItems.length}</Tag>
                    <Tag>待上传 {fileList.length}</Tag>
                  </Space>
                </div>
                {uploadedItems.length > 0 && (
                  <div className="mb-2 rounded-md border border-gray-100 bg-gray-50 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-xs font-medium text-gray-600">已上传附件</div>
                      <Space size={4}>
                        {!showUploader && (
                          <Button
                            size="small"
                            type="link"
                            onClick={() => setShowUploaderByCategory(prev => ({ ...prev, [categoryKey]: true }))}
                          >
                            继续添加
                          </Button>
                        )}
                        {showUploader && (
                          <Button
                            size="small"
                            type="link"
                            onClick={() => setShowUploaderByCategory(prev => ({ ...prev, [categoryKey]: false }))}
                          >
                            收起添加
                          </Button>
                        )}
                      </Space>
                    </div>
                    <div className="space-y-1">
                      {uploadedItems.map(item => (
                        <div key={`${item.caseFileId}-${item.fileId}-${item.versionNo}`} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium text-gray-800">{item.fileName}</span>
                          <Tag color={parseProcessStatusColor(item.parseStatus)}>{item.parseStatus || '-'}</Tag>
                          <Tag color={parseProcessStatusColor(item.vectorStatus)}>{item.vectorStatus || '-'}</Tag>
                          <span className="text-gray-500">{item.currentStage || '-'}</span>
                          {item.lastError ? <span className="text-red-500">{item.lastError}</span> : null}
                          <Popconfirm
                            title="确认移除该附件？"
                            description="移除后该附件将不再参与当前项目处理。"
                            okText="移除"
                            cancelText="取消"
                            onConfirm={() => removeUploadedFile(item.caseFileId)}
                          >
                            <Button
                              size="small"
                              type="link"
                              danger
                              loading={Boolean(removingCaseFileIDs[item.caseFileId])}
                            >
                              移除
                            </Button>
                          </Popconfirm>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showUploader && (
                  <Dragger
                    multiple
                    beforeUpload={(file) => {
                      if (isSingleUploadOversized(file as File)) {
                        msgApi.warning(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
                        return Upload.LIST_IGNORE
                      }
                      return false
                    }}
                    fileList={fileList}
                    onChange={({ fileList: nextFileList }) => {
                      const filtered = nextFileList
                        .filter(item => !isSingleUploadOversized(item.originFileObj as File | undefined))
                      const ignoredCount = nextFileList.length - filtered.length
                      if (ignoredCount > 0)
                        msgApi.warning(`已忽略 ${ignoredCount} 个超限文件，单文件上限 ${MAX_SINGLE_UPLOAD_TEXT}`)
                      const normalized = filtered.slice(-50)
                      setUploadFilesByCategory(prev => ({ ...prev, [categoryKey]: normalized }))
                    }}
                    showUploadList={{ showRemoveIcon: true }}
                    style={{ background: '#fafafa' }}
                  >
                    <div className="py-2">
                      <div className="mb-1 text-sm text-gray-700">拖拽文件到此处，或点击此区域添加文件</div>
                      <div className="text-xs text-gray-500">当前分类：{category.name}</div>
                    </div>
                  </Dragger>
                )}
                {!showUploader && uploadedItems.length > 0 && (
                  <div className="rounded border border-dashed border-gray-200 p-2 text-xs text-gray-500">
                    当前分类已上传 {uploadedItems.length} 个附件，可点击“继续添加”追加上传。
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
