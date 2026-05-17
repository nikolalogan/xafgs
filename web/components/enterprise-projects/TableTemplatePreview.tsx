'use client'

import { Alert, Table } from 'antd'
import { useMemo } from 'react'

type TableTemplatePreviewProps = {
  valueHtml: string
  className?: string
}

type ParseResult = {
  columns: Array<{ title: string; dataIndex: string; key: string }>
  dataSource: Array<Record<string, string>>
}

const normalizeText = (value: string) => String(value || '').replaceAll('\u00A0', ' ').replace(/\s+/g, ' ').trim()

const parseSpan = (value: string | null) => {
  const parsed = Number.parseInt(String(value || '1').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0)
    return 1
  return parsed
}

const parseTableHtml = (valueHtml: string): ParseResult => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(valueHtml || ''), 'text/html')
  const table = doc.querySelector('table')
  if (!table)
    throw new Error('未找到可解析的表格')

  const rowNodes = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')) as HTMLTableRowElement[]
  if (!rowNodes.length)
    throw new Error('表格数据为空')

  const grid: string[][] = []
  const occupied = new Set<string>()
  let maxCol = 0

  for (let rowIndex = 0; rowIndex < rowNodes.length; rowIndex += 1) {
    const rowNode = rowNodes[rowIndex]
    if (!grid[rowIndex])
      grid[rowIndex] = []
    const cellNodes = Array.from(rowNode.children).filter((node) => {
      const tag = (node as HTMLElement).tagName.toLowerCase()
      return tag === 'td' || tag === 'th'
    }) as HTMLTableCellElement[]
    let colIndex = 0
    for (const cellNode of cellNodes) {
      while (occupied.has(`${rowIndex}:${colIndex}`))
        colIndex += 1
      const rowSpan = parseSpan(cellNode.getAttribute('rowspan'))
      const colSpan = parseSpan(cellNode.getAttribute('colspan'))
      const cellText = normalizeText(cellNode.textContent || '')
      grid[rowIndex][colIndex] = cellText
      maxCol = Math.max(maxCol, colIndex + colSpan)
      for (let ro = 0; ro < rowSpan; ro += 1) {
        for (let co = 0; co < colSpan; co += 1) {
          const rr = rowIndex + ro
          const cc = colIndex + co
          if (!grid[rr])
            grid[rr] = []
          if (ro !== 0 || co !== 0)
            occupied.add(`${rr}:${cc}`)
        }
      }
      colIndex += colSpan
    }
  }

  const colCount = Math.max(1, maxCol)
  const columns = Array.from({ length: colCount }, (_, colIndex) => ({
    title: `列${colIndex + 1}`,
    dataIndex: `col_${colIndex}`,
    key: `col_${colIndex}`,
  }))
  const dataSource = grid.map((row, rowIndex) => {
    const next: Record<string, string> = { key: `row_${rowIndex}` }
    for (let colIndex = 0; colIndex < colCount; colIndex += 1)
      next[`col_${colIndex}`] = row?.[colIndex] || ''
    return next
  })
  return { columns, dataSource }
}

export default function TableTemplatePreview({ valueHtml, className }: TableTemplatePreviewProps) {
  const parsed = useMemo(() => {
    try {
      return { data: parseTableHtml(valueHtml), error: '' }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : '表格解析失败' }
    }
  }, [valueHtml])

  if (!parsed.data) {
    return (
      <Alert
        type="warning"
        showIcon
        message="表格预览失败"
        description={parsed.error || '请检查模板内容是否包含有效 table 结构'}
      />
    )
  }

  return (
    <div className={className}>
      <Table
        size="small"
        pagination={false}
        columns={parsed.data.columns}
        dataSource={parsed.data.dataSource}
      />
    </div>
  )
}
