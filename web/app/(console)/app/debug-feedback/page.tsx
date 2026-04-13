'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BugOutlined } from '@ant-design/icons'
import { Button, Descriptions, Drawer, Image, Space, Table, Tag, message } from 'antd'
import { clearStoredCurrentUser, fetchCurrentUser, getAccessToken, readStoredCurrentUser, type CurrentUserDTO } from '@/lib/current-user'
import { formatShanghaiDateTime } from '@/lib/time'
import { useConsoleRole } from '@/lib/useConsoleRole'

type DebugFeedbackType = 'requirement' | 'bug'
type DebugFeedbackRole = 'admin' | 'user' | 'guest'

type DebugFeedbackAttachment = {
  id: number
  name: string
  mimeType: string
  size: number
}

type DebugFeedbackItem = {
  id: number
  title: string
  type: DebugFeedbackType
  description: string
  status: 'open' | 'done'
  attachments: DebugFeedbackAttachment[]
  submitterId?: number
  submitterUsername: string
  submitterName?: string
  submitterRole: DebugFeedbackRole
  createdAt: string
  completedAt: string | null
  completedBy: string | null
}

type SummaryResponse = {
  items: DebugFeedbackItem[]
  openCount: number
}

type ApiResponse<T> = {
  message?: string
  data?: T
}

type AttachmentFetchResult = {
  blob: Blob
  filename: string
}

const typeLabelMap: Record<DebugFeedbackType, string> = {
  requirement: '需求',
  bug: 'Bug',
}

const roleLabelMap: Record<DebugFeedbackRole, string> = {
  admin: '管理员',
  user: '普通用户',
  guest: '访客',
}

const fireChanged = () => {
  if (typeof window === 'undefined')
    return
  window.dispatchEvent(new CustomEvent('debug-feedback-changed'))
}

const getSubmitterLabel = (record: DebugFeedbackItem) => {
  const displayName = String(record.submitterName || '').trim() || record.submitterUsername
  return `${displayName} / ${roleLabelMap[record.submitterRole]}`
}

const isImageAttachment = (file: DebugFeedbackAttachment) => file.mimeType?.startsWith('image/')

const readFilenameFromDisposition = (value: string | null, fallback: string) => {
  if (!value)
    return fallback
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    }
    catch {
      return utf8Match[1]
    }
  }
  const plainMatch = value.match(/filename=\"?([^\";]+)\"?/i)
  if (plainMatch?.[1])
    return plainMatch[1]
  return fallback
}

const downloadBlob = (blob: Blob, filename: string) => {
  const objectURL = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectURL
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
}

