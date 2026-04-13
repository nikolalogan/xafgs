'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Descriptions, Form, Input, Modal, Space, Table, Tabs, Tag, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'

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
  sliceCount: number
  tableCount: number
  figureCount: number
  fragmentCount: number
  cellCount: number
  slices: FileParseSlicePreviewDTO[]
  tables: FileParseTablePreviewDTO[]
  figures: FileParseFigurePreviewDTO[]
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

const buildSliceRowKey = (row: FileParseSlicePreviewDTO) => `${row.sliceType}-${row.sourceRef}-${row.title || 'untitled'}-${row.pageStart}-${row.pageEnd}`

const buildTableRowKey = (row: FileParseTablePreviewDTO) => `${row.title}-${row.sourceRef}-${row.pageStart}-${row.pageEnd}`

const buildFigureRowKey = (row: FileParseFigurePreviewDTO) => `${row.figureType}-${row.sourceRef}-${row.title}-${row.pageNo}`

export default function FilesPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()

  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<FileDTO[]>([])

  const [uploading, setUploading] = useState(false)
  const [newFileObject, setNewFileObject] = useState<File | null>(null)
  const [newVersionFileMap, setNewVersionFileMap] = useState<Record<number, File | null>>({})
  const [form] = Form.useForm()

  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionRows, setVersionRows] = useState<FileVersionDTO[]>([])
  const [versionTargetFileID, setVersionTargetFileID] = useState<number>(0)
  const [parseLoadingMap, setParseLoadingMap] = useState<Record<string, boolean>>({})
  const [parseResultModalOpen, setParseResultModalOpen] = useState(false)
  const [parseResult, setParseResult] = useState<FileParseResultDTO | null>(null)

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

  const parseVersion = async (fileID: number, versionNo: number) => {
    const taskKey = getParseTaskKey(fileID, versionNo)
    setParseLoadingMap(prev => ({ ...prev, [taskKey]: true }))
    try {
      const data = await request<FileParseResultDTO>(`/api/files/${fileID}/parse?versionNo=${versionNo}`, { method: 'POST' })
      setParseResult(data)
      setParseResultModalOpen(true)
      msgApi.success(`解析完成：v${data.version.versionNo}，strategy=${getParseStrategyLabel(data.profile)}，table=${data.tableCount}，figure=${data.figureCount}`)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '触发解析失败')
    }
    finally {
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
            <input
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                setNewFileObject(file)
              }}
            />
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
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null
                      setNewVersionFileMap(prev => ({ ...prev, [record.id]: file }))
                    }}
                  />
                  <Button size="small" loading={uploading} onClick={() => uploadNewVersion(record.id)}>上传新版本</Button>
                  <Button size="small" onClick={() => openVersions(record.id)}>查看版本</Button>
                  <Button size="small" onClick={() => resolveVersion(record.id, 0)}>解析最新引用</Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={Boolean(parseLoadingMap[getParseTaskKey(record.id, 0)])}
                    onClick={() => parseVersion(record.id, 0)}
                  >
                    解析
                  </Button>
                </Space>
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
        title={parseResult ? `解析结果 · 文件 ${parseResult.version.fileId} / v${parseResult.version.versionNo}` : '解析结果'}
        open={parseResultModalOpen}
        onCancel={() => setParseResultModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setParseResultModalOpen(false)}>
            关闭
          </Button>,
        ]}
        width={880}
      >
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
                  <Descriptions.Item label="图表候选数">{parseResult.figureCount}</Descriptions.Item>
                  <Descriptions.Item label="表格片段数">{parseResult.fragmentCount}</Descriptions.Item>
                  <Descriptions.Item label="单元格数">{parseResult.cellCount}</Descriptions.Item>
                </Descriptions>
                <div className="flex justify-end">
                  <Button onClick={copyParseSummary}>复制解析摘要</Button>
                </div>
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
              </div>
            )
          : null}
      </Modal>
    </div>
  )
}
