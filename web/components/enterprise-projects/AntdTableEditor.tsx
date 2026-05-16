'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

export type SelectionRange = {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

type AntdTableEditorProps = {
  editorSessionKey: string
  valueHtml: string
  disabled?: boolean
  onChange: (nextHtml: string) => void
  onError?: (message: string) => void
  activeCell?: { row: number; col: number } | null
  onSelectionChange?: (
    row: number,
    col: number,
    meta?: { ranges: SelectionRange[]; source: string; fromKeyboard?: boolean },
  ) => void
  onHoverCellChange?: (row: number, col: number | null) => void
  onInteractionDebug?: (phase: 'selection-event' | 'selection-fallback' | 'hover' | 'focus', payload: Record<string, unknown>) => void
  exportFileNamePrefix?: string
  hideExportButton?: boolean
  cellConfidenceByCoord?: Record<string, number>
  lowConfidenceThreshold?: number
}

type CellModel = {
  raw: string
}

type GridState = {
  cells: CellModel[][]
  rows: number
  cols: number
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const parseSpan = (value: string | null) => {
  const parsed = Number.parseInt(String(value || '1').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1
  }
  return parsed
}

const buildDefaultGrid = (): GridState => ({ cells: [[{ raw: '' }]], rows: 1, cols: 1 })

const normalizeCellText = (value: string) => String(value || '').replaceAll('\u00A0', ' ').replace(/\s+/g, ' ').trim()

const parseHtmlToGrid = (valueHtml: string): GridState => {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(String(valueHtml || ''), 'text/html')
    const table = doc.querySelector('table')
    if (!table) {
      return buildDefaultGrid()
    }
    const rowNodes = Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')) as HTMLTableRowElement[]
    if (!rowNodes.length) {
      return buildDefaultGrid()
    }
    const grid: string[][] = []
    const occupied = new Set<string>()
    let maxCol = 1
    for (let rowIndex = 0; rowIndex < rowNodes.length; rowIndex++) {
      const rowNode = rowNodes[rowIndex]
      if (!grid[rowIndex]) {
        grid[rowIndex] = []
      }
      const cells = Array.from(rowNode.children).filter((node) => {
        const tag = (node as HTMLElement).tagName.toLowerCase()
        return tag === 'td' || tag === 'th'
      }) as HTMLTableCellElement[]
      let colIndex = 0
      for (const cell of cells) {
        while (occupied.has(`${rowIndex}:${colIndex}`)) {
          colIndex += 1
        }
        const rowSpan = parseSpan(cell.getAttribute('rowspan'))
        const colSpan = parseSpan(cell.getAttribute('colspan'))
        grid[rowIndex][colIndex] = normalizeCellText(cell.textContent || '')
        maxCol = Math.max(maxCol, colIndex + colSpan)
        for (let ro = 0; ro < rowSpan; ro += 1) {
          for (let co = 0; co < colSpan; co += 1) {
            const r = rowIndex + ro
            const c = colIndex + co
            if (!grid[r]) {
              grid[r] = []
            }
            if (ro !== 0 || co !== 0) {
              occupied.add(`${r}:${c}`)
            }
          }
        }
        colIndex += colSpan
      }
    }
    const rows = Math.max(1, grid.length)
    const cols = Math.max(1, maxCol)
    const cells: CellModel[][] = Array.from({ length: rows }, (_, r) => (
      Array.from({ length: cols }, (_, c) => ({ raw: grid[r]?.[c] || '' }))
    ))
    return { cells, rows, cols }
  } catch {
    return buildDefaultGrid()
  }
}

const colLabelToIndex = (label: string) => {
  let result = 0
  for (let i = 0; i < label.length; i += 1) {
    result = result * 26 + (label.charCodeAt(i) - 64)
  }
  return result - 1
}

const parseCellRef = (ref: string): { row: number; col: number } | null => {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase())
  if (!match) {
    return null
  }
  const col = colLabelToIndex(match[1])
  const row = Number.parseInt(match[2], 10) - 1
  if (!Number.isFinite(row) || row < 0 || col < 0) {
    return null
  }
  return { row, col }
}

