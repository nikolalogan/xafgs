'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GlobalOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Upload, message } from 'antd'
import { useConsoleRole } from '@/lib/useConsoleRole'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type ChatConversationDTO = {
  id: number
  userId: number
  title: string
  model: string
  systemPrompt: string
  enableWebSearch: boolean
  createdAt: string
  updatedAt: string
}

type ChatMessageDTO = {
  id: number
  conversationId: number
  role: 'system' | 'user' | 'assistant'
  content: string
  createdAt: string
}

type ChatSendResultDTO = {
  conversation: ChatConversationDTO
  userMessage: ChatMessageDTO
  assistantMessage: ChatMessageDTO
}

type ChatAttachmentRef = {
  fileId: number
  versionNo: number
}

type UploadSessionDTO = {
  id: string
  fileId: number
}

type FileUploadResultDTO = {
  fileId: number
  versionNo: number
}

type SystemModelOption = {
  name: string
  label: string
  enabled: boolean
}

type SystemConfigDTO = {
  models: SystemModelOption[]
  defaultModel: string
}

const MAX_CHAT_UPLOAD_BYTES = 200 * 1024 * 1024
const SEARCH_REFERENCES_MARKER = '[WEB_SEARCH_REFERENCES]'

type ChatReference = {
  title: string
  url: string
}

type KnowledgeSearchHitDTO = {
  fileId: number
  versionNo: number
  chunkIndex: number
  chunkText: string
  chunkSummary: string
  sourceRef: string
  retrievalType: 'semantic' | 'keyword' | 'hybrid' | string
  semanticScore: number
  keywordScore: number
  finalScore: number
  score: number
}

