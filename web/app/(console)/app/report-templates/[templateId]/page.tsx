'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Card, Input, Space, Switch, Tag, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { useConsoleRole } from '@/lib/useConsoleRole'
import { SimpleEditor, type SimpleEditorHandle } from '@/components/tiptap-templates/simple/simple-editor'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type CategoryItem = {
  key: string
  name: string
  required?: boolean
  isTable?: boolean
}

type ReportTemplateDetailDTO = {
  id: number
  templateKey: string
  name: string
  description: string
  status: 'active' | 'disabled'
  categories?: unknown
  processingConfig?: unknown
  contentMarkdown?: string
  outline?: unknown
  editorConfig?: unknown
  annotations?: unknown
}

type ReportTemplateAIAssistResponse = {
  resultText: string
  model: string
}

type OutlineItem = {
  id: string
  level: 1 | 2 | 3
  text: string
  order: number
}

const FIXED_CATEGORY_NAMES = ['主体', '区域', '财务', '项目', '反担保', '反担保财报'] as const

const turndown = new TurndownService({ codeBlockStyle: 'fenced' })

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

export default function ReportTemplateEditorPage() {
  const params = useParams<{ templateId: string }>()
  const router = useRouter()
  const { role, hydrated } = useConsoleRole()
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<ReportTemplateDetailDTO | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [savingCategories] = useState(false)
  const [savingContent, setSavingContent] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [exportingWord, setExportingWord] = useState(false)
  const [editorHTML, setEditorHTML] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [activeOutlineId, setActiveOutlineId] = useState('')
  const editorRef = useRef<SimpleEditorHandle | null>(null)
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const headingHighlightTimerRef = useRef<number | null>(null)
  const templateId = Number(params?.templateId || 0)
  const isAdmin = role === 'admin'

  const editorInitialHTML = useMemo(
    () => String(marked.parse(detail?.contentMarkdown || '')),
    [detail?.contentMarkdown],
  )

  const currentMarkdown = useMemo(() => {
    if (editorHTML.trim() !== '')
      return turndown.turndown(editorHTML)
    return detail?.contentMarkdown || ''
  }, [detail?.contentMarkdown, editorHTML])

  const outlineItems = useMemo<OutlineItem[]>(() => {
    const sourceHTML = (editorHTML || editorInitialHTML || '').trim()
    if (!sourceHTML)
      return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(sourceHTML, 'text/html')
    const headings = Array.from(doc.querySelectorAll('h1, h2, h3'))
    const items: OutlineItem[] = []
    headings.forEach((node, index) => {
      const tag = node.tagName.toLowerCase()
      const level = Number(tag.slice(1)) as 1 | 2 | 3
      const text = (node.textContent || '').trim()
      if (!text || ![1, 2, 3].includes(level))
        return
      items.push({
        id: `${level}-${index}-${text}`,
        level,
        text,
        order: index,
      })
    })
    return items
  }, [editorHTML, editorInitialHTML])

  const scrollToOutlineItem = (item: OutlineItem) => {
    const root = editorHostRef.current
    if (!root)
      return
    const headings = root.querySelectorAll('h1, h2, h3')
    if (!headings.length)
      return
    const node = headings[item.order] as HTMLElement | undefined
    if (!node)
      return
    setActiveOutlineId(item.id)
    headings.forEach(heading => heading.classList.remove('report-template-heading-highlight'))
    node.classList.add('report-template-heading-highlight')
    if (headingHighlightTimerRef.current !== null) {
      window.clearTimeout(headingHighlightTimerRef.current)
      headingHighlightTimerRef.current = null
    }
    headingHighlightTimerRef.current = window.setTimeout(() => {
      node.classList.remove('report-template-heading-highlight')
      headingHighlightTimerRef.current = null
    }, 1400)
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  useEffect(() => {
    return () => {
      if (headingHighlightTimerRef.current !== null)
        window.clearTimeout(headingHighlightTimerRef.current)
    }
  }, [])

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
      router.push('/?redirect=/app/report-templates')
      throw new Error('未登录或登录已过期')
    }
    if (response.status === 403)
      throw new Error(payload.message || '无权限访问')
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const requestBinary = async (url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, { ...init, headers, credentials: 'include' })
    if (!response.ok)
      throw new Error('导出失败')
    return response
  }

  const loadTemplateDetail = async () => {
    if (!templateId)
      return
    setLoading(true)
    try {
      const row = await request<ReportTemplateDetailDTO>(`/api/report-templates/${templateId}`, { method: 'GET' })
      setDetail(row)
      setCategories(parseCategories(row.categories))
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载模板详情失败')
    }
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hydrated && (role === 'admin' || role === 'user'))
      loadTemplateDetail()
  }, [hydrated, role, templateId])

  useEffect(() => {
    setEditorHTML(editorInitialHTML)
  }, [editorInitialHTML])

  const importWord = async () => {
    if (!isAdmin) {
      msgApi.warning('仅管理员可导入模板文档')
      return
    }
    if (!templateId) {
      msgApi.warning('模板 ID 无效')
      return
    }
    const file = uploadFileList[0]?.originFileObj
    if (!file) {
      msgApi.warning('请先选择 .docx 文件')
      return
    }
    const lower = (file.name || '').toLowerCase()
    if (lower.endsWith('.doc')) {
      msgApi.warning('当前仅支持 .docx，请先转换格式')
      return
    }
    if (!lower.endsWith('.docx')) {
      msgApi.warning('仅支持 .docx 文件')
      return
    }
    const formData = new FormData()
    formData.append('file', file)
    setUploading(true)
    try {
      await request(`/api/report-templates/${templateId}/import-word`, {
        method: 'POST',
        body: formData,
      })
      msgApi.success('Word 导入成功')
      setUploadFileList([])
      await loadTemplateDetail()
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '导入失败')
    }
    finally {
      setUploading(false)
    }
  }

  const exportWord = async () => {
    if (!templateId) {
      msgApi.warning('模板 ID 无效')
      return
    }
    setExportingWord(true)
    try {
      const response = await requestBinary(`/api/report-templates/${templateId}/export-word`, { method: 'GET' })
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const fileName = decodeURIComponent((disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || '').trim()) || `${detail?.name || 'report-template'}.docx`
      const objectURL = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectURL
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(objectURL)
      msgApi.success('Word 导出成功')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Word 导出失败')
    }
    finally {
      setExportingWord(false)
    }
  }

  const normalizeCategoryKey = (value: string) => {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[\s/\\-]+/g, '_')
      .replace(/[^\w\u4e00-\u9fa5]/g, '')
      .replace(/^_+|_+$/g, '')
    return normalized || 'category'
  }

  const allocateCategoryKey = (name: string) => {
    const baseKey = normalizeCategoryKey(name)
    const used = new Set(categories.map(item => item.key))
    if (!used.has(baseKey))
      return baseKey
    let suffix = 2
    while (used.has(`${baseKey}_${suffix}`))
      suffix++
    return `${baseKey}_${suffix}`
  }

  const addCategory = () => {
    if (!isAdmin)
      return
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      msgApi.warning('分类名称不能为空')
      return
    }
    const exists = categories.some(item => item.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (exists) {
      msgApi.warning('分类名称已存在')
      return
    }
    const next: CategoryItem = {
      key: allocateCategoryKey(trimmed),
      name: trimmed,
      required: false,
      isTable: false,
    }
    setCategories(prev => [...prev, next])
    setNewCategoryName('')
  }

  const removeCategory = (categoryKey: string) => {
    if (!isAdmin)
      return
    const target = categories.find(item => item.key === categoryKey)
    if (target && FIXED_CATEGORY_NAMES.includes(target.name as (typeof FIXED_CATEGORY_NAMES)[number])) {
      msgApi.warning('固定分类不可删除')
      return
    }
    setCategories(prev => prev.filter(item => item.key !== categoryKey))
  }

  const updateCategoryRequired = (categoryKey: string, required: boolean) => {
    if (!isAdmin)
      return
    setCategories(prev => prev.map(item => item.key === categoryKey ? { ...item, required } : item))
  }

  const updateCategoryIsTable = (categoryKey: string, isTable: boolean) => {
    if (!isAdmin)
      return
    setCategories(prev => prev.map(item => item.key === categoryKey ? { ...item, isTable } : item))
  }

  const saveTemplate = async (withToast = true) => {
    if (!isAdmin || !detail || !templateId) {
      return
    }
    const sourceHTML = editorRef.current?.getHTML() || editorHTML
    const markdown = sourceHTML ? turndown.turndown(sourceHTML) : (detail.contentMarkdown || '')
    setSavingContent(true)
    try {
      const updated = await request<ReportTemplateDetailDTO>(`/api/report-templates/${templateId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: detail.name,
          description: detail.description || '',
          status: detail.status || 'active',
          categoriesJson: categories,
          processingConfigJson: detail.processingConfig || {},
          contentMarkdown: markdown,
          editorConfigJson: detail.editorConfig || {},
          annotationsJson: detail.annotations || [],
        }),
      })
      setDetail(updated)
      if (withToast)
        msgApi.success('模板内容已保存')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : '保存失败')
      throw error
    }
    finally {
      setSavingContent(false)
    }
  }

  const runAiAssist = async (mode: string, instruction: string) => {
    if (!templateId) {
      msgApi.warning('编辑器未就绪')
      return
    }
    const selected = editorRef.current?.getSelectedText() || selectedText
    if (mode !== 'continue' && !selected) {
      msgApi.warning('请先选中需要处理的文本')
      return
    }
    setAiLoading(true)
    try {
      const sourceHTML = editorRef.current?.getHTML() || editorHTML
      const payload = await request<ReportTemplateAIAssistResponse>(`/api/report-templates/${templateId}/ai-assist`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          instruction,
          selectedText: selected,
          fullMarkdown: turndown.turndown(sourceHTML || ''),
        }),
      })
      const resultText = (payload?.resultText || '').trim()
      if (!resultText) {
        msgApi.warning('AI 未返回有效内容')
        return
      }
      if (selected) {
        editorRef.current?.replaceSelection(resultText)
      }
      else {
        editorRef.current?.insertText(`\n${resultText}`)
      }
      setEditorHTML(editorRef.current?.getHTML() || '')
      msgApi.success('AI 处理完成')
    }
    catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'AI 处理失败')
    }
    finally {
      setAiLoading(false)
    }
  }

  if (!hydrated) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">{contextHolder}<div className="text-sm text-gray-500">加载中...</div></div>
  }

  if (role === 'guest') {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">{contextHolder}<div className="text-sm text-gray-500">请先登录。</div></div>
  }

  return (
    <div className="space-y-4">
      {contextHolder}
      <Card
        title="报告模板编辑"
        extra={(
          <Space>
            <Button onClick={() => router.push('/app/report-templates')}>返回列表</Button>
            <Button onClick={loadTemplateDetail} loading={loading}>刷新</Button>
            <Button onClick={exportWord} loading={exportingWord}>导出 Word</Button>
            {isAdmin && <Button type="primary" onClick={() => saveTemplate(true)} loading={savingContent}>保存内容</Button>}
          </Space>
        )}
      >
        <Space wrap className="mb-3">
          <Input style={{ width: 260 }} value={detail?.name || ''} readOnly />
          <Input style={{ width: 260 }} value={detail?.templateKey || ''} readOnly />
          <Input style={{ width: 320 }} value={detail?.description || ''} readOnly />
          <Typography.Text type="secondary">TipTap 官方 Simple Editor（Markdown 持久化）</Typography.Text>
        </Space>

        {isAdmin && (
          <Space wrap className="mb-3">
            <Upload
              maxCount={1}
              beforeUpload={(file) => {
                const lower = file.name.toLowerCase()
                if (lower.endsWith('.doc')) {
                  msgApi.warning('当前仅支持 .docx，请先转换格式')
                  return Upload.LIST_IGNORE
                }
                if (!lower.endsWith('.docx')) {
                  msgApi.warning('仅支持 .docx')
                  return Upload.LIST_IGNORE
                }
                return false
              }}
              fileList={uploadFileList}
              onChange={({ fileList }) => setUploadFileList(fileList)}
            >
              <Button>选择 Word(.docx)</Button>
            </Upload>
            <Button loading={uploading} onClick={importWord}>导入并覆盖模板文档</Button>
          </Space>
        )}

        <div className="mb-3 rounded-md border border-gray-200 p-3">
          <div className="mb-2 text-sm font-medium text-gray-700">文件分类列表</div>
          {isAdmin && (
            <Space wrap className="mb-2">
              <Input
                style={{ width: 300 }}
                placeholder="输入分类名称后添加"
                value={newCategoryName}
                onChange={event => setNewCategoryName(event.target.value)}
                onPressEnter={addCategory}
              />
              <Button onClick={addCategory}>新增分类</Button>
              <Button type="primary" loading={savingCategories || savingContent} onClick={() => saveTemplate(true)}>保存分类</Button>
            </Space>
          )}
          {!isAdmin && <Typography.Text type="secondary">仅管理员可编辑分类。</Typography.Text>}
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.length === 0 && <Typography.Text type="secondary">暂无分类</Typography.Text>}
            {categories.map(item => (
              <div key={item.key} className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1">
                <Tag color={item.required ? 'blue' : 'default'}>{item.name}</Tag>
                {FIXED_CATEGORY_NAMES.includes(item.name as (typeof FIXED_CATEGORY_NAMES)[number]) ? <Tag color="gold">固定</Tag> : null}
                {item.isTable ? <Tag color="purple">表格</Tag> : null}
                <Typography.Text type="secondary">{item.key}</Typography.Text>
                {isAdmin && (
                  <>
                    <span className="text-xs text-gray-500">必填</span>
                    <Switch
                      size="small"
                      checked={Boolean(item.required)}
                      onChange={checked => updateCategoryRequired(item.key, checked)}
                    />
                    <span className="text-xs text-gray-500">表格</span>
                    <Switch
                      size="small"
                      checked={Boolean(item.isTable)}
                      onChange={checked => updateCategoryIsTable(item.key, checked)}
                    />
                    {!FIXED_CATEGORY_NAMES.includes(item.name as (typeof FIXED_CATEGORY_NAMES)[number]) && (
                      <Button size="small" danger type="link" onClick={() => removeCategory(item.key)}>删除</Button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-gray-200 p-2">
          <div className="mb-2 text-sm font-medium text-gray-700">AI 工具栏</div>
          <Space wrap className="mb-3">
            <Button loading={aiLoading} onClick={() => runAiAssist('rewrite', '请保持原意进行专业化改写，输出中文。')}>改写</Button>
            <Button loading={aiLoading} onClick={() => runAiAssist('expand', '请在不改变事实的前提下扩写，补充上下文。')}>扩写</Button>
            <Button loading={aiLoading} onClick={() => runAiAssist('summarize', '请提炼为简洁专业摘要。')}>总结</Button>
            <Button loading={aiLoading} onClick={() => runAiAssist('polish', '请润色语句，提升可读性与正式程度。')}>润色</Button>
            <Button loading={aiLoading} onClick={() => runAiAssist('continue', '请基于上下文续写下一个自然段。')}>续写</Button>
          </Space>
          <div className="mb-2 text-sm font-medium text-gray-700">在线文档编辑器（Official Simple Editor）</div>
          <div ref={editorHostRef} className="report-template-editor-host">
            <SimpleEditor
              ref={editorRef}
              initialContent={editorInitialHTML}
              onUpdateHTML={setEditorHTML}
              onSelectionTextChange={setSelectedText}
              editable
            />
            <aside className="report-template-outline-floating">
              <div className="report-template-outline-title">大纲</div>
              {outlineItems.length === 0 && (
                <div className="report-template-outline-empty">暂无标题（请使用 H1-H3）</div>
              )}
              {outlineItems.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`report-template-outline-item level-${item.level} ${activeOutlineId === item.id ? 'is-active' : ''}`}
                  onClick={() => scrollToOutlineItem(item)}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </aside>
          </div>
          <div className="mt-2 text-xs text-gray-500">当前内容约 {currentMarkdown.length} 字符（Markdown）</div>
        </div>
      </Card>
      <style jsx global>{`
        .report-template-editor-host {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
          position: relative;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          height: 76vh;
          min-height: 640px;
          max-height: 76vh;
        }
        .report-template-editor-host .simple-editor-wrapper {
          width: 100%;
          height: 100%;
          min-height: 0;
          max-height: 100%;
        }
        .report-template-editor-host .tiptap-toolbar[data-variant='fixed'] {
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .report-template-outline-floating {
          display: none;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          padding: 10px 8px;
          width: 220px;
          max-height: calc(76vh - 64px);
          overflow: auto;
          position: absolute;
          left: 12px;
          top: 56px;
          z-index: 25;
          box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
        }
        .report-template-outline-title {
          font-size: 12px;
          color: #6b7280;
          margin: 0 6px 8px;
          font-weight: 600;
        }
        .report-template-outline-empty {
          color: #9ca3af;
          font-size: 12px;
          margin: 0 6px;
        }
        .report-template-outline-item {
          width: 100%;
          border: 0;
          background: transparent;
          text-align: left;
          color: #374151;
          font-size: 13px;
          line-height: 1.35;
          border-radius: 8px;
          padding: 6px 8px;
          cursor: pointer;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .report-template-outline-item:hover {
          background: #f3f4f6;
        }
        .report-template-outline-item.is-active {
          background: #e8f1ff;
          color: #1d4ed8;
        }
        .report-template-outline-item.level-2 {
          padding-left: 18px;
        }
        .report-template-outline-item.level-3 {
          padding-left: 28px;
          color: #6b7280;
        }
        .report-template-outline-item.level-3.is-active {
          color: #1d4ed8;
        }
        .report-template-heading-highlight {
          background: linear-gradient(90deg, rgba(250, 204, 21, 0.28), rgba(250, 204, 21, 0));
          transition: background 0.25s ease;
        }
        @media (min-width: 1360px) {
          .report-template-editor-host .simple-editor-content .tiptap.ProseMirror.simple-editor {
            max-width: 900px;
            padding-left: 260px;
          }
          .report-template-outline-floating {
            display: block;
          }
        }
      `}</style>
    </div>
  )
}

function parseCategories(raw: unknown): CategoryItem[] {
  const parsed = Array.isArray(raw) ? raw : []
  const parsedItems: CategoryItem[] = []
  const byName = new Map<string, CategoryItem>()
  const usedKeys = new Set<string>()

  const normalizeName = (value: string) => value.trim()
  const normalizeKey = (value: string) => {
    const candidate = value.trim()
    if (candidate)
      return candidate
    return 'category'
  }

  const allocateKey = (preferred: string) => {
    const base = normalizeKey(preferred)
    if (!usedKeys.has(base)) {
      usedKeys.add(base)
      return base
    }
    let suffix = 2
    while (usedKeys.has(`${base}_${suffix}`))
      suffix++
    const next = `${base}_${suffix}`
    usedKeys.add(next)
    return next
  }

  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const name = normalizeName(String(record.name || ''))
    if (!name) {
      continue
    }
    const normalizedName = name.toLowerCase()
    if (byName.has(normalizedName))
      continue
    const key = allocateKey(String(record.key || '').trim() || name)
    const category: CategoryItem = {
      key,
      name,
      required: Boolean(record.required),
      isTable: Boolean(record.isTable),
    }
    byName.set(normalizedName, category)
    parsedItems.push(category)
  }

  const out: CategoryItem[] = []
  for (const fixedName of FIXED_CATEGORY_NAMES) {
    const matched = byName.get(fixedName.toLowerCase())
    if (matched) {
      out.push(matched)
      continue
    }
    out.push({
      key: allocateKey(fixedName),
      name: fixedName,
      required: false,
      isTable: false,
    })
  }

  for (const item of parsedItems) {
    if (FIXED_CATEGORY_NAMES.includes(item.name as (typeof FIXED_CATEGORY_NAMES)[number]))
      continue
    out.push(item)
  }

  return out
}
