'use client'

import { useEffect, useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Tabs, Typography } from 'antd'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

type FileParseSlicePreviewDTO = {
  sliceType: string
  title: string
  pageStart: number
  pageEnd: number
  sourceRef: string
  cleanText: string
}

type FileParseTableCellPreviewDTO = {
  text: string
}

type FileParseTableRowPreviewDTO = {
  rowIndex: number
  cells: FileParseTableCellPreviewDTO[]
}

type FileParseTablePreviewDTO = {
  title: string
  pageStart: number
  pageEnd: number
  headerRowCount: number
  sourceRef: string
  previewRows: FileParseTableRowPreviewDTO[]
}

type FileParseFigureRegionPreviewDTO = {
  rowIndex: number
  region: string
  text: string
}

type FileParseFigurePreviewDTO = {
  title: string
  figureType: string
  pageNo: number
  sourceRef: string
  cleanText: string
  regions: FileParseFigureRegionPreviewDTO[]
}

type ParsedFileResult = {
  version: {
    originName: string
    fileId: number
    versionNo: number
  }
  markdown?: string
  text?: string
  document?: Record<string, unknown> | null
  slices: FileParseSlicePreviewDTO[]
  tables: FileParseTablePreviewDTO[]
  figures: FileParseFigurePreviewDTO[]
}

type ParsedDocumentViewerProps = {
  result: ParsedFileResult
}

const escapeHTML = (value: string) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;')

const formatText = (value: string) => escapeHTML(String(value || '').trim()).replaceAll('\n', '<br>')

const hasHTMLTag = (value: string) => /<[^>]+>/.test(String(value || ''))

const formatSliceContent = (value: string) => {
  const normalized = String(value || '').trim()
  if (!normalized)
    return ''
  if (!hasHTMLTag(normalized))
    return formatText(normalized)
  return DOMPurify.sanitize(normalized).replaceAll('\r\n', '\n').replaceAll('\n', '<br>')
}

const markdownToHTML = (value: string) => {
  const markdown = String(value || '').trim()
  if (!markdown)
    return ''
  return DOMPurify.sanitize(String(marked.parse(markdown)))
}

const formatPlainTextBlock = (value: string) => {
  const text = String(value || '').trim()
  if (!text)
    return <Typography.Text type="secondary">暂无纯文本内容</Typography.Text>
  return <pre className="parsed-document-plain-text m-0 whitespace-pre-wrap text-sm leading-7">{text}</pre>
}

const formatJSONBlock = (value: unknown) => {
  if (!value)
    return <Typography.Text type="secondary">暂无原始 Docling 结构</Typography.Text>
  return <pre className="parsed-document-json m-0 whitespace-pre-wrap text-xs leading-6">{JSON.stringify(value, null, 2)}</pre>
}

const summarizeText = (value: string, maxLen: number) => {
  const normalized = String(value || '').trim()
  if (!normalized)
    return ''
  const runes = Array.from(normalized)
  if (runes.length <= maxLen)
    return normalized
  return `${runes.slice(0, maxLen).join('')}…`
}

const sliceSort = (left: FileParseSlicePreviewDTO, right: FileParseSlicePreviewDTO) => {
  if ((left.pageStart || 0) !== (right.pageStart || 0))
    return (left.pageStart || 0) - (right.pageStart || 0)
  if ((left.pageEnd || 0) !== (right.pageEnd || 0))
    return (left.pageEnd || 0) - (right.pageEnd || 0)
  if ((left.sourceRef || '') !== (right.sourceRef || ''))
    return (left.sourceRef || '').localeCompare(right.sourceRef || '', 'zh-CN')
  return (left.sliceType || '').localeCompare(right.sliceType || '', 'zh-CN')
}

const tableSort = (left: FileParseTablePreviewDTO, right: FileParseTablePreviewDTO) => {
  if ((left.pageStart || 0) !== (right.pageStart || 0))
    return (left.pageStart || 0) - (right.pageStart || 0)
  return (left.sourceRef || '').localeCompare(right.sourceRef || '', 'zh-CN')
}

