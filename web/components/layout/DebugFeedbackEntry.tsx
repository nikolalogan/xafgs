'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Badge, Button, Form, Input, Modal, Radio, Space, Tag, Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { BugOutlined } from '@ant-design/icons'
import type { RcFile } from 'antd/es/upload'
import { clearStoredCurrentUser, fetchCurrentUser, getAccessToken, readStoredCurrentUser, type CurrentUserDTO } from '@/lib/current-user'
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

type UploadSessionDTO = {
  id: string
  fileId: number
}

type FileUploadResultDTO = {
  fileId: number
  versionNo: number
}

const eventName = 'debug-feedback-changed'
const maxDebugFeedbackAttachmentSize = 10 * 1024 * 1024
const maxDebugFeedbackAttachmentSizeText = '10MB'

const fireChanged = () => {
  if (typeof window === 'undefined')
    return
  window.dispatchEvent(new CustomEvent(eventName))
}

const toUploadFile = (file: File): UploadFile => ({
  uid: `${file.name}-${file.size}-${file.lastModified}`,
  name: file.name,
  size: file.size,
  type: file.type,
  status: 'done',
  originFileObj: file as RcFile,
})

export default function DebugFeedbackEntry() {
  const router = useRouter()
  const pathname = usePathname()
  const [msgApi, contextHolder] = message.useMessage()
  const { role, hydrated } = useConsoleRole()
  const [openCount, setOpenCount] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [currentUser, setCurrentUser] = useState<CurrentUserDTO | null>(readStoredCurrentUser())
  const [form] = Form.useForm<{ title: string; type: DebugFeedbackType; description: string }>()

  const canSubmit = role === 'user'
  const isAdmin = role === 'admin'

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getAccessToken()
    const headers: Record<string, string> = {}
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (!(init?.body instanceof FormData))
      headers['content-type'] = headers['content-type'] || 'application/json'
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

  const fetchSummary = async () => {
    try {
      const payload = await request<SummaryResponse>('/api/debug-feedback', { method: 'GET' })
      setOpenCount(Number(payload.openCount || 0))
    }
    catch {
      setOpenCount(0)
    }
  }

  useEffect(() => {
    if (!hydrated || !isAdmin)
      return
    fetchSummary()
  }, [hydrated, isAdmin, pathname])

  useEffect(() => {
    if (!hydrated || !isAdmin)
      return
    fetchCurrentUser()
      .then(setCurrentUser)
      .catch((error) => {
        if (!(error instanceof Error))
          return
        if (error.message.includes('未登录')) {
          clearStoredCurrentUser()
          router.push('/login?redirect=/app')
        }
      })
  }, [hydrated, isAdmin, router])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const onChanged = () => fetchSummary()
    window.addEventListener(eventName, onChanged)
    return () => window.removeEventListener(eventName, onChanged)
  }, [])

  const uploadFileList = useMemo(() => files.map(toUploadFile), [files])

  const filterAllowedFiles = (nextFiles: File[]) => {
    const allowedFiles: File[] = []
    const oversizedFiles: File[] = []
    for (const file of nextFiles) {
      if (file.size > maxDebugFeedbackAttachmentSize)
        oversizedFiles.push(file)
      else
        allowedFiles.push(file)
    }
    if (oversizedFiles.length > 0)
      msgApi.warning(`提交 Bug 的单个附件不能超过 ${maxDebugFeedbackAttachmentSizeText}，已忽略 ${oversizedFiles.length} 个文件`)
    return allowedFiles
  }

  const appendFiles = (nextFiles: File[]) => {
    if (!nextFiles.length)
      return
    const allowedFiles = filterAllowedFiles(nextFiles)
    if (!allowedFiles.length)
      return
    setFiles((current) => {
      const map = new Map<string, File>()
      for (const file of current)
        map.set(`${file.name}-${file.size}-${file.lastModified}`, file)
      for (const file of allowedFiles)
        map.set(`${file.name}-${file.size}-${file.lastModified}`, file)
      return Array.from(map.values())
    })
  }

  const uploadProps: UploadProps = {
    multiple: true,
    fileList: uploadFileList,
    beforeUpload: (file) => {
      if (file.size > maxDebugFeedbackAttachmentSize) {
        msgApi.warning(`提交 Bug 的单个附件不能超过 ${maxDebugFeedbackAttachmentSizeText}`)
        return Upload.LIST_IGNORE
      }
      appendFiles([file as RcFile])
      return false
    },
    onRemove: (file) => {
      setFiles(current => current.filter(item => `${item.name}-${item.size}-${item.lastModified}` !== String(file.uid)))
      return true
    },
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      if (files.some(file => file.size > maxDebugFeedbackAttachmentSize))
        throw new Error(`提交 Bug 的单个附件不能超过 ${maxDebugFeedbackAttachmentSizeText}`)
      const user = currentUser || await fetchCurrentUser()
      setCurrentUser(user)
      const attachments = [] as Array<{ fileId: number; versionNo: number }>
      for (const [index, file] of files.entries()) {
        const session = await request<UploadSessionDTO>('/api/files/sessions', {
          method: 'POST',
          body: JSON.stringify({ bizKey: `debug-feedback_${Date.now()}_${index}` }),
        })
        const body = new FormData()
        body.append('file', file)
        const uploaded = await request<FileUploadResultDTO>(`/api/files/sessions/${session.id}/content`, {
          method: 'POST',
          body,
        })
        attachments.push({
          fileId: Number(uploaded?.fileId || session.fileId || 0),
          versionNo: Number(uploaded?.versionNo || 0),
        })
      }
      const response = await fetch('/api/debug-feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          title: values.title.trim(),
          type: values.type,
          description: String(values.description || '').trim(),
          attachments,
        }),
      })
      const payload = await response.json() as ApiResponse<DebugFeedbackItem>
      if (response.status === 401)
        throw new Error('未登录或登录已过期')
      if (!response.ok)
        throw new Error(payload.message || '提交失败')

      msgApi.success('提交成功')
      setModalOpen(false)
      setFiles([])
      form.resetFields()
      fireChanged()
    }
    catch (error) {
      if (error instanceof Error && error.message.includes('out of date'))
        return
      if (error instanceof Error && error.message.includes('未登录')) {
        clearStoredCurrentUser()
        router.push('/login?redirect=/app')
      }
      msgApi.error(error instanceof Error ? error.message : '提交失败')
    }
    finally {
      setSubmitting(false)
    }
  }

  if (!hydrated || (!isAdmin && !canSubmit))
    return contextHolder

  return (
    <>
      {contextHolder}
      {isAdmin && (
        <Badge count={openCount} size="small" offset={[-2, 2]}>
          <Button
            size="small"
            type={pathname.startsWith('/app/debug-feedback') ? 'primary' : 'default'}
            onClick={() => router.push('/app/debug-feedback')}
            title={`未完成 ${openCount} 条`}
            icon={<BugOutlined />}
          >
          </Button>
        </Badge>
      )}
      {canSubmit && (
        <>
          <Button size="small" onClick={() => setModalOpen(true)} title="提交需求或 Bug" icon={<BugOutlined />} />
          <Modal
            title="提交需求 / Bug"
            open={modalOpen}
            onCancel={() => setModalOpen(false)}
            onOk={submit}
            okText="提交"
            cancelText="取消"
            confirmLoading={submitting}
            destroyOnHidden
          >
            <Form
              form={form}
              layout="vertical"
              initialValues={{ title: '', type: 'bug', description: '' }}
            >
              <Form.Item
                label="标题"
                name="title"
                rules={[{ required: true, message: '请输入标题' }]}
              >
                <Input maxLength={80} placeholder="请简要描述问题或需求" />
              </Form.Item>
              <Form.Item label="类型" name="type">
                <Radio.Group
                  options={[
                    { label: '需求', value: 'requirement' },
                    { label: 'Bug', value: 'bug' },
                  ]}
                  optionType="button"
                  buttonStyle="solid"
                />
              </Form.Item>
              <Form.Item label="描述（可选）" name="description">
                <Input.TextArea
                  rows={5}
                  placeholder="可补充操作步骤、期望结果等；聚焦输入框后可直接粘贴截图"
                  onPaste={(event) => {
                    const clipboardFiles = Array.from(event.clipboardData?.items || [])
                      .map(item => item.getAsFile())
                      .filter((file): file is File => file instanceof File && file.size > 0)
                    if (clipboardFiles.length > 0) {
                      event.preventDefault()
                      appendFiles(clipboardFiles)
                      msgApi.success(`已添加 ${clipboardFiles.length} 个附件`)
                    }
                  }}
                />
              </Form.Item>
              <Form.Item label="截图 / 附件">
                <Space orientation="vertical" style={{ width: '100%' }} size={8}>
                  <Upload {...uploadProps}>
                    <Button>选择文件</Button>
                  </Upload>
                  <div className="text-xs text-gray-500">
                    支持图片与常见附件，单个附件最大 {maxDebugFeedbackAttachmentSizeText}，也支持在上方描述框中直接粘贴截图。
                  </div>
                  {files.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-gray-200">
                      {files.map((file, index) => (
                        <div
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className={`flex items-center justify-between px-3 py-2 ${
                            index > 0 ? 'border-t border-gray-200' : ''
                          }`}
                        >
                          <Space size={8}>
                            <Tag>{file.type?.startsWith('image/') ? '图片' : '附件'}</Tag>
                            <span>{file.name}</span>
                            <span className="text-xs text-gray-400">
                              {Math.max(1, Math.round(file.size / 1024))} KB
                            </span>
                          </Space>
                          <Button
                            size="small"
                            type="link"
                            danger
                            onClick={() => setFiles(current => current.filter(item => item !== file))}
                          >
                            删除
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Space>
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </>
  )
}
