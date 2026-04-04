'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Modal, Space, Table, Tag, message } from 'antd'
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
              width: 120,
              render: (_, row) => <Button size="small" onClick={() => resolveVersion(row.fileId, row.versionNo)}>解析</Button>,
            },
          ]}
        />
      </Modal>
    </div>
  )
}