const figureSort = (left: FileParseFigurePreviewDTO, right: FileParseFigurePreviewDTO) => {
  if ((left.pageNo || 0) !== (right.pageNo || 0))
    return (left.pageNo || 0) - (right.pageNo || 0)
  return (left.sourceRef || '').localeCompare(right.sourceRef || '', 'zh-CN')
}

const renderSliceHTML = (slice: FileParseSlicePreviewDTO) => {
  const content = String(slice.cleanText || '').trim()
  const title = String(slice.title || '').trim()
  if (!content && !title)
    return ''
  const isSection = String(slice.sliceType || '').toLowerCase() === 'section'
  if (isSection) {
    const heading = title || summarizeText(content, 32) || '章节'
    if (!content)
      return `<h2>${escapeHTML(heading)}</h2>`
    return `<h2>${escapeHTML(heading)}</h2><div>${formatSliceContent(content)}</div>`
  }
  if (!content)
    return ''
  return `<div>${formatSliceContent(content)}</div>`
}

const renderTableHTML = (table: FileParseTablePreviewDTO) => {
  const title = String(table.title || '').trim() || `表格（第${table.pageStart || '-'}页）`
  const rows = Array.isArray(table.previewRows) ? [...table.previewRows].sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0)) : []
  if (rows.length === 0)
    return `<h3>${escapeHTML(title)}</h3><p class="meta">来源：${escapeHTML(String(table.sourceRef || '-'))}</p><p>（无可用表格行）</p>`
  const headerRowCount = Math.max(0, Number(table.headerRowCount || 0))
  const tableRowsHTML = rows.map((row) => {
    const rowCells = Array.isArray(row.cells) ? row.cells : []
    const tag = (row.rowIndex || 0) < headerRowCount ? 'th' : 'td'
    const cellsHTML = rowCells.map(cell => `<${tag}>${formatText(String(cell.text || '').trim())}</${tag}>`).join('')
    return `<tr>${cellsHTML}</tr>`
  }).join('')
  return `<h3>${escapeHTML(title)}</h3><p class="meta">来源：${escapeHTML(String(table.sourceRef || '-'))}</p><table><tbody>${tableRowsHTML}</tbody></table>`
}

const renderFigureHTML = (figure: FileParseFigurePreviewDTO) => {
  const title = String(figure.title || '').trim() || `图表候选（第${figure.pageNo || '-'}页）`
  const summary = String(figure.cleanText || '').trim()
  const regions = Array.isArray(figure.regions) ? [...figure.regions].sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0)) : []
  const regionHTML = regions.length > 0
    ? `<ul>${regions.map(region => `<li>${escapeHTML(String(region.region || '-'))}：${formatText(String(region.text || '').trim())}</li>`).join('')}</ul>`
    : '<p>（无节点明细）</p>'
  return `<h3>${escapeHTML(title)}</h3><p class="meta">类型：${escapeHTML(String(figure.figureType || '-'))}；来源：${escapeHTML(String(figure.sourceRef || '-'))}</p>${summary ? `<p>${formatText(summary)}</p>` : ''}${regionHTML}`
}

const buildDocumentHTML = (result: ParsedFileResult) => {
  const slices = (Array.isArray(result.slices) ? [...result.slices] : []).sort(sliceSort)
  const tables = (Array.isArray(result.tables) ? [...result.tables] : []).sort(tableSort)
  const figures = (Array.isArray(result.figures) ? [...result.figures] : []).sort(figureSort)

  const sliceHTML = slices.map(renderSliceHTML).filter(Boolean).join('')
  const tableHTML = tables.length > 0
    ? `<h2>表格</h2>${tables.map(renderTableHTML).join('')}`
    : ''
  const figureHTML = figures.length > 0
    ? `<h2>图表候选</h2>${figures.map(renderFigureHTML).join('')}`
    : ''

  return `
    <h1>${escapeHTML(String(result.version?.originName || '解析文档'))}</h1>
    <p class="meta">fileId=${escapeHTML(String(result.version?.fileId || '-'))} · version=${escapeHTML(String(result.version?.versionNo || '-'))}</p>
    ${sliceHTML || '<p>（未提取到正文）</p>'}
    ${tableHTML}
    ${figureHTML}
  `
}

