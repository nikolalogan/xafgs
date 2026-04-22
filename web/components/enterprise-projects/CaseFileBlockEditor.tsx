'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Divider, Typography, message } from 'antd'
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
  fileName: string
  enabled: boolean
}

type TextBlockEditorProps = {
  blockId: number
  valueHtml: string
  editable: boolean
  onChange: (blockId: number, currentHtml: string) => void
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

function TextBlockEditor({ blockId, valueHtml, editable, onChange }: TextBlockEditorProps) {
  const isHydratingRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: normalizeHTML(valueHtml),
    onUpdate: ({ editor }) => {
      if (isHydratingRef.current)
        return
      onChangeRef.current(blockId, editor.getHTML() || '<p></p>')
    },
  }, [blockId])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    if (!editor)
      return
    if (normalizeHTML(editor.getHTML() || '<p></p>') === normalizeHTML(valueHtml))
      return
    isHydratingRef.current = true
    editor.commands.setContent(normalizeHTML(valueHtml))
    window.setTimeout(() => { isHydratingRef.current = false }, 0)
  }, [editor, valueHtml])

  return (
    <div className="case-file-focus-editor">
      {editor
        ? <EditorContent editor={editor} />
        : <Typography.Text type="secondary">编辑器初始化中…</Typography.Text>}
    </div>
  )
}

export default function CaseFileBlockEditor({ projectId, caseFileId, fileName, enabled }: CaseFileBlockEditorProps) {
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState<FileBlockSectionDTO[]>([])
  const [blocks, setBlocks] = useState<FileBlockItemDTO[]>([])
  const [saveStateByBlockID, setSaveStateByBlockID] = useState<Record<number, SaveState>>({})
  const [tableRenderErrorByBlockID, setTableRenderErrorByBlockID] = useState<Record<number, string>>({})
  const [editing, setEditing] = useState(false)
  const baselineByBlockIDRef = useRef<Record<number, string>>({})
  const pendingHTMLByBlockIDRef = useRef<Record<number, string>>({})
  const saveTimerByBlockIDRef = useRef<Record<number, number>>({})

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

  const flushBlockIfDirty = async (blockId: number) => {
    if (blockId === 0)
      return
    const timer = saveTimerByBlockIDRef.current[blockId]
    if (timer) {
      window.clearTimeout(timer)
      delete saveTimerByBlockIDRef.current[blockId]
    }
    const latestHTML = normalizeHTML(pendingHTMLByBlockIDRef.current[blockId] || '<p></p>')
    const baseline = normalizeHTML(baselineByBlockIDRef.current[blockId] || '<p></p>')
    if (latestHTML !== baseline)
      await persistBlock(blockId, latestHTML)
  }

  const flushAllDirtyBlocks = async () => {
    for (const block of blocks)
      await flushBlockIfDirty(block.blockId)
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
      setSections(sectionRows)
      setBlocks(blockRows)
      setSaveStateByBlockID(nextStates)
      setTableRenderErrorByBlockID({})
      setEditing(false)
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
    return () => {
      Object.values(saveTimerByBlockIDRef.current).forEach((timer) => {
        window.clearTimeout(timer)
      })
      saveTimerByBlockIDRef.current = {}
    }
  }, [])

  const renderBlockMeta = (block: FileBlockItemDTO) => {
    const section = sectionByID.get(block.sectionId)
    const state = saveStateByBlockID[block.blockId] || 'idle'
    const parts = [
      section?.title || block.sectionId,
      block.sliceType || '',
      `页码 ${block.pageStart}-${block.pageEnd}`,
      state,
    ].filter(Boolean)
    return parts.join(' · ')
  }

  return (
    <Card
      size="small"
      title={(
        <div className="flex items-center gap-2">
          <span>{fileName}</span>
          <Button
            size="small"
            type={editing ? 'default' : 'primary'}
            onClick={() => {
              void (async () => {
                if (editing)
                  await flushAllDirtyBlocks()
                setEditing(prev => !prev)
              })()
            }}
          >
            {editing ? '完成编辑' : '编辑'}
          </Button>
        </div>
      )}
      loading={loading}
    >
      {contextHolder}
      <div className="case-file-block-stream rounded border border-gray-200 bg-white p-3">
        {orderedBlocks.map((block, index) => {
          const blockError = tableRenderErrorByBlockID[block.blockId]
          return (
            <div key={block.blockId} className="space-y-3">
              {index > 0 && (
                <Divider plain titlePlacement="right" className="text-xs text-gray-400">
                  {renderBlockMeta(block)}
                </Divider>
              )}
              {index === 0 && (
                <div className="text-right text-xs text-gray-400">{renderBlockMeta(block)}</div>
              )}
              {blockError
                ? (
                    <Alert
                      type="error"
                      showIcon
                      message="表格渲染失败，当前分块已阻断编辑"
                      description={`分块ID=${block.blockId}，原因：${blockError}`}
                    />
                  )
                : null}
              {isTableBlock(block)
                ? (
                    <UniverTableEditor
                      key={`table-${block.blockId}-${block.lastSavedAt || ''}-${editing ? 'edit' : 'read'}`}
                      valueHtml={normalizeHTML(pendingHTMLByBlockIDRef.current[block.blockId] || block.currentHtml || block.initialHtml || '')}
                      disabled={!enabled || !editing}
                      onChange={(nextHtml) => {
                        if (tableRenderErrorByBlockID[block.blockId])
                          return
                        scheduleSave(block.blockId, nextHtml)
                      }}
                      onError={(messageText) => {
                        setTableRenderErrorByBlockID(prev => ({ ...prev, [block.blockId]: messageText || 'Univer 表格渲染失败' }))
                        setSaveStateByBlockID(prev => ({ ...prev, [block.blockId]: 'error' }))
                        msgApi.error(`表格分块渲染失败（#${block.blockId}）：${messageText || 'Univer 表格渲染失败'}`)
                      }}
                    />
                  )
                : (
                    <TextBlockEditor
                      blockId={block.blockId}
                      valueHtml={normalizeHTML(pendingHTMLByBlockIDRef.current[block.blockId] || block.currentHtml || block.initialHtml)}
                      editable={enabled && editing}
                      onChange={scheduleSave}
                    />
                  )}
            </div>
          )
        })}
      </div>
      <style jsx global>{`
        .case-file-focus-editor .ProseMirror {
          min-height: 120px;
          outline: none;
          line-height: 1.7;
        }
        .case-file-block-stream {
          max-height: 680px;
          overflow: auto;
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
