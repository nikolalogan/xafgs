'use client'

import { useEffect, useRef } from 'react'
import { LocaleType, LogLevel, Univer } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import zhCN from '@univerjs/preset-sheets-core/lib/locales/zh-CN'

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
  const univerRef = useRef<Univer | null>(null)
  const univerApiRef = useRef<any>(null)
  const workbookRef = useRef<any>(null)
  const disposableRef = useRef<{ dispose?: () => void } | null>(null)
  const isMountedRef = useRef(false)
  const isApplyingExternalRef = useRef(false)
  const lastEmittedRef = useRef('')
  const lastSyncedExternalHtmlRef = useRef('')
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)

  onChangeRef.current = onChange
  onErrorRef.current = onError

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const safeDispose = () => {
      const disposable = disposableRef.current
      const univerAPI = univerApiRef.current
      const univer = univerRef.current
      disposableRef.current = null
      univerApiRef.current = null
      workbookRef.current = null
      univerRef.current = null
      queueMicrotask(() => {
        try {
          disposable?.dispose?.()
        } catch {}
        try {
          univerAPI?.dispose?.()
        } catch {}
        try {
          univer?.dispose?.()
        } catch {}
      })
    }

    safeDispose()

    try {
      const univer = new Univer({
        logLevel: LogLevel.WARN,
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.ZH_CN]: zhCN,
        },
      })
      const preset = UniverSheetsCorePreset({ container })
      for (const pluginEntry of preset.plugins) {
        const [plugin, options] = Array.isArray(pluginEntry) ? pluginEntry : [pluginEntry, undefined]
        univer.registerPlugin(plugin as any, options as any)
      }
      const univerAPI = FUniver.newAPI(univer)
      const initialHtml = valueHtml
      const grid = parseHtmlToGrid(initialHtml)
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
        if (!isMountedRef.current || isApplyingExternalRef.current) {
          return
        }
        const snapshot = workbook.getSnapshot()
        const nextHtml = serializeGridToHtml(snapshotToGrid(snapshot))
        if (nextHtml === lastEmittedRef.current || nextHtml === lastSyncedExternalHtmlRef.current) {
          return
        }
        lastEmittedRef.current = nextHtml
        onChangeRef.current(nextHtml)
      })

      univerRef.current = univer
      univerApiRef.current = univerAPI
      workbookRef.current = workbook
      disposableRef.current = disposable
      lastSyncedExternalHtmlRef.current = initialHtml

      return () => {
        safeDispose()
      }
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : '初始化 Univer 失败')
      return undefined
    }
  }, [editorSessionKey, valueHtml])

  useEffect(() => {
    const workbook = workbookRef.current
    if (!workbook) {
      return
    }
    if (lastSyncedExternalHtmlRef.current === valueHtml) {
      return
    }
    const currentHtml = serializeGridToHtml(snapshotToGrid(workbook.getSnapshot()))
    if (currentHtml === valueHtml) {
      lastSyncedExternalHtmlRef.current = valueHtml
      return
    }
    isApplyingExternalRef.current = true
    try {
      const grid = parseHtmlToGrid(valueHtml)
      const nextSnapshot = workbook.getSnapshot()
      const sheet = Object.values(nextSnapshot?.sheets || {})?.[0] as any
      if (sheet) {
        sheet.cellData = gridToCellData(grid)
        sheet.rowCount = Math.max(20, grid.length)
        sheet.columnCount = Math.max(10, grid[0]?.length || 1)
      }
      workbook.setSnapshot(nextSnapshot)
      lastSyncedExternalHtmlRef.current = valueHtml
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : '同步外部内容失败')
    } finally {
      queueMicrotask(() => {
        isApplyingExternalRef.current = false
      })
    }
  }, [valueHtml])

  useEffect(() => {
    const workbook = workbookRef.current
    if (!workbook || typeof workbook?.setEditable !== 'function') {
      return
    }
    workbook.setEditable(!disabled ? true : false)
  }, [disabled])

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div ref={containerRef} style={{ height: 560 }} />
    </div>
  )
}
