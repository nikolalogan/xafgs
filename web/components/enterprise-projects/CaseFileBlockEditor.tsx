'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Collapse, Space, Tag, Typography, message } from 'antd'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'

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
const PREVIEW_ITEM_HEIGHT = 92

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const stripHTML = (value: string) => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export default function CaseFileBlockEditor({ projectId, caseFileId, enabled }: CaseFileBlockEditorProps) {
  const [msgApi, contextHolder] = message.useMessage()
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState<FileBlockSectionDTO[]>([])
  const [blocks, setBlocks] = useState<FileBlockItemDTO[]>([])
  const [activeSectionKeys, setActiveSectionKeys] = useState<string[]>([])
  const [scrollTopBySection, setScrollTopBySection] = useState<Record<string, number>>({})
  const [activeBlockID, setActiveBlockID] = useState(0)
  const [draftByBlockID, setDraftByBlockID] = useState<Record<number, string>>({})
  const [saveStateByBlockID, setSaveStateByBlockID] = useState<Record<number, SaveState>>({})
  const baselineByBlockIDRef = useRef<Record<number, string>>({})
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

  const loadBlocks = async () => {
    if (!enabled || !projectId || !caseFileId)
      return
    setLoading(true)
    try {
      const data = await request<FileBlocksDTO>(`/api/enterprise-projects/${projectId}/files/${caseFileId}/blocks`, { method: 'GET' })
      setSections(Array.isArray(data?.sections) ? data.sections : [])
      const sectionRows = Array.isArray(data?.sections) ? data.sections : []
      if (sectionRows.length > 0)
        setActiveSectionKeys([sectionRows[0].sectionId])
      const blockRows = Array.isArray(data?.blocks) ? data.blocks : []
      setBlocks(blockRows)
      const nextDraft: Record<number, string> = {}
      const nextBaseline: Record<number, string> = {}
      const nextStates: Record<number, SaveState> = {}
      for (const block of blockRows) {
        nextDraft[block.blockId] = String(block.currentHtml || block.initialHtml || '<p></p>')
        nextBaseline[block.blockId] = String(block.currentHtml || block.initialHtml || '<p></p>')
        nextStates[block.blockId] = 'idle'
      }
      setDraftByBlockID(nextDraft)
      baselineByBlockIDRef.current = nextBaseline
      setSaveStateByBlockID(nextStates)
      if (!activeBlockID && blockRows.length > 0)
        setActiveBlockID(blockRows[0].blockId)
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
      const normalized = String(payload?.currentHtml || currentHtml || '<p></p>')
      baselineByBlockIDRef.current[blockId] = normalized
      setDraftByBlockID(prev => ({ ...prev, [blockId]: normalized }))
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
    const normalized = String(currentHtml || '<p></p>')
    const baseline = String(baselineByBlockIDRef.current[blockId] || '<p></p>')
    setDraftByBlockID(prev => ({ ...prev, [blockId]: normalized }))
    if (normalized.trim() === baseline.trim()) {
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

  const blockMap = useMemo(() => {
    const map = new Map<number, FileBlockItemDTO>()
    blocks.forEach(block => map.set(block.blockId, block))
    return map
  }, [blocks])

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
  const stateLabel = (state: SaveState) => {
    if (state === 'saving')
      return '保存中'
    if (state === 'saved')
      return '已保存'
    if (state === 'error')
      return '保存失败'
    if (state === 'dirty')
      return '待保存'
    return '未变更'
  }
  const activeSectionSet = useMemo(() => new Set(activeSectionKeys), [activeSectionKeys])

  return (
    <Card size="small" title="文本分块编辑（按解析结果）" loading={loading}>
      {contextHolder}
      {sections.length === 0 && <div className="text-xs text-gray-500">当前文件暂无可编辑分块。</div>}
      <div className="mb-3 flex flex-wrap gap-2">
        {sections.map(section => (
          <Tag key={section.sectionId}>{section.title}（{section.blockIds.length}）</Tag>
        ))}
      </div>
      <Collapse
        destroyOnHidden
        activeKey={activeSectionKeys}
        onChange={(keys) => {
          const normalized = Array.isArray(keys) ? keys.map(item => String(item)) : [String(keys)]
          setActiveSectionKeys(normalized)
          if (activeBlockID > 0) {
            const activeBlock = blockMap.get(activeBlockID)
            if (activeBlock && !normalized.includes(activeBlock.sectionId))
              setActiveBlockID(0)
          }
        }}
        items={sections.map(section => ({
          key: section.sectionId,
          label: `${section.title}（${section.blockIds.length}）`,
          children: (
            <div className="space-y-3">
              {(() => {
                const editingBlock = activeBlockID > 0 ? blockMap.get(activeBlockID) : null
                const editingInCurrentSection = editingBlock?.sectionId === section.sectionId
                return editingInCurrentSection && editingBlock
                  ? (
                      <Card
                        size="small"
                        title={(
                          <Space>
                            <span>{editingBlock.title || `${editingBlock.sliceType} #${editingBlock.blockId}`}</span>
                            <Tag>{editingBlock.sliceType}</Tag>
                            <Tag>p{editingBlock.pageStart}-{editingBlock.pageEnd}</Tag>
                            <Tag color={stateTagColor(saveStateByBlockID[editingBlock.blockId] || 'idle')}>
                              {stateLabel(saveStateByBlockID[editingBlock.blockId] || 'idle')}
                            </Tag>
                          </Space>
                        )}
                        extra={<Button size="small" onClick={() => setActiveBlockID(0)}>收起编辑</Button>}
                      >
                        {activeSectionSet.has(section.sectionId) && (
                          <SimpleEditor
                            initialContent={draftByBlockID[editingBlock.blockId] || editingBlock.currentHtml || editingBlock.initialHtml}
                            onUpdateHTML={html => scheduleSave(editingBlock.blockId, html)}
                          />
                        )}
                      </Card>
                    )
                  : null
              })()}
              {(() => {
                const previewIds = section.blockIds.filter(blockId => blockId !== activeBlockID)
                const viewportHeight = Math.min(420, Math.max(120, previewIds.length * PREVIEW_ITEM_HEIGHT))
                const scrollTop = scrollTopBySection[section.sectionId] || 0
                const total = previewIds.length
                const visibleCount = Math.ceil(viewportHeight / PREVIEW_ITEM_HEIGHT) + 4
                const startIndex = Math.max(0, Math.floor(scrollTop / PREVIEW_ITEM_HEIGHT) - 2)
                const endIndex = Math.min(total, startIndex + visibleCount)
                const topSpacer = startIndex * PREVIEW_ITEM_HEIGHT
                const bottomSpacer = Math.max(0, (total - endIndex) * PREVIEW_ITEM_HEIGHT)
                const visibleIds = previewIds.slice(startIndex, endIndex)
                return (
                  <div
                    className="overflow-auto rounded border border-gray-100 bg-gray-50 p-2"
                    style={{ height: viewportHeight }}
                    onScroll={event => setScrollTopBySection(prev => ({
                      ...prev,
                      [section.sectionId]: event.currentTarget.scrollTop,
                    }))}
                  >
                    {topSpacer > 0 && <div style={{ height: topSpacer }} />}
                    {visibleIds.map((blockId) => {
                      const block = blockMap.get(blockId)
                      if (!block)
                        return null
                      const state = saveStateByBlockID[blockId] || 'idle'
                      const preview = stripHTML(draftByBlockID[blockId] || block.currentHtml || block.initialHtml)
                      return (
                        <div key={blockId} className="mb-2 rounded border border-gray-200 bg-white p-2">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <Space size={6}>
                              <span className="text-xs font-medium">{block.title || `${block.sliceType} #${blockId}`}</span>
                              <Tag>{block.sliceType}</Tag>
                              <Tag>p{block.pageStart}-{block.pageEnd}</Tag>
                              <Tag color={stateTagColor(state)}>{stateLabel(state)}</Tag>
                            </Space>
                            <Button size="small" type="primary" onClick={() => setActiveBlockID(blockId)}>编辑当前块</Button>
                          </div>
                          <Typography.Paragraph className="mb-0 text-xs text-gray-600" ellipsis={{ rows: 2 }}>
                            {preview || '-'}
                          </Typography.Paragraph>
                        </div>
                      )
                    })}
                    {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
                  </div>
                )
              })()}
            </div>
          ),
        }))}
      />
    </Card>
  )
}
