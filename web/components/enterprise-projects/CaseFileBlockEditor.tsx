'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Card, Select, Tag, Typography, message } from 'antd'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import UniverTableEditor from '@/components/enterprise-projects/UniverTableEditor'

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

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const normalizeHTML = (value: string) => String(value || '<p></p>').trim()

export default function CaseFileBlockEditor({ projectId, caseFileId, enabled }: CaseFileBlockEditorProps) {
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState<FileBlockSectionDTO[]>([])
  const [blocks, setBlocks] = useState<FileBlockItemDTO[]>([])
  const [saveStateByBlockID, setSaveStateByBlockID] = useState<Record<number, SaveState>>({})
  const [tableRenderErrorByBlockID, setTableRenderErrorByBlockID] = useState<Record<number, string>>({})
  const [activeBlockID, setActiveBlockID] = useState(0)
  const baselineByBlockIDRef = useRef<Record<number, string>>({})
  const pendingHTMLByBlockIDRef = useRef<Record<number, string>>({})
  const saveTimerByBlockIDRef = useRef<Record<number, number>>({})
  const blockSliceTypeByIDRef = useRef<Record<number, string>>({})
  const isHydratingRef = useRef(false)
  const activeBlockIDRef = useRef(0)

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

  const sectionByID = useMemo(() => {
    const map = new Map<string, FileBlockSectionDTO>()
    sections.forEach(section => map.set(section.sectionId, section))
    return map
  }, [sections])

  const blockByID = useMemo(() => {
    const map = new Map<number, FileBlockItemDTO>()
    blocks.forEach(block => map.set(block.blockId, block))
    return map
  }, [blocks])

  const orderedBlocks = useMemo(() => {
    const out: FileBlockItemDTO[] = []
    const visited = new Set<number>()
    for (const section of sections) {
      for (const blockId of section.blockIds || []) {
        const block = blockByID.get(blockId)
        if (!block || visited.has(block.blockId))
          continue
        visited.add(block.blockId)
        out.push(block)
      }
    }
    for (const block of blocks) {
      if (visited.has(block.blockId))
        continue
      out.push(block)
    }
    return out
  }, [sections, blocks, blockByID])

  const activeBlock = useMemo(() => blockByID.get(activeBlockID), [blockByID, activeBlockID])
  const activeSection = useMemo(() => activeBlock ? sectionByID.get(activeBlock.sectionId) : undefined, [activeBlock, sectionByID])
  const isTableBlock = (block?: FileBlockItemDTO) => block?.sliceType === 'table'

  const persistBlock = async (blockId: number, currentHtml: string) => {
    if (blockId === 0)
      return
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
      pendingHTMLByBlockIDRef.current[blockId] = normalized
      setBlocks(prev => prev.map(block => block.blockId === blockId
        ? { ...block, currentHtml: normalized, lastSavedAt: payload?.updatedAt || block.lastSavedAt }
        : block))
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
    if (blockId === 0)
      return
    const normalized = normalizeHTML(currentHtml)
    pendingHTMLByBlockIDRef.current[blockId] = normalized
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
      void persistBlock(blockId, normalized)
      delete saveTimerByBlockIDRef.current[blockId]
    }, SAVE_DEBOUNCE_MS)
  }

  const editor = useEditor({
    immediatelyRender: false,
    editable: enabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '<p></p>',
    onUpdate: ({ editor }) => {
      if (isHydratingRef.current)
        return
      const blockId = activeBlockIDRef.current
      if (blockId === 0)
        return
      if (blockSliceTypeByIDRef.current[blockId] === 'table')
        return
      scheduleSave(blockId, editor.getHTML() || '<p></p>')
    },
  }, [enabled, projectId, caseFileId])

  const flushBlockIfDirty = async (blockId: number) => {
    if (blockId === 0)
      return
    const timer = saveTimerByBlockIDRef.current[blockId]
    if (timer) {
      window.clearTimeout(timer)
      delete saveTimerByBlockIDRef.current[blockId]
    }
    const isActiveTable = blockSliceTypeByIDRef.current[blockId] === 'table'
    const latestHTML = blockId === activeBlockIDRef.current && editor && !isActiveTable
      ? normalizeHTML(editor.getHTML() || '<p></p>')
      : normalizeHTML(pendingHTMLByBlockIDRef.current[blockId] || '<p></p>')
    const baseline = normalizeHTML(baselineByBlockIDRef.current[blockId] || '<p></p>')
    if (latestHTML !== baseline)
      await persistBlock(blockId, latestHTML)
  }

  const switchActiveBlock = async (nextBlockId: number) => {
    if (nextBlockId === 0 || nextBlockId === activeBlockIDRef.current)
      return
    const current = activeBlockIDRef.current
    if (current > 0)
      await flushBlockIfDirty(current)
    setActiveBlockID(nextBlockId)
    activeBlockIDRef.current = nextBlockId
  }

  const loadBlocks = async () => {
    if (!enabled || !projectId || !caseFileId)
      return
    setLoading(true)
    try {
      const data = await request<FileBlocksDTO>(`/api/enterprise-projects/${projectId}/files/${caseFileId}/blocks`, { method: 'GET' })
      const sectionRows = Array.isArray(data?.sections) ? data.sections : []
      const blockRows = Array.isArray(data?.blocks) ? data.blocks : []
      const nextBaseline: Record<number, string> = {}
      const nextStates: Record<number, SaveState> = {}
      for (const block of blockRows) {
        const normalized = normalizeHTML(block.currentHtml || block.initialHtml)
        nextBaseline[block.blockId] = normalized
        nextStates[block.blockId] = 'idle'
      }
      baselineByBlockIDRef.current = nextBaseline
      pendingHTMLByBlockIDRef.current = { ...nextBaseline }
      const nextBlockTypeMap: Record<number, string> = {}
      for (const block of blockRows) {
        nextBlockTypeMap[block.blockId] = String(block.sliceType || '')
      }
      blockSliceTypeByIDRef.current = nextBlockTypeMap
      setSections(sectionRows)
      setBlocks(blockRows)
      setSaveStateByBlockID(nextStates)
      setTableRenderErrorByBlockID({})
      const firstBlockId = sectionRows[0]?.blockIds?.[0] || blockRows[0]?.blockId || 0
      setActiveBlockID(firstBlockId)
      activeBlockIDRef.current = firstBlockId
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '加载分块失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBlocks()
  }, [enabled, projectId, caseFileId])

  useEffect(() => {
    activeBlockIDRef.current = activeBlockID
  }, [activeBlockID])

  useEffect(() => {
    return () => {
      Object.values(saveTimerByBlockIDRef.current).forEach((timer) => {
        window.clearTimeout(timer)
      })
      saveTimerByBlockIDRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (orderedBlocks.length === 0) {
      setActiveBlockID(0)
      activeBlockIDRef.current = 0
      return
    }
    if (!orderedBlocks.some(block => block.blockId === activeBlockID)) {
      const fallback = orderedBlocks[0].blockId
      setActiveBlockID(fallback)
      activeBlockIDRef.current = fallback
    }
  }, [orderedBlocks, activeBlockID])

  useEffect(() => {
    if (!editor) {
      return
    }
    if (!activeBlock) {
      isHydratingRef.current = true
      editor.commands.setContent('<p></p>')
      window.setTimeout(() => { isHydratingRef.current = false }, 0)
      return
    }
    if (isTableBlock(activeBlock)) {
      isHydratingRef.current = true
      editor.commands.setContent('<p></p>')
      window.setTimeout(() => { isHydratingRef.current = false }, 0)
      return
    }
    const content = normalizeHTML(pendingHTMLByBlockIDRef.current[activeBlock.blockId] || activeBlock.currentHtml || activeBlock.initialHtml)
    isHydratingRef.current = true
    editor.commands.setContent(content)
    window.setTimeout(() => { isHydratingRef.current = false }, 0)
  }, [editor, activeBlock])

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

  const pendingCount = blocks.filter((block) => {
    const state = saveStateByBlockID[block.blockId] || 'idle'
    return state === 'dirty' || state === 'saving'
  }).length
  const failedCount = blocks.filter(block => saveStateByBlockID[block.blockId] === 'error').length
  const activeTableError = tableRenderErrorByBlockID[activeBlockID]

  return (
    <Card size="small" title="文本分块编辑" loading={loading}>
      {contextHolder}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <Tag>总分段 {blocks.length}</Tag>
        <Tag color="warning">待保存 {pendingCount}</Tag>
        <Tag color="error">失败 {failedCount}</Tag>
      </div>
      <div className="mb-3">
        <Select
          value={activeBlockID || undefined}
          className="w-full"
          placeholder="请选择分块"
          options={orderedBlocks.map((block) => {
            const section = sectionByID.get(block.sectionId)
            const state = saveStateByBlockID[block.blockId] || 'idle'
            const title = block.title || section?.title || `分块 #${block.blockId}`
            return {
              value: block.blockId,
              label: `${title}（${block.sliceType || '-'}，P${block.pageStart}-${block.pageEnd}，${state}）`,
            }
          })}
          onChange={(value) => { void switchActiveBlock(Number(value)) }}
        />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <Tag color="blue">{activeSection?.title || '未分组章节'}</Tag>
        <Tag>{activeBlock?.sliceType || '-'}</Tag>
        <Tag>页码 {activeBlock?.pageStart || 0}-{activeBlock?.pageEnd || 0}</Tag>
        <Tag color={stateTagColor(saveStateByBlockID[activeBlockID] || 'idle')}>
          {saveStateByBlockID[activeBlockID] || 'idle'}
        </Tag>
      </div>
      {activeTableError
        ? (
            <Alert
              type="error"
              showIcon
              message="表格渲染失败，当前分块已阻断编辑"
              description={`分块ID=${activeBlockID}，原因：${activeTableError}`}
            />
          )
        : null}
      {isTableBlock(activeBlock)
        ? (
            <UniverTableEditor
              key={`table-${activeBlock?.blockId || 0}-${activeBlock?.lastSavedAt || ''}`}
              valueHtml={normalizeHTML(pendingHTMLByBlockIDRef.current[activeBlock?.blockId || 0] || activeBlock?.currentHtml || activeBlock?.initialHtml || '')}
              disabled={!enabled}
              onChange={(nextHtml) => {
                const blockId = activeBlockIDRef.current
                if (blockId === 0)
                  return
                if (tableRenderErrorByBlockID[blockId])
                  return
                scheduleSave(blockId, nextHtml)
              }}
              onError={(messageText) => {
                const blockId = activeBlockIDRef.current
                if (blockId === 0)
                  return
                setTableRenderErrorByBlockID(prev => ({ ...prev, [blockId]: messageText || 'Univer 表格渲染失败' }))
                setSaveStateByBlockID(prev => ({ ...prev, [blockId]: 'error' }))
                msgApi.error(`表格分块渲染失败（#${blockId}）：${messageText || 'Univer 表格渲染失败'}`)
              }}
            />
          )
        : (
            <div className="case-file-focus-editor rounded border border-gray-200 bg-white p-3">
              {editor
                ? <EditorContent editor={editor} />
                : <Typography.Text type="secondary">编辑器初始化中…</Typography.Text>}
            </div>
          )}
      <style jsx global>{`
        .case-file-focus-editor .ProseMirror {
          min-height: 560px;
          max-height: 640px;
          overflow: auto;
          outline: none;
          line-height: 1.7;
          padding-right: 6px;
        }
        .case-file-focus-editor .ProseMirror table {
          width: 100%;
          border-collapse: collapse;
          margin: 8px 0;
          table-layout: fixed;
        }
        .case-file-focus-editor .ProseMirror th,
        .case-file-focus-editor .ProseMirror td {
          border: 1px solid #d9d9d9;
          padding: 6px 8px;
          vertical-align: top;
          word-break: break-word;
          white-space: pre-wrap;
        }
        .case-file-focus-editor .ProseMirror th {
          background: #f5f7fa;
          font-weight: 600;
        }
      `}</style>
    </Card>
  )
}
