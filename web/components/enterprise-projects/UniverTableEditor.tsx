'use client'

import { useEffect, useRef } from 'react'
import { LogLevel, Univer } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'

type UniverTableEditorProps = {
  editorSessionKey: string
  valueHtml: string
  disabled?: boolean
  onChange: (nextHtml: string) => void
  onError?: (message: string) => void
}

type Grid = string[][]

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const parseHtmlToGrid = (valueHtml: string): Grid => {
  try {
    const doc = new DOMParser().parseFromString(String(valueHtml || ''), 'text/html')
    const table = doc.querySelector('table')
    if (!table) {
      return [['']]
    }
    const rows = Array.from(table.querySelectorAll('tr'))
    if (!rows.length) {
      return [['']]
    }
    const grid: string[][] = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll(':scope > td, :scope > th'))
      return cells.map(cell => String(cell.textContent || '').replaceAll('\u00A0', ' ').trim())
    })
    const maxCols = Math.max(1, ...grid.map(row => row.length))
    return grid.map(row => Array.from({ length: maxCols }, (_, idx) => row[idx] || ''))
  } catch {
    return [['']]
  }
}

const serializeGridToHtml = (grid: Grid) => {
  const safeGrid = grid.length ? grid : [['']]
  const htmlRows = safeGrid.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell || '')}</td>`).join('')}</tr>`).join('')
  return `<div class="table-wrapper"><table><tbody>${htmlRows}</tbody></table></div>`
}

const snapshotToGrid = (snapshot: any): Grid => {
  const sheet = Object.values(snapshot?.sheets || {})?.[0] as any
  const cellData = sheet?.cellData || {}
  const rowIndexes = Object.keys(cellData).map(Number).filter(Number.isFinite)
  let maxRow = 0
  let maxCol = 0
  for (const rowIdx of rowIndexes) {
    const rowData = cellData[rowIdx] || {}
    const colIndexes = Object.keys(rowData).map(Number).filter(Number.isFinite)
    if (colIndexes.length) {
      maxCol = Math.max(maxCol, ...colIndexes)
      maxRow = Math.max(maxRow, rowIdx)
    }
  }
  const rows = maxRow + 1
  const cols = maxCol + 1
  const grid: Grid = Array.from({ length: Math.max(1, rows) }, () => Array.from({ length: Math.max(1, cols) }, () => ''))
  for (const rowIdx of rowIndexes) {
    const rowData = cellData[rowIdx] || {}
    for (const colKey of Object.keys(rowData)) {
      const colIdx = Number(colKey)
      if (!Number.isFinite(colIdx)) {
        continue
      }
      const cell = rowData[colIdx] || {}
      if (typeof cell.f === 'string' && cell.f.trim()) {
        grid[rowIdx][colIdx] = `=${cell.f}`
      } else if (cell.v === null || cell.v === undefined) {
        grid[rowIdx][colIdx] = ''
      } else {
        grid[rowIdx][colIdx] = String(cell.v)
      }
    }
  }
  return grid
}

const gridToCellData = (grid: Grid) => {
  const cellData: Record<number, Record<number, { v?: string | number, f?: string }>> = {}
  for (let r = 0; r < grid.length; r += 1) {
    cellData[r] = {}
    for (let c = 0; c < grid[r].length; c += 1) {
      const raw = String(grid[r][c] || '')
      if (!raw) {
        continue
      }
      if (raw.startsWith('=')) {
        cellData[r][c] = { f: raw.slice(1) }
      } else {
        cellData[r][c] = { v: raw }
      }
    }
  }
  return cellData
}

export default function UniverTableEditor({
  editorSessionKey,
  valueHtml,
  disabled = false,
  onChange,
  onError,
}: UniverTableEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastEmittedRef = useRef('')
  const onChangeRef = useRef(onChange)

  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    try {
      const grid = parseHtmlToGrid(valueHtml)
      const univer = new Univer({ logLevel: LogLevel.WARN })
      const preset = UniverSheetsCorePreset({ container: containerRef.current })
      for (const pluginEntry of preset.plugins) {
        const [plugin, options] = Array.isArray(pluginEntry) ? pluginEntry : [pluginEntry, undefined]
        univer.registerPlugin(plugin as any, options as any)
      }
      const univerAPI = FUniver.newAPI(univer)

      const workbook = univerAPI.createWorkbook({
        id: `template-table-${editorSessionKey}`,
        name: 'Sheet1',
        sheetOrder: ['sheet-1'],
        sheets: {
          'sheet-1': {
            id: 'sheet-1',
            name: 'Sheet1',
            cellData: gridToCellData(grid),
            rowCount: Math.max(20, grid.length),
            columnCount: Math.max(10, grid[0]?.length || 1),
          },
        },
      }) as any

      if (disabled && typeof workbook?.setEditable === 'function') {
        workbook.setEditable(false)
      }

      const disposable = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => {
        const snapshot = workbook.getSnapshot()
        const nextHtml = serializeGridToHtml(snapshotToGrid(snapshot))
        if (nextHtml === lastEmittedRef.current || nextHtml === valueHtml) {
          return
        }
        lastEmittedRef.current = nextHtml
        onChangeRef.current(nextHtml)
      })

      return () => {
        disposable?.dispose?.()
        univerAPI.dispose()
        univer.dispose()
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '初始化 Univer 失败')
      return undefined
    }
  }, [disabled, editorSessionKey, onError, valueHtml])

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div ref={containerRef} style={{ height: 560 }} />
    </div>
  )
}
