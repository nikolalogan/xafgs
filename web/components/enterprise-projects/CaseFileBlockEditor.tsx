'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Space, Tag, Typography, message } from 'antd'
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Plugin, PluginKey } from '@tiptap/pm/state'

type ApiResponse<T> = {
  message?: string
  data?: T
}

type FileBlockSectionDTO = {
  sectionId: string
  title: string
  level: number
  order: number
  blockIds: number[]
}

type FileBlockItemDTO = {
  blockId: number
  sectionId: string
  sliceType: string
  sourceType: string
  title: string
  pageStart: number
  pageEnd: number
  initialHtml: string
  currentHtml: string
  lastSavedAt: string
}

type FileBlocksDTO = {
  projectId: number
  caseFileId: number
  sections: FileBlockSectionDTO[]
  blocks: FileBlockItemDTO[]
}

type BlockSaveResultDTO = {
  projectId: number
  caseFileId: number
  blockId: number
  currentHtml: string
  updatedAt: string
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

type CaseFileBlockEditorProps = {
  projectId: number
  caseFileId: number
  enabled: boolean
}

const SAVE_DEBOUNCE_MS = 800

const SegmentBlock = Node.create({
  name: 'segmentBlock',
  group: 'block',
  content: 'block+',
  isolating: true,
  defining: true,
  selectable: true,
  addAttributes() {
    return {
      blockId: { default: 0 },
      sectionId: { default: '' },
      title: { default: '' },
      sliceType: { default: '' },
      pageStart: { default: 0 },
      pageEnd: { default: 0 },
    }
  },
  parseHTML() {
    return [{ tag: 'section[data-segment-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-segment-block': '1' }), 0]
  },
})

const SegmentIsolation = Extension.create({
  name: 'segmentIsolation',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('segment-isolation'),
        props: {
          handleKeyDown(view, event) {
            const selection = view.state.selection
            const from = selection.from
            const to = selection.to
            const segmentNameAt = (position: number) => {
              const $pos = view.state.doc.resolve(position)
              for (let depth = $pos.depth; depth >= 0; depth--) {
                if ($pos.node(depth).type.name === 'segmentBlock') {
                  const attrs = $pos.node(depth).attrs as { blockId?: number }
                  return String(attrs?.blockId || '')
                }
              }
              return ''
            }

            const fromSegment = segmentNameAt(from)
            const toSegment = segmentNameAt(Math.max(from, to))
            if (from !== to && fromSegment && toSegment && fromSegment !== toSegment)
              return true

            if (event.key === 'Backspace' && from === to && from > 1) {
              const leftSegment = segmentNameAt(from - 1)
              if (fromSegment && leftSegment && fromSegment !== leftSegment)
                return true
            }
            if (event.key === 'Delete' && from === to && to < view.state.doc.content.size) {
              const rightSegment = segmentNameAt(to + 1)
              if (fromSegment && rightSegment && fromSegment !== rightSegment)
                return true
            }
            return false
          },
        },
      }),
    ]
  },
})

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const escapeAttr = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const normalizeHTML = (value: string) => String(value || '<p></p>').trim()