type KnowledgeSearchResultDTO = {
  hits: KnowledgeSearchHitDTO[]
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const formatConversationTitle = (conversation: ChatConversationDTO) => {
  const title = String(conversation?.title || '').trim()
  if (title)
    return title
  return `会话 #${conversation?.id || 0}`
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

const parseMessageWithReferences = (rawContent: string): { body: string, references: ChatReference[] } => {
  const content = String(rawContent || '')
  const markerIndex = content.lastIndexOf(SEARCH_REFERENCES_MARKER)
  if (markerIndex < 0)
    return { body: content, references: [] }
  const body = content.slice(0, markerIndex).replace(/\s+$/, '')
  const jsonPart = content.slice(markerIndex + SEARCH_REFERENCES_MARKER.length).trim()
  if (!jsonPart)
    return { body, references: [] }
  try {
    const parsed = JSON.parse(jsonPart)
    if (!Array.isArray(parsed))
      return { body, references: [] }
    const references = parsed
      .map((item) => ({
        title: String(item?.title || '').trim(),
        url: String(item?.url || '').trim(),
      }))
      .filter(item => item.title || item.url)
    return { body, references }
  }
  catch {
    return { body: content, references: [] }
  }
}

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

const buildKnowledgeHitRowKey = (row: KnowledgeSearchHitDTO) => `${row.fileId}-${row.versionNo}-${row.chunkIndex}-${row.sourceRef}`

export default function ChatPage() {
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const { role: currentRole, hydrated } = useConsoleRole()
  const canAccess = useMemo(() => currentRole === 'admin' || currentRole === 'user', [currentRole])

  const [conversations, setConversations] = useState<ChatConversationDTO[]>([])
  const [activeConversationID, setActiveConversationID] = useState<number>(0)
  const [messages, setMessages] = useState<ChatMessageDTO[]>([])
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [enableWebSearch, setEnableWebSearch] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [searchPreviewOpen, setSearchPreviewOpen] = useState(false)
  const [searchPreviewLoading, setSearchPreviewLoading] = useState(false)
  const [previewQuery, setPreviewQuery] = useState('')
  const [previewTopK, setPreviewTopK] = useState('8')
  const [previewMinScore, setPreviewMinScore] = useState('0.2')
  const [previewFileIDsText, setPreviewFileIDsText] = useState('')
  const [previewBizKey, setPreviewBizKey] = useState('')
  const [previewSubjectID, setPreviewSubjectID] = useState('')
  const [previewProjectID, setPreviewProjectID] = useState('')
  const [previewHits, setPreviewHits] = useState<KnowledgeSearchHitDTO[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm] = Form.useForm<{ title: string, model: string, systemPrompt: string }>()
  const [enabledModels, setEnabledModels] = useState<Array<{ label: string, value: string }>>([{ label: 'GPT-4o mini', value: 'gpt-4o-mini' }])
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini')

  const scrollRef = useRef<HTMLDivElement | null>(null)

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
      router.push('/?redirect=/app/chat')
      throw new Error('未登录或登录已过期')
    }
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const uploadFileForChat = async (file: File, index: number) => {
    const session = await request<UploadSessionDTO>('/api/files/sessions', {
      method: 'POST',
      body: JSON.stringify({ bizKey: `chat_attachment_${Date.now()}_${index}` }),
    })
    const formData = new FormData()
    formData.append('file', file)
    const uploaded = await request<FileUploadResultDTO>(`/api/files/sessions/${session.id}/content`, {
      method: 'POST',
      body: formData,
    })
    return {
      fileId: Number(uploaded?.fileId || session.fileId || 0),
      versionNo: Number(uploaded?.versionNo || 0),
    }
  }

  const fetchConversations = async (pickFirst: boolean) => {
    setLoadingConversations(true)
    try {
      const list = await request<ChatConversationDTO[]>('/api/chat/conversations', { method: 'GET' })
      const safe = Array.isArray(list) ? list : []
      setConversations(safe)
      if (pickFirst) {
        const firstID = Number(safe[0]?.id || 0)
        if (firstID > 0)
          setActiveConversationID(firstID)
      }
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载会话失败')
    }
    finally {
      setLoadingConversations(false)
    }
  }

  const fetchMessages = async (conversationID: number) => {
    if (!conversationID)
      return
    setLoadingMessages(true)
    try {
      const list = await request<ChatMessageDTO[]>(`/api/chat/conversations/${conversationID}/messages?limit=200`, { method: 'GET' })
      const safe = Array.isArray(list) ? list : []
      setMessages(safe)
      window.setTimeout(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }, 30)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载消息失败')
    }
    finally {
      setLoadingMessages(false)
    }
  }

  const fetchModelConfig = async () => {
    try {
      const data = await request<SystemConfigDTO>('/api/system-config', { method: 'GET' })
      const rawModels = Array.isArray(data?.models) ? data.models : []
      const models = rawModels
        .map(item => ({
          name: String(item?.name || '').trim(),
          label: String(item?.label || '').trim(),
          enabled: Boolean(item?.enabled),
        }))
        .filter(item => item.name && item.enabled)
      if (models.length === 0) {
        setEnabledModels([{ label: 'GPT-4o mini', value: 'gpt-4o-mini' }])
        setDefaultModel('gpt-4o-mini')
        return
      }
      const options = models.map(item => ({ label: item.label || item.name, value: item.name }))
      const allowed = new Set(options.map(item => item.value))
      const fallback = options[0].value
      const nextDefault = allowed.has(String(data?.defaultModel || '').trim()) ? String(data?.defaultModel || '').trim() : fallback
      setEnabledModels(options)
      setDefaultModel(nextDefault)
    }
    catch {
      setEnabledModels([{ label: 'GPT-4o mini', value: 'gpt-4o-mini' }])
      setDefaultModel('gpt-4o-mini')
    }
  }

  useEffect(() => {
    if (!canAccess)
      return
    fetchModelConfig()
    fetchConversations(true)
  }, [canAccess])

  useEffect(() => {
    if (!activeConversationID)
      return
    setEnableWebSearch(false)
    fetchMessages(activeConversationID)
  }, [activeConversationID])

  const openCreate = () => {
    createForm.setFieldsValue({ title: '', model: defaultModel, systemPrompt: '' })
    setCreateOpen(true)
  }

  const createConversation = async () => {
    const values = await createForm.validateFields()
    setCreateLoading(true)
    try {
      const created = await request<ChatConversationDTO>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: values.title || '',
          model: values.model || defaultModel,
          systemPrompt: values.systemPrompt || '',
        }),
      })
      msgApi.success('创建成功')
      setCreateOpen(false)
      await fetchConversations(false)
      const id = Number(created?.id || 0)
      if (id > 0)
        setActiveConversationID(id)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '创建失败')
    }
    finally {
      setCreateLoading(false)
    }
  }

  const send = async () => {
    const conversationID = Number(activeConversationID || 0)
    if (!conversationID) {
      msgApi.warning('请先创建或选择会话')
      return
    }
    const text = String(draft || '').trim()
    if (!text && pendingFiles.length === 0)
      return

    setSending(true)
    try {
      const attachments: ChatAttachmentRef[] = []
      for (let index = 0; index < pendingFiles.length; index += 1) {
        const uploaded = await uploadFileForChat(pendingFiles[index], index)
        if (uploaded.fileId <= 0 || uploaded.versionNo <= 0)
          throw new Error('文件上传失败，请重试')
        attachments.push(uploaded)
      }
      const data = await request<ChatSendResultDTO>(`/api/chat/conversations/${conversationID}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text, enableWebSearch, attachments, maxContextMessages: 20 }),
      })
      setDraft('')
      setEnableWebSearch(false)
      setPendingFiles([])
      setMessages(prev => [...prev, data.userMessage, data.assistantMessage])
      setConversations(prev => {
        const next = [...(Array.isArray(prev) ? prev : [])]
        const updated = data.conversation
        const index = next.findIndex(item => Number(item?.id || 0) === Number(updated?.id || 0))
        if (index >= 0)
          next.splice(index, 1)
        next.unshift(updated)
        return next
      })
      window.setTimeout(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }, 30)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '发送失败')
    }
    finally {
      setSending(false)
    }
  }

  const deleteConversation = async () => {
    const id = Number(activeConversationID || 0)
    if (!id)
      return
    Modal.confirm({
      title: '删除会话',
      content: '删除后将同时删除该会话下的全部消息，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await request<boolean>(`/api/chat/conversations/${id}`, { method: 'DELETE' })
          msgApi.success('删除成功')
          setActiveConversationID(0)
          setMessages([])
          await fetchConversations(true)
        }
        catch (error) {
          msgApi.error(error instanceof Error ? error.message : '删除失败')
        }
      },
    })
  }

  const openSearchPreview = () => {
    setPreviewQuery(String(draft || '').trim())
    setSearchPreviewOpen(true)
  }

  const runSearchPreview = async () => {
    const query = String(previewQuery || '').trim()
    if (!query) {
      msgApi.warning('请先输入问题，再做检索预览')
      return
    }
    const payload = {
      query,
      topK: parsePositiveInt(previewTopK) || 8,
      minScore: parsePositiveFloat(previewMinScore, 0.2),
      fileIds: parseFileIDs(previewFileIDsText),
      bizKey: String(previewBizKey || '').trim(),
      subjectId: parseNonNegativeInt(previewSubjectID),
      projectId: parseNonNegativeInt(previewProjectID),
    }
    setSearchPreviewLoading(true)
    try {
      const data = await request<KnowledgeSearchResultDTO>('/api/knowledge/search', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const hits = Array.isArray(data?.hits) ? data.hits : []
      setPreviewHits(hits)
      msgApi.success(`检索预览完成，命中 ${hits.length} 条`)
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '检索预览失败')
    }
    finally {
      setSearchPreviewLoading(false)
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
        <div className="mt-2 text-sm text-gray-500">请先登录后再访问 AI 对话。</div>
      </div>
    )
  }

  const activeConversation = conversations.find(item => Number(item?.id || 0) === Number(activeConversationID || 0))

  return (
    <div className="grid grid-cols-12 gap-3">
      {contextHolder}

      <div className="col-span-12 rounded-xl border border-gray-200 bg-white p-3 md:col-span-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">会话</div>
          <Button size="small" type="primary" onClick={openCreate}>新建</Button>
        </div>
        {loadingConversations && (
          <div className="mb-2 text-xs text-gray-500">加载中...</div>
        )}
        <div className="space-y-1">
          {conversations.map((item) => {
            const id = Number(item?.id || 0)
            const active = id === Number(activeConversationID || 0)
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveConversationID(id)}
                className={active
                  ? 'w-full rounded-lg bg-gray-50 px-3 py-2 text-left'
                  : 'w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50'}
              >
                <div className="truncate text-sm font-medium text-gray-900">{formatConversationTitle(item)}</div>
                <div className="mt-1 truncate text-xs text-gray-500">{item.model || '默认模型'}</div>
              </button>
            )
          })}
        </div>
        {conversations.length === 0 && (
          <div className="mt-3 text-xs text-gray-500">暂无会话，点击“新建”开始对话。</div>
        )}
      </div>

      <div className="col-span-12 rounded-xl border border-gray-200 bg-white p-3 md:col-span-8">
        <div className="mb-2 flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">{activeConversation ? formatConversationTitle(activeConversation) : '未选择会话'}</div>
            {activeConversation?.systemPrompt && (
              <div className="truncate text-xs text-gray-500">systemPrompt：{activeConversation.systemPrompt}</div>
            )}
          </div>
          <Space>
            <Button size="small" danger onClick={deleteConversation} disabled={!activeConversationID}>删除</Button>
          </Space>
        </div>

        <div ref={scrollRef} className="h-[52vh] overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-3">
          {loadingMessages && <div className="text-xs text-gray-500">加载中...</div>}
          {!loadingMessages && messages.length === 0 && (
            <div className="text-xs text-gray-500">暂无消息，开始发送第一条吧。</div>
          )}
          <div className="space-y-2">
            {messages.map((m) => {
              const isUser = m.role === 'user'
              const parsedMessage = parseMessageWithReferences(m.content)
              const showReferences = !isUser && parsedMessage.references.length > 0
              return (
                <div key={m.id} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={isUser ? 'max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white' : 'max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm text-gray-900'}>
                    <div className="whitespace-pre-wrap break-words">{parsedMessage.body}</div>
                    {showReferences && (
                      <div className="mt-2 text-xs text-gray-500">
                        <Tooltip
                          placement="topLeft"
                          title={(
                            <div className="max-w-[420px] space-y-2">
                              {parsedMessage.references.map((ref, index) => (
                                <div key={`${ref.url}_${index}`} className="text-xs">
                                  <div className="font-medium text-white">{ref.title || `来源 ${index + 1}`}</div>
                                  {ref.url
                                    ? (
                                        <a
                                          href={ref.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="break-all text-blue-200 underline"
                                        >
                                          {ref.url}
                                        </a>
                                      )
                                    : <span className="text-gray-300">无链接</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        >
                          <span className="cursor-pointer underline decoration-dotted">
                            参考 {parsedMessage.references.length} 篇文献
                          </span>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <div className="shrink-0">
            <Upload
              showUploadList={false}
              multiple={false}
              disabled={sending || !activeConversationID}
              beforeUpload={(file) => {
                if (file.size > MAX_CHAT_UPLOAD_BYTES) {
                  msgApi.warning(`文件过大，单文件上限 200MB，当前 ${formatSize(file.size)}`)
                  return Upload.LIST_IGNORE
                }
                setPendingFiles(prev => [...prev, file as File])
                return false
              }}
            >
              <Tooltip title="添加附件">
                <Button shape="circle" icon={<UploadOutlined />} disabled={sending || !activeConversationID} />
              </Tooltip>
            </Upload>
          </div>
          <Tooltip title={enableWebSearch ? '已开启联网搜索（本次发送生效）' : '开启联网搜索（本次发送生效）'}>
            <Button
              onClick={() => setEnableWebSearch(prev => !prev)}
              disabled={sending || !activeConversationID}
              type={enableWebSearch ? 'primary' : 'default'}
              shape="circle"
              icon={<GlobalOutlined />}
            />
          </Tooltip>
          <Tooltip title="发送前预览知识库检索命中">
            <Button
              onClick={openSearchPreview}
              disabled={sending || !activeConversationID}
            >
              检索预览
            </Button>
          </Tooltip>
          <Input.TextArea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="输入消息或添加文件（Enter 发送，Shift+Enter 换行）"
            autoSize={{ minRows: 2, maxRows: 6 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!sending)
                  send()
              }
            }}
          />
          <Button type="primary" loading={sending} onClick={send}>发送</Button>
        </div>
        {pendingFiles.length > 0 && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
            <div className="mb-1 text-xs font-medium text-gray-700">待上传附件（发送时上传）</div>
            <div className="space-y-1">
              {pendingFiles.map((file, index) => (
                <div key={`${file.name}_${file.lastModified}_${index}`} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                  <div className="truncate text-gray-700">{file.name} · {formatSize(file.size)}</div>
                  <Button
                    size="small"
                    type="text"
                    danger
                    onClick={() => setPendingFiles(prev => prev.filter((_, currentIndex) => currentIndex !== index))}
                  >
                    移除
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal
        title="检索预览（发送前）"
        open={searchPreviewOpen}
        onCancel={() => setSearchPreviewOpen(false)}
        footer={null}
        width={1080}
      >
        <div className="space-y-3">
          <Input.TextArea
            value={previewQuery}
            onChange={event => setPreviewQuery(event.target.value)}
            rows={2}
            placeholder="请输入要预览检索的问题"
          />
          <Space wrap>
            <Input value={previewTopK} onChange={event => setPreviewTopK(event.target.value)} addonBefore="topK" style={{ width: 140 }} />
            <Input value={previewMinScore} onChange={event => setPreviewMinScore(event.target.value)} addonBefore="minScore" style={{ width: 180 }} />
            <Input value={previewFileIDsText} onChange={event => setPreviewFileIDsText(event.target.value)} addonBefore="fileIds" placeholder="101,102" style={{ width: 220 }} />
            <Input value={previewBizKey} onChange={event => setPreviewBizKey(event.target.value)} addonBefore="bizKey" placeholder="可选" style={{ width: 220 }} />
            <Input value={previewSubjectID} onChange={event => setPreviewSubjectID(event.target.value)} addonBefore="subjectId" placeholder="可选" style={{ width: 170 }} />
            <Input value={previewProjectID} onChange={event => setPreviewProjectID(event.target.value)} addonBefore="projectId" placeholder="可选" style={{ width: 170 }} />
            <Button type="primary" loading={searchPreviewLoading} onClick={runSearchPreview}>执行预览</Button>
          </Space>

          <Table<KnowledgeSearchHitDTO>
            rowKey={buildKnowledgeHitRowKey}
            loading={searchPreviewLoading}
            size="small"
            dataSource={previewHits}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            columns={[
              { title: 'fileId', dataIndex: 'fileId', width: 80 },
              { title: '版本', dataIndex: 'versionNo', width: 70 },
              { title: 'chunk', dataIndex: 'chunkIndex', width: 70 },
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
              { title: 'semantic', dataIndex: 'semanticScore', width: 90, render: (value: number) => Number(value || 0).toFixed(4) },
              { title: 'keyword', dataIndex: 'keywordScore', width: 90, render: (value: number) => Number(value || 0).toFixed(4) },
              { title: 'final', dataIndex: 'finalScore', width: 90, render: (value: number, row) => Number(value || row.score || 0).toFixed(4) },
              { title: 'sourceRef', dataIndex: 'sourceRef', width: 180, render: (value: string) => value || '-' },
              { title: '摘要', dataIndex: 'chunkSummary', width: 260, render: (value: string, row) => value || row.chunkText || '-' },
              { title: '命中文本', dataIndex: 'chunkText', render: (value: string) => value || '-' },
            ]}
          />
        </div>
      </Modal>

      <Modal
        title="新建会话"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={createConversation}
        okText="创建"
        cancelText="取消"
        confirmLoading={createLoading}
      >
        <Form form={createForm} layout="vertical" initialValues={{ title: '', model: defaultModel, systemPrompt: '' }}>
          <Form.Item label="标题" name="title">
            <Input placeholder="可选，例如：项目讨论" />
          </Form.Item>
          <Form.Item label="模型" name="model" rules={[{ required: true, message: '请选择模型' }]}>
            <Select options={enabledModels} placeholder="请选择模型" />
          </Form.Item>
          <Form.Item label="systemPrompt" name="systemPrompt">
            <Input.TextArea placeholder="可选，用于角色设定/约束" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
