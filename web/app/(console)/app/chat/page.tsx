'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Modal, Space, message } from 'antd'
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

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm] = Form.useForm<{ title: string, model: string, systemPrompt: string }>()

  const scrollRef = useRef<HTMLDivElement | null>(null)

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
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

  useEffect(() => {
    if (!canAccess)
      return
    fetchConversations(true)
  }, [canAccess])

  useEffect(() => {
    if (!activeConversationID)
      return
    fetchMessages(activeConversationID)
  }, [activeConversationID])

  const openCreate = () => {
    createForm.setFieldsValue({ title: '', model: '', systemPrompt: '' })
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
          model: values.model || '',
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
    if (!text)
      return

    setSending(true)
    try {
      const data = await request<ChatSendResultDTO>(`/api/chat/conversations/${conversationID}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text, maxContextMessages: 20 }),
      })
      setDraft('')
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
              return (
                <div key={m.id} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={isUser ? 'max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white' : 'max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm text-gray-900'}>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Input.TextArea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
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
      </div>

      <Modal
        title="新建会话"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={createConversation}
        okText="创建"
        cancelText="取消"
        confirmLoading={createLoading}
      >
        <Form form={createForm} layout="vertical" initialValues={{ title: '', model: '', systemPrompt: '' }}>
          <Form.Item label="标题" name="title">
            <Input placeholder="可选，例如：项目讨论" />
          </Form.Item>
          <Form.Item label="模型" name="model">
            <Input placeholder="可选，默认 gpt-4o-mini" />
          </Form.Item>
          <Form.Item label="systemPrompt" name="systemPrompt">
            <Input.TextArea placeholder="可选，用于角色设定/约束" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
