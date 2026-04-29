'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Space, Tag, Typography, message } from 'antd'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { SimpleEditor, type SimpleEditorHandle } from '@/components/tiptap-templates/simple/simple-editor'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type FileMarkdownDTO = {
  projectId: number
  caseFileId: number
  fileId: number
  versionNo: number
  fileName: string
  contentMarkdown: string
  updatedAt: string
}

type FileMarkdownUpdateResultDTO = {
  projectId: number
  caseFileId: number
  contentMarkdown: string
  updatedAt: string
}

const SAVE_DEBOUNCE_MS = 900
const turndown = new TurndownService({ codeBlockStyle: 'fenced' })

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function EnterpriseProjectFileMarkdownPage() {
  const params = useParams<{ projectId: string, caseFileId: string }>()
  const router = useRouter()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<FileMarkdownDTO | null>(null)
  const [editorHTML, setEditorHTML] = useState('')
  const editorRef = useRef<SimpleEditorHandle | null>(null)
  const lastSavedMarkdownRef = useRef('')
  const pendingMarkdownRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)
  const suppressNextAutosaveRef = useRef(false)
  const projectId = Number(params?.projectId || 0)
  const caseFileId = Number(params?.caseFileId || 0)

  const initialHTML = useMemo(
    () => String(marked.parse(detail?.contentMarkdown || '')),
    [detail?.contentMarkdown],
  )

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

  const buildMarkdown = () => {
    const sourceHTML = editorRef.current?.getHTML() || editorHTML || initialHTML
    return sourceHTML ? turndown.turndown(sourceHTML) : ''
  }

  const loadDetail = async () => {
    if (!projectId || !caseFileId)
      return
    setLoading(true)
    try {
      const data = await request<FileMarkdownDTO>(`/api/enterprise-projects/${projectId}/files/${caseFileId}/markdown`, { method: 'GET' })
      suppressNextAutosaveRef.current = true
      setDetail(data)
      lastSavedMarkdownRef.current = data?.contentMarkdown || ''
      pendingMarkdownRef.current = data?.contentMarkdown || ''
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载 Markdown 失败')
    } finally {
      setLoading(false)
    }
  }

  const persistMarkdown = async (markdown: string, keepalive = false) => {
    if (!projectId || !caseFileId)
      return
    if (markdown === lastSavedMarkdownRef.current)
      return
    setSaving(true)
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token)
      headers.Authorization = `Bearer ${token}`
    try {
      const response = await fetch(`/api/enterprise-projects/${projectId}/files/${caseFileId}/markdown`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        keepalive,
        body: JSON.stringify({ contentMarkdown: markdown }),
      })
      const payload = await response.json() as ApiResponse<FileMarkdownUpdateResultDTO>
      if (!response.ok)
        throw new Error(payload.message || '保存失败')
      lastSavedMarkdownRef.current = payload.data?.contentMarkdown || markdown
      pendingMarkdownRef.current = lastSavedMarkdownRef.current
      setDetail(prev => prev
        ? { ...prev, contentMarkdown: lastSavedMarkdownRef.current, updatedAt: payload.data?.updatedAt || prev.updatedAt }
        : prev)
    } finally {
      setSaving(false)
    }
  }

  const scheduleSave = () => {
    const nextMarkdown = buildMarkdown()
    pendingMarkdownRef.current = nextMarkdown
    if (saveTimerRef.current !== null)
      window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistMarkdown(nextMarkdown)
    }, SAVE_DEBOUNCE_MS)
  }

  const flushPending = (keepalive = false) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const nextMarkdown = pendingMarkdownRef.current || buildMarkdown()
    if (nextMarkdown !== lastSavedMarkdownRef.current)
      void persistMarkdown(nextMarkdown, keepalive)
  }

  useEffect(() => {
    void loadDetail()
  }, [projectId, caseFileId])

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPending(true)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flushPending(true)
    }
  }, [projectId, caseFileId, editorHTML, initialHTML])

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        loading={loading}
        title={detail?.fileName || '单文件 Markdown 编辑'}
        extra={(
          <Space>
            <Tag color={saving ? 'processing' : 'success'}>{saving ? '保存中' : '已自动保存'}</Tag>
            <Button onClick={() => router.push(`/app/enterprise-projects/${projectId}/confirm`)}>返回确认页</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => flushPending()}
            >
              立即保存
            </Button>
          </Space>
        )}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{`文件ID ${detail?.fileId || '-'}`}</span>
          <span>{`版本 v${detail?.versionNo || '-'}`}</span>
          <Typography.Text type="secondary">单栏实际效果编辑，Markdown 作为持久化格式保存。</Typography.Text>
        </div>
        <div className="enterprise-project-markdown-editor">
          <SimpleEditor
            ref={editorRef}
            initialContent={initialHTML}
            onUpdateHTML={(html) => {
              setEditorHTML(html)
              if (suppressNextAutosaveRef.current) {
                suppressNextAutosaveRef.current = false
                return
              }
              scheduleSave()
            }}
          />
        </div>
      </Card>
      <style jsx global>{`
        .enterprise-project-markdown-editor .tiptap-toolbar[data-variant='fixed'] {
          position: sticky;
          top: 72px;
          z-index: 20;
        }
        .enterprise-project-markdown-editor .simple-editor-content .tiptap.ProseMirror.simple-editor {
          min-height: 70vh;
        }
      `}</style>
    </div>
  )
}