export default function ParsedDocumentViewer({ result }: ParsedDocumentViewerProps) {
  const contentHTML = useMemo(() => buildDocumentHTML(result), [result])
  const markdownHTML = useMemo(() => markdownToHTML(result.markdown || ''), [result.markdown])
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: contentHTML,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
  }, [contentHTML])

  useEffect(() => {
    if (!editor)
      return
    editor.commands.setContent(contentHTML || '<p>（暂无内容）</p>')
  }, [editor, contentHTML])

  const structurePreview = (
    <>
      {editor
        ? <EditorContent editor={editor} />
        : <Typography.Text type="secondary">整文预览加载中…</Typography.Text>}
    </>
  )

  const defaultActiveKey = markdownHTML ? 'markdown' : 'structure'

  return (
    <div className="parsed-document-viewer rounded border border-gray-200 bg-white p-3">
      <Tabs
        defaultActiveKey={defaultActiveKey}
        items={[
          ...(markdownHTML
            ? [{
                key: 'markdown',
                label: 'Markdown',
                children: <div className="parsed-document-markdown" dangerouslySetInnerHTML={{ __html: markdownHTML }} />,
              }]
            : []),
          {
            key: 'text',
            label: '纯文本',
            children: formatPlainTextBlock(result.text || ''),
          },
          {
            key: 'structure',
            label: '结构化预览',
            children: structurePreview,
          },
          {
            key: 'document',
            label: '原始Docling结构',
            children: formatJSONBlock(result.document),
          },
        ]}
      />
      <style jsx global>{`
        .parsed-document-viewer .ProseMirror,
        .parsed-document-viewer .parsed-document-markdown,
        .parsed-document-viewer .parsed-document-plain-text,
        .parsed-document-viewer .parsed-document-json {
          min-height: 420px;
          max-height: 640px;
          overflow: auto;
          outline: none;
          line-height: 1.7;
          padding-right: 6px;
        }
        .parsed-document-viewer .ProseMirror .meta {
          color: #6b7280;
          font-size: 12px;
        }
        .parsed-document-viewer .ProseMirror table,
        .parsed-document-viewer .parsed-document-markdown table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #d1d5db;
          margin: 8px 0 16px;
          table-layout: fixed;
        }
        .parsed-document-viewer .ProseMirror tr,
        .parsed-document-viewer .parsed-document-markdown tr {
          border: 1px solid #d1d5db;
        }
        .parsed-document-viewer .ProseMirror th,
        .parsed-document-viewer .ProseMirror td,
        .parsed-document-viewer .parsed-document-markdown th,
        .parsed-document-viewer .parsed-document-markdown td {
          border: 1px solid #d1d5db;
          padding: 6px 8px;
          vertical-align: top;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .parsed-document-viewer .ProseMirror th,
        .parsed-document-viewer .parsed-document-markdown th {
          background: #f3f4f6;
          font-weight: 600;
        }
        .parsed-document-viewer .parsed-document-markdown h1,
        .parsed-document-viewer .parsed-document-markdown h2,
        .parsed-document-viewer .parsed-document-markdown h3 {
          margin: 14px 0 8px;
          font-weight: 600;
        }
        .parsed-document-viewer .parsed-document-markdown p {
          margin: 8px 0;
        }
        .parsed-document-viewer .parsed-document-markdown ul,
        .parsed-document-viewer .parsed-document-markdown ol {
          padding-left: 24px;
        }
        .parsed-document-viewer .parsed-document-markdown code {
          background: #f3f4f6;
          border-radius: 4px;
          padding: 1px 4px;
        }
        .parsed-document-viewer .parsed-document-markdown pre {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 10px;
          overflow: auto;
        }
        .parsed-document-viewer .ProseMirror br {
          display: block;
          margin: 4px 0;
          content: '';
        }
      `}</style>
    </div>
  )
}