const parseRangeRef = (text: string): { start: { row: number; col: number }; end: { row: number; col: number } } | null => {
  const parts = text.split(':')
  if (parts.length !== 2) {
    return null
  }
  const left = parseCellRef(parts[0])
  const right = parseCellRef(parts[1])
  if (!left || !right) {
    return null
  }
  return {
    start: { row: Math.min(left.row, right.row), col: Math.min(left.col, right.col) },
    end: { row: Math.max(left.row, right.row), col: Math.max(left.col, right.col) },
  }
}

const toNumber = (value: string): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeRange = (start: { row: number; col: number }, end: { row: number; col: number }): SelectionRange => ({
  startRow: Math.min(start.row, end.row),
  endRow: Math.max(start.row, end.row),
  startCol: Math.min(start.col, end.col),
  endCol: Math.max(start.col, end.col),
})

export default function AntdTableEditor({
  editorSessionKey,
  valueHtml,
  disabled = false,
  onChange,
  onError,
  activeCell,
  onSelectionChange,
  onHoverCellChange,
  onInteractionDebug,
  exportFileNamePrefix = 'table-export',
  hideExportButton = false,
  cellConfidenceByCoord,
  lowConfidenceThreshold = 0.85,
}: AntdTableEditorProps) {
  const [grid, setGrid] = useState<GridState>(() => parseHtmlToGrid(valueHtml))
  const [selection, setSelection] = useState(() => {
    const primary = { row: 0, col: 0 }
    return { anchor: primary, active: primary, ranges: [normalizeRange(primary, primary)] as SelectionRange[] }
  })
  const [exporting, setExporting] = useState(false)
  const draggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastEmittedHtmlRef = useRef<string>('')
  const lastSyncedExternalHtmlRef = useRef<string>('')
  const serializeHtml = useCallback((cells: CellModel[][]) => {
    const htmlRows = cells.map((row) => {
      const tds = row.map((cell) => `<td>${escapeHtml(cell.raw ?? '')}</td>`).join('')
      return `<tr>${tds}</tr>`
    }).join('')
    return `<div class="table-wrapper"><table><tbody>${htmlRows}</tbody></table></div>`
  }, [])

  useEffect(() => {
    setGrid(parseHtmlToGrid(valueHtml))
    setSelection({ anchor: { row: 0, col: 0 }, active: { row: 0, col: 0 }, ranges: [normalizeRange({ row: 0, col: 0 }, { row: 0, col: 0 })] })
  }, [editorSessionKey])

  useEffect(() => {
    const currentHtml = serializeHtml(grid.cells)
    if (valueHtml === lastSyncedExternalHtmlRef.current) {
      return
    }
    if (valueHtml === lastEmittedHtmlRef.current || valueHtml === currentHtml) {
      lastSyncedExternalHtmlRef.current = valueHtml
      return
    }
    lastSyncedExternalHtmlRef.current = valueHtml
    setGrid(parseHtmlToGrid(valueHtml))
  }, [grid.cells, serializeHtml, valueHtml])

  const evaluated = useMemo(() => {
    const cache = new Map<string, string>()
    const visiting = new Set<string>()
    const evalCell = (row: number, col: number): string => {
      const key = `${row}:${col}`
      if (cache.has(key)) {
        return cache.get(key) || ''
      }
      if (visiting.has(key)) {
        cache.set(key, '#CYCLE!')
        return '#CYCLE!'
      }
      const raw = grid.cells[row]?.[col]?.raw || ''
      if (!raw.startsWith('=')) {
        cache.set(key, raw)
        return raw
      }
      visiting.add(key)
      const expr = raw.slice(1).trim().toUpperCase()
      let result = '#ERR!'
      const direct = parseCellRef(expr)
      if (direct) {
        if (direct.row < grid.rows && direct.col < grid.cols) {
          result = evalCell(direct.row, direct.col)
        } else {
          result = ''
        }
      } else {
        const fnMatch = /^([A-Z]+)\((.*)\)$/.exec(expr)
        if (fnMatch) {
          const fnName = fnMatch[1]
          const args = fnMatch[2].split(',').map(item => item.trim()).filter(Boolean)
          const nums: number[] = []
          for (const arg of args) {
            const range = parseRangeRef(arg)
            if (range) {
              for (let r = range.start.row; r <= range.end.row; r += 1) {
                for (let c = range.start.col; c <= range.end.col; c += 1) {
                  if (r >= grid.rows || c >= grid.cols) {
                    continue
                  }
                  const n = toNumber(evalCell(r, c))
                  if (n !== null) {
                    nums.push(n)
                  }
                }
              }
              continue
            }
            const ref = parseCellRef(arg)
            if (ref) {
              if (ref.row < grid.rows && ref.col < grid.cols) {
                const n = toNumber(evalCell(ref.row, ref.col))
                if (n !== null) {
                  nums.push(n)
                }
              }
              continue
            }
            const n = toNumber(arg)
            if (n !== null) {
              nums.push(n)
            }
          }
          if (fnName === 'SUM') {
            result = String(nums.reduce((sum, value) => sum + value, 0))
          } else if (fnName === 'AVG') {
            result = nums.length ? String(nums.reduce((sum, value) => sum + value, 0) / nums.length) : '0'
          } else if (fnName === 'MIN') {
            result = nums.length ? String(Math.min(...nums)) : '0'
          } else if (fnName === 'MAX') {
            result = nums.length ? String(Math.max(...nums)) : '0'
          }
        }
      }
      visiting.delete(key)
      cache.set(key, result)
      return result
    }

    return grid.cells.map((row, rowIndex) => row.map((_, colIndex) => evalCell(rowIndex, colIndex)))
  }, [grid])

  const emitSelection = useCallback((next: { row: number; col: number; ranges: SelectionRange[]; source: string; fromKeyboard?: boolean }) => {
    onSelectionChange?.(next.row, next.col, { ranges: next.ranges, source: next.source, fromKeyboard: next.fromKeyboard })
    onInteractionDebug?.('selection-event', next)
  }, [onInteractionDebug, onSelectionChange])

  const updateSelection = useCallback((active: { row: number; col: number }, options?: { source?: string; fromKeyboard?: boolean; keepAnchor?: boolean }) => {
    setSelection(prev => {
      const anchor = options?.keepAnchor ? prev.anchor : active
      const range = normalizeRange(anchor, active)
      const next = { anchor, active, ranges: [range] }
      emitSelection({ row: active.row, col: active.col, ranges: next.ranges, source: options?.source || 'editor', fromKeyboard: options?.fromKeyboard })
      return next
    })
  }, [emitSelection])

  useEffect(() => {
    if (!activeCell) {
      return
    }
    const row = clamp(activeCell.row, 0, grid.rows - 1)
    const col = clamp(activeCell.col, 0, grid.cols - 1)
    setSelection({ anchor: { row, col }, active: { row, col }, ranges: [normalizeRange({ row, col }, { row, col })] })
  }, [activeCell, grid.cols, grid.rows])

  const emitGridChange = useCallback((nextCells: CellModel[][]) => {
    const nextHtml = serializeHtml(nextCells)
    lastEmittedHtmlRef.current = nextHtml
    onChange(nextHtml)
  }, [onChange, serializeHtml])

  const updateCell = useCallback((row: number, col: number, value: string) => {
    setGrid(prev => {
      const nextCells = prev.cells.map(row => row.map(cell => ({ ...cell })))
      nextCells[row][col].raw = value
      emitGridChange(nextCells)
      return { ...prev, cells: nextCells }
    })
  }, [emitGridChange])

  const clearSelection = useCallback(() => {
    setGrid(prev => {
      const nextCells = prev.cells.map(row => row.map(cell => ({ ...cell })))
      for (const range of selection.ranges) {
        for (let r = range.startRow; r <= range.endRow; r += 1) {
          for (let c = range.startCol; c <= range.endCol; c += 1) {
            nextCells[r][c].raw = ''
          }
        }
      }
      emitGridChange(nextCells)
      return { ...prev, cells: nextCells }
    })
  }, [emitGridChange, selection.ranges])

  const applyPaste = useCallback((text: string) => {
    const rows = text.split(/\r?\n/).filter(item => item.length > 0).map(row => row.split('\t'))
    if (!rows.length) {
      return
    }
    const start = selection.ranges[0] || normalizeRange(selection.active, selection.active)
    setGrid(prev => {
      const nextCells = prev.cells.map(row => row.map(cell => ({ ...cell })))
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < rows[r].length; c += 1) {
          const rr = start.startRow + r
          const cc = start.startCol + c
          if (rr >= prev.rows || cc >= prev.cols) {
            continue
          }
          nextCells[rr][cc].raw = rows[r][c]
        }
      }
      emitGridChange(nextCells)
      return { ...prev, cells: nextCells }
    })
  }, [emitGridChange, selection.active, selection.ranges])

  const moveBy = useCallback((rowDelta: number, colDelta: number, keepAnchor: boolean) => {
    const row = clamp(selection.active.row + rowDelta, 0, grid.rows - 1)
    const col = clamp(selection.active.col + colDelta, 0, grid.cols - 1)
    updateSelection({ row, col }, { source: 'keyboard', fromKeyboard: true, keepAnchor })
  }, [grid.cols, grid.rows, selection.active.col, selection.active.row, updateSelection])

  const onKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return
    }
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') {
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      try {
        const text = await navigator.clipboard.readText()
        applyPaste(text)
      } catch {
        onError?.('读取剪贴板失败，请检查浏览器权限')
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveBy(-1, 0, event.shiftKey)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveBy(1, 0, event.shiftKey)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveBy(0, -1, event.shiftKey)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveBy(0, 1, event.shiftKey)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      clearSelection()
      return
    }
  }

  const exportXlsx = () => {
    setExporting(true)
    try {
      const aoa = evaluated.map(row => row.map(value => {
        const n = Number(value)
        return Number.isFinite(n) && value !== '' ? n : value
      }))
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      for (let r = 0; r < grid.rows; r += 1) {
        for (let c = 0; c < grid.cols; c += 1) {
          const raw = grid.cells[r][c].raw || ''
          if (!raw.startsWith('=')) {
            continue
          }
          const address = XLSX.utils.encode_cell({ r, c })
          const cell = ws[address] || { t: 'n', v: 0 }
          ws[address] = { ...cell, f: raw.slice(1) }
        }
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const prefix = String(exportFileNamePrefix || 'table-export').trim() || 'table-export'
      link.href = href
      link.download = `${prefix}-${Date.now()}.xlsx`
      link.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '导出 Excel 失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="rounded border border-gray-200 bg-white">
      {!hideExportButton ? (
        <div className="flex justify-end border-b border-gray-100 px-3 py-2">
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={exportXlsx}
            disabled={exporting}
          >
            {exporting ? '导出中...' : '导出 Excel'}
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        tabIndex={0}
        className="w-full overflow-hidden p-2 outline-none"
        onFocus={() => onInteractionDebug?.('focus', { editorSessionKey })}
        onKeyDown={onKeyDown}
        onMouseLeave={() => onHoverCellChange?.(-1, null)}
        onMouseUp={() => {
          draggingRef.current = false
        }}
      >
        <table className="w-full border-collapse select-none text-sm">
          <tbody>
            {grid.cells.map((row, rowIndex) => (
              <tr key={`r-${rowIndex}`}>
                {row.map((cell, colIndex) => {
                  const isActive = rowIndex === selection.active.row && colIndex === selection.active.col
                  const inRange = selection.ranges.some(range => rowIndex >= range.startRow && rowIndex <= range.endRow && colIndex >= range.startCol && colIndex <= range.endCol)
                  const cellConfidence = cellConfidenceByCoord?.[`${rowIndex}:${colIndex}`]
                  const isLowConfidence = typeof cellConfidence === 'number' && cellConfidence < lowConfidenceThreshold
                  return (
                    <td
                      key={`c-${rowIndex}-${colIndex}`}
                      className={`relative min-w-[88px] border px-2 py-1 align-top ${isActive ? 'border-blue-500' : 'border-gray-200'} ${inRange ? 'bg-blue-50' : 'bg-white'}`}
                      onMouseDown={() => {
                        if (disabled) {
                          return
                        }
                        draggingRef.current = true
                        updateSelection({ row: rowIndex, col: colIndex }, { source: 'mouse' })
                      }}
                      onMouseEnter={() => {
                        onHoverCellChange?.(rowIndex, colIndex)
                        onInteractionDebug?.('hover', { row: rowIndex, col: colIndex })
                        if (!disabled && draggingRef.current) {
                          updateSelection({ row: rowIndex, col: colIndex }, { source: 'mouse', keepAnchor: true })
                        }
                      }}
                    >
                      <input
                        className={`w-full border-0 bg-transparent p-0 outline-none ${isLowConfidence ? 'text-red-500' : ''}`}
                        value={cell.raw}
                        disabled={disabled}
                        onFocus={() => {
                          if (disabled) {
                            return
                          }
                          updateSelection({ row: rowIndex, col: colIndex }, { source: 'focus' })
                        }}
                        onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