export default function DebugFeedbackPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role, hydrated } = useConsoleRole()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<DebugFeedbackItem[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [current, setCurrent] = useState<DebugFeedbackItem | null>(null)
  const [finishingId, setFinishingId] = useState<number | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUserDTO | null>(readStoredCurrentUser())
  const [imagePreviewURLs, setImagePreviewURLs] = useState<Record<number, string>>({})
  const [imageLoadingIDs, setImageLoadingIDs] = useState<number[]>([])
  const [imageErrors, setImageErrors] = useState<Record<number, string>>({})
  const [downloadingIDs, setDownloadingIDs] = useState<number[]>([])

  const canAccess = useMemo(() => role === 'admin', [role])

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getAccessToken()
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
    if (response.status === 401)
      throw new Error('未登录或登录已过期')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const fetchAttachment = async (attachment: DebugFeedbackAttachment): Promise<AttachmentFetchResult> => {
    const token = getAccessToken()
    const headers: Record<string, string> = {}
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(`/api/debug-feedback/attachments/${attachment.id}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    })
    if (response.status === 401)
      throw new Error('未登录或登录已过期')
    if (!response.ok)
      throw new Error('附件加载失败')
    const blob = await response.blob()
    const filename = readFilenameFromDisposition(response.headers.get('content-disposition'), attachment.name)
    return { blob, filename }
  }

  const fetchRows = async () => {
    setLoading(true)
    try {
      const data = await request<SummaryResponse>('/api/debug-feedback', { method: 'GET' })
      setRows(Array.isArray(data.items) ? data.items : [])
      setOpenCount(Number(data.openCount || 0))
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载失败')
      setRows([])
      setOpenCount(0)
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hydrated && canAccess)
      fetchRows()
  }, [hydrated, canAccess])

  useEffect(() => {
    if (!hydrated || !canAccess)
      return
    fetchCurrentUser()
      .then(setCurrentUser)
      .catch((error) => {
        if (!(error instanceof Error))
          return
        if (error.message.includes('未登录')) {
          clearStoredCurrentUser()
          router.push('/login?redirect=/app/debug-feedback')
        }
      })
  }, [canAccess, hydrated, router])

  useEffect(() => {
    const currentPreviewURLs = imagePreviewURLs
    return () => {
      Object.values(currentPreviewURLs).forEach((url) => {
        URL.revokeObjectURL(url)
      })
    }
  }, [imagePreviewURLs])

  useEffect(() => {
    if (!current) {
      setImagePreviewURLs({})
      setImageLoadingIDs([])
      setImageErrors({})
      return
    }

    let cancelled = false
    const nextImageFiles = current.attachments.filter(isImageAttachment)
    const nextIDs = new Set(nextImageFiles.map(file => file.id))

    setImageErrors({})
    setImageLoadingIDs(nextImageFiles.map(file => file.id))
    setImagePreviewURLs((previous) => {
      Object.entries(previous).forEach(([id, url]) => {
        if (!nextIDs.has(Number(id)))
          URL.revokeObjectURL(url)
      })
      return {}
    })

    Promise.all(nextImageFiles.map(async (file) => {
      try {
        const { blob } = await fetchAttachment(file)
        if (cancelled)
          return null
        return { id: file.id, url: URL.createObjectURL(blob) }
      }
      catch (error) {
        if (cancelled)
          return null
        const message = error instanceof Error ? error.message : '附件加载失败'
        if (message.includes('未登录或登录已过期')) {
          clearStoredCurrentUser()
          router.push('/login?redirect=/app/debug-feedback')
          return null
        }
        setImageErrors(previous => ({ ...previous, [file.id]: message }))
        return null
      }
      finally {
        if (!cancelled)
          setImageLoadingIDs(previous => previous.filter(id => id !== file.id))
      }
    })).then((items) => {
      if (cancelled)
        return
      const nextEntries = items.filter((item): item is { id: number, url: string } => !!item)
      setImagePreviewURLs(Object.fromEntries(nextEntries.map(item => [item.id, item.url])))
    })

    return () => {
      cancelled = true
    }
  }, [current, router])

  const markDone = async (row: DebugFeedbackItem) => {
    try {
      setFinishingId(row.id)
      const user = currentUser || await fetchCurrentUser()
      setCurrentUser(user)
      const result = await request<DebugFeedbackItem>(`/api/debug-feedback/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          completedBy: String(user.name || user.username).trim() || '管理员',
        }),
      })
      msgApi.success('已标记完成')
      fetchRows()
      fireChanged()
      if (current?.id === row.id)
        setCurrent(result || null)
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('未登录')) {
        clearStoredCurrentUser()
        router.push('/login?redirect=/app/debug-feedback')
      }
      msgApi.error(error instanceof Error ? error.message : '更新失败')
    }
    finally {
      setFinishingId(null)
    }
  }

  const handleDownloadAttachment = async (file: DebugFeedbackAttachment) => {
    try {
      setDownloadingIDs(previous => [...previous, file.id])
      const { blob, filename } = await fetchAttachment(file)
      downloadBlob(blob, filename)
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('未登录')) {
        clearStoredCurrentUser()
        router.push('/login?redirect=/app/debug-feedback')
        return
      }
      msgApi.error(error instanceof Error ? error.message : '附件下载失败')
    }
    finally {
      setDownloadingIDs(previous => previous.filter(id => id !== file.id))
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

  if (!canAccess) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        {contextHolder}
        <div className="text-base font-semibold text-gray-900">无权限访问</div>
        <div className="mt-2 text-sm text-gray-500">该列表仅管理员可访问。</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contextHolder}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Debug 列表</div>
            <div className="mt-1 text-xs text-gray-500">未完成 {openCount} 条</div>
          </div>
          <Space>
            <Button onClick={() => router.push('/app')} icon={<BugOutlined />}>返回控制台</Button>
          </Space>
        </div>
        <Table<DebugFeedbackItem>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          onRow={record => ({
            onClick: () => setCurrent(record),
          })}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 80 },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            {
              title: '类型',
              dataIndex: 'type',
              width: 120,
              render: (value: DebugFeedbackType) => (
                <Tag color={value === 'bug' ? 'red' : 'blue'}>
                  {typeLabelMap[value]}
                </Tag>
              ),
            },
            {
              title: '提交人',
              key: 'submitter',
              width: 180,
              render: (_, record) => getSubmitterLabel(record),
            },
            {
              title: '提交时间',
              dataIndex: 'createdAt',
              width: 180,
              render: (value: string) => formatShanghaiDateTime(value),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (value: 'open' | 'done') => (
                <Tag color={value === 'open' ? 'orange' : 'green'}>
                  {value === 'open' ? '未完成' : '已完成'}
                </Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_, record) => (
                <Button
                  size="small"
                  type="link"
                  disabled={record.status === 'done'}
                  loading={finishingId === record.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    markDone(record)
                  }}
                >
                  完成
                </Button>
              ),
            },
          ]}
        />
      </div>

      <Drawer
        title={current ? `Debug #${current.id}` : '详情'}
        open={!!current}
        size="large"
        onClose={() => setCurrent(null)}
      >
        {current && (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="标题">{current.title}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={current.type === 'bug' ? 'red' : 'blue'}>
                  {typeLabelMap[current.type]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="提交人">
                {getSubmitterLabel(current)}
              </Descriptions.Item>
              <Descriptions.Item label="提交时间">{formatShanghaiDateTime(current.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={current.status === 'open' ? 'orange' : 'green'}>
                  {current.status === 'open' ? '未完成' : '已完成'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="完成时间">
                {current.completedAt ? formatShanghaiDateTime(current.completedAt) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="完成人">{current.completedBy || '-'}</Descriptions.Item>
              <Descriptions.Item label="描述">
                <div className="whitespace-pre-wrap break-all">{current.description || '-'}</div>
              </Descriptions.Item>
              <Descriptions.Item label="附件">
                {current.attachments.length > 0
                  ? (
                      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                        {current.attachments.map(file => (
                          <div key={file.id} className="rounded-lg border border-gray-200 p-3">
                            {isImageAttachment(file)
                              ? (
                                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                                    {imagePreviewURLs[file.id]
                                      ? (
                                          <Image
                                            src={imagePreviewURLs[file.id]}
                                            alt={file.name}
                                            style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }}
                                          />
                                        )
                                      : imageErrors[file.id]
                                        ? <div className="text-sm text-rose-600">{imageErrors[file.id]}</div>
                                        : <div className="text-sm text-gray-500">{imageLoadingIDs.includes(file.id) ? '图片加载中...' : '暂无预览'}</div>}
                                    <Button
                                      type="link"
                                      className="!px-0 text-left"
                                      loading={downloadingIDs.includes(file.id)}
                                      onClick={() => handleDownloadAttachment(file)}
                                    >
                                      {file.name}（{Math.max(1, Math.round(file.size / 1024))} KB）
                                    </Button>
                                  </Space>
                                )
                              : (
                                  <Button
                                    type="link"
                                    className="!px-0"
                                    loading={downloadingIDs.includes(file.id)}
                                    onClick={() => handleDownloadAttachment(file)}
                                  >
                                    {file.name}（{Math.max(1, Math.round(file.size / 1024))} KB）
                                  </Button>
                                )}
                          </div>
                        ))}
                      </Space>
                    )
                  : '-'}
              </Descriptions.Item>
            </Descriptions>
            {current.status === 'open' && (
              <Button
                type="primary"
                loading={finishingId === current.id}
                onClick={() => markDone(current)}
              >
                标记完成
              </Button>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