export default function CaseFileBlockEditor({ projectId, caseFileId, enabled }: CaseFileBlockEditorProps) {
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState<FileBlockSectionDTO[]>([])
  const [blocks, setBlocks] = useState<FileBlockItemDTO[]>([])
  const [saveStateByBlockID, setSaveStateByBlockID] = useState<Record<number, SaveState>>({})
  const [activeOutlineSectionID, setActiveOutlineSectionID] = useState('')
  const baselineByBlockIDRef = useRef<Record<number, string>>({})
  const saveTimerByBlockIDRef = useRef<Record<number, number>>({})
  const isHydratingRef = useRef(false)
  const editorRootRef = useRef<HTMLDivElement | null>(null)

  const blockMap = useMemo(() => {
    const map = new Map<number, FileBlockItemDTO>()
    blocks.forEach(block => map.set(block.blockId, block))
    return map
  }, [blocks])

  const request = async <T,>(url: string, init?: RequestInit) => {
    const token = getToken()
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init?.headers)
      Object.assign(headers, init.headers as Record<string, string>)
    if (token)
      headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, { ...init, headers, credentials: 'include' })
    const payload = await response.json() as ApiResponse<T>
    if (!response.ok)
      throw new Error(payload.message || '请求失败')
    return payload.data as T
  }

  const persistBlock = async (blockId: number, currentHtml: string) => {
    setSaveStateByBlockID(prev => ({ ...prev, [blockId]: 'saving' }))
    try {
      const payload = await request<BlockSaveResultDTO>(
        `/api/enterprise-projects/${projectId}/files/${caseFileId}/blocks/${blockId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ currentHtml }),
        },
      )
      const normalized = normalizeHTML(payload?.currentHtml || currentHtml)
      baselineByBlockIDRef.current[blockId] = normalized
      setSaveStateByBlockID(prev => ({ ...prev, [blockId]: 'saved' }))
      window.setTimeout(() => {
        setSaveStateByBlockID((prev) => {
          if (prev[blockId] !== 'saved')
            return prev
          return { ...prev, [blockId]: 'idle' }
        })
      }, 1200)
    } catch (error) {
      setSaveStateByBlockID(prev => ({ ...prev, [blockId]: 'error' }))
      msgApi.error(error instanceof Error ? error.message : '自动保存失败')
    }
  }

  const scheduleSave = (blockId: number, currentHtml: string) => {
    const normalized = normalizeHTML(currentHtml)
    const baseline = normalizeHTML(baselineByBlockIDRef.current[blockId] || '<p></p>')
    if (normalized === baseline) {
      setSaveStateByBlockID(prev => ({ ...prev, [blockId]: 'idle' }))
      const timer = saveTimerByBlockIDRef.current[blockId]
      if (timer) {
        window.clearTimeout(timer)
        delete saveTimerByBlockIDRef.current[blockId]
      }
      return
    }
    setSaveStateByBlockID(prev => ({ ...prev, [blockId]: 'dirty' }))
    const oldTimer = saveTimerByBlockIDRef.current[blockId]
    if (oldTimer)
      window.clearTimeout(oldTimer)
    saveTimerByBlockIDRef.current[blockId] = window.setTimeout(() => {
      persistBlock(blockId, normalized)
      delete saveTimerByBlockIDRef.current[blockId]
    }, SAVE_DEBOUNCE_MS)
  }

  const editor = useEditor({
    immediatelyRender: false,
    editable: enabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      SegmentBlock,
      SegmentIsolation,
    ],
    content: '<p></p>',
    onUpdate: ({ editor }) => {
      if (isHydratingRef.current)
        return
      const parser = new DOMParser()
      const doc = parser.parseFromString(editor.getHTML(), 'text/html')
      const nodes = Array.from(doc.querySelectorAll('section[data-segment-block]'))
      for (const node of nodes) {
        const blockId = Number(node.getAttribute('data-block-id') || 0)
        if (blockId <= 0)
          continue
        scheduleSave(blockId, node.innerHTML || '<p></p>')
      }
    },
  }, [enabled, projectId, caseFileId])

  const loadBlocks = async () => {
    if (!enabled || !projectId || !caseFileId)
      return
    setLoading(true)
    try {
      const data = await request<FileBlocksDTO>(`/api/enterprise-projects/${projectId}/files/${caseFileId}/blocks`, { method: 'GET' })
      const sectionRows = Array.isArray(data?.sections) ? data.sections : []
      const blockRows = Array.isArray(data?.blocks) ? data.blocks : []
      setSections(sectionRows)
      setBlocks(blockRows)
      const nextBaseline: Record<number, string> = {}
      const nextStates: Record<number, SaveState> = {}
      for (const block of blockRows) {
        nextBaseline[block.blockId] = normalizeHTML(block.currentHtml || block.initialHtml)
        nextStates[block.blockId] = 'idle'
      }
      baselineByBlockIDRef.current = nextBaseline
      setSaveStateByBlockID(nextStates)
      setActiveOutlineSectionID(sectionRows[0]?.sectionId || '')
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载分块失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBlocks()
  }, [enabled, projectId, caseFileId])

  useEffect(() => {
    return () => {
      Object.values(saveTimerByBlockIDRef.current).forEach((timer) => {
        window.clearTimeout(timer)
      })
      saveTimerByBlockIDRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (!editor)
      return
    if (blocks.length === 0) {
      isHydratingRef.current = true
      editor.commands.setContent('<p></p>')
      window.setTimeout(() => { isHydratingRef.current = false }, 0)
      return
    }
    const htmlParts: string[] = []
    for (const section of sections) {
      const level = Math.min(4, Math.max(1, Number(section.level || 2)))
      htmlParts.push(`<h${level} data-outline-id="${escapeAttr(section.sectionId)}">${escapeAttr(section.title || '内容')}</h${level}>`)
      for (const blockId of section.blockIds || []) {
        const block = blockMap.get(blockId)
        if (!block)
          continue
        const content = normalizeHTML(block.currentHtml || block.initialHtml)
        htmlParts.push(
          `<section data-segment-block="1" data-block-id="${block.blockId}" data-section-id="${escapeAttr(block.sectionId)}" data-segment-title="${escapeAttr(block.title || `${block.sliceType} #${block.blockId}`)}" data-segment-type="${escapeAttr(block.sliceType)}" data-page-start="${block.pageStart}" data-page-end="${block.pageEnd}">${content}</section>`,
        )
      }
    }
    isHydratingRef.current = true
    editor.commands.setContent(htmlParts.join(''))
    window.setTimeout(() => { isHydratingRef.current = false }, 0)
  }, [editor, sections, blocks, blockMap])

  const outlineRows = useMemo(() => {
    return sections.map((section) => {
      const dirtyCount = (section.blockIds || []).filter((blockId) => {
        const state = saveStateByBlockID[blockId] || 'idle'
        return state === 'dirty' || state === 'saving' || state === 'error'
      }).length
      return { section, dirtyCount }
    })
  }, [sections, saveStateByBlockID])

  const stateTagColor = (state: SaveState) => {
    if (state === 'saving')
      return 'processing'
    if (state === 'saved')
      return 'success'
    if (state === 'error')
      return 'error'
    if (state === 'dirty')
      return 'warning'
    return 'default'
  }

  const jumpToSection = (sectionId: string) => {
    if (!sectionId)
      return
    setActiveOutlineSectionID(sectionId)
    const root = editorRootRef.current
    if (!root)
      return
    const heading = root.querySelector(`[data-outline-id="${CSS.escape(sectionId)}"]`)
    if (heading instanceof HTMLElement)
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Card size="small" title="文本分块编辑（单编辑器模式）" loading={loading}>
      {contextHolder}
      <div className="mb-3 text-xs text-gray-500">单文件单编辑器，章节为大纲；每段独立隔离并按段自动保存。</div>
      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3">
        <div className="max-h-[640px] overflow-auto rounded border border-gray-200 bg-gray-50 p-2">
          <div className="mb-2 text-xs font-medium text-gray-600">大纲</div>
          <Space direction="vertical" size={6} className="w-full">
            {outlineRows.map(({ section, dirtyCount }) => (
              <Button
                key={section.sectionId}
                type={activeOutlineSectionID === section.sectionId ? 'primary' : 'default'}
                className="justify-start"
                onClick={() => jumpToSection(section.sectionId)}
              >
                <span className="truncate">{section.title || '内容'}</span>
                <Tag className="ml-2">{section.blockIds.length}</Tag>
                {dirtyCount > 0 ? <Tag color="warning">{dirtyCount}</Tag> : null}
              </Button>
            ))}
          </Space>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {blocks.map((block) => {
              const state = saveStateByBlockID[block.blockId] || 'idle'
              return (
                <Tag key={block.blockId} color={stateTagColor(state)}>
                  {block.title || `${block.sliceType} #${block.blockId}`} · p{block.pageStart}-{block.pageEnd}
                </Tag>
              )
            })}
          </div>
          <div ref={editorRootRef} className="case-file-single-editor rounded border border-gray-200 bg-white p-3">
            {editor
              ? <EditorContent editor={editor} />
              : <Typography.Text type="secondary">编辑器初始化中…</Typography.Text>}
          </div>
        </div>
      </div>
      <style jsx global>{`
        .case-file-single-editor .ProseMirror {
          min-height: 560px;
          max-height: 640px;
          overflow: auto;
          outline: none;
          line-height: 1.7;
          padding-right: 6px;
        }
        .case-file-single-editor .ProseMirror h1,
        .case-file-single-editor .ProseMirror h2,
        .case-file-single-editor .ProseMirror h3,
        .case-file-single-editor .ProseMirror h4 {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #fff;
          margin-top: 16px;
          margin-bottom: 8px;
          padding: 2px 6px;
          border-left: 3px solid #1677ff;
        }
        .case-file-single-editor .ProseMirror section[data-segment-block] {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #fcfcfd;
          padding: 10px 12px;
          margin: 10px 0;
        }
        .case-file-single-editor .ProseMirror section[data-segment-block]:focus-within {
          border-color: #1677ff;
          box-shadow: 0 0 0 1px rgba(22, 119, 255, 0.18);
          background: #fff;
        }
      `}</style>
    </Card>
  )
}
