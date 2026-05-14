'use client'

import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

type UniverTableEditorProps = {
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
}

export type SelectionRange = {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

type ParsedTable = {
  values: string[][]
  merges: Array<{ row: number, col: number, rowSpan: number, colSpan: number }>
  warnings: Array<{ code: string, row: number, col?: number, message: string }>
  stats: {
    inputRows: number
    outputRows: number
    targetCols: number
  }
}

type ParsedWorkbook = {
  tables: ParsedTable[]
  diagnostics: {
    strategy: 'raw' | 'decoded' | 'embedded-extracted' | 'fallback-empty'
    fallbackUsed: boolean
    reasonCode: string
    reason: string
    tableCount: number
  }
}

const normalizeHtml = (value: string) => String(value || '').trim()

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;')

const buildEmptyTable = (): ParsedTable => ({
  values: [['']],
  merges: [],
  warnings: [],
  stats: {
    inputRows: 0,
    outputRows: 1,
    targetCols: 1,
  },
})

const parseSpan = (value: string | null): number => {
  const parsed = Number.parseInt(String(value || '1').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1
  }
  return parsed
}

const normalizeCellText = (value: string) => String(value || '')
  .replaceAll('\u00A0', ' ')
  .replace(/\s+/g, ' ')
  .trim()

const THOUSANDS_NUMBER_PATTERN = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/

const normalizeCellValueForSheet = (value: string): string | number => {
  const trimmed = String(value || '').trim()
  if (!trimmed || trimmed.startsWith('=')) {
    return trimmed
  }
  if (!THOUSANDS_NUMBER_PATTERN.test(trimmed)) {
    return trimmed
  }
  const parsed = Number(trimmed.replaceAll(',', ''))
  if (!Number.isFinite(parsed)) {
    return trimmed
  }
  return parsed
}

const decodeHtmlEntitiesOnce = (value: string) => {
  if (!value) {
    return ''
  }
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

const wrapWithTableContainer = (tableHTML: string) => {
  const normalized = normalizeHtml(tableHTML)
  if (!normalized) {
    return ''
  }
  return `<div class="table-wrapper">${normalized}</div>`
}

const extractFirstTableHTML = (value: string): string => {
  const html = normalizeHtml(value)
  if (!html) {
    return ''
  }
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (table?.outerHTML) {
      return table.outerHTML
    }
  } catch {
    return ''
  }
  return ''
}

const extractEmbeddedTableHTML = (valueHtml: string): string => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(valueHtml || ''), 'text/html')
  const candidates = Array.from(doc.querySelectorAll('th, td, p, div, span'))
  for (const node of candidates) {
    const text = normalizeHtml(node.textContent || '')
    if (!text) {
      continue
    }
    const maybeRaw = text.includes('<table') ? text : ''
    if (maybeRaw) {
      const tableHTML = extractFirstTableHTML(maybeRaw)
      if (tableHTML) {
        return wrapWithTableContainer(tableHTML)
      }
    }
    if (!text.includes('&lt;table')) {
      continue
    }
    const decoded = decodeHtmlEntitiesOnce(text)
    const tableHTML = extractFirstTableHTML(decoded)
    if (tableHTML) {
      return wrapWithTableContainer(tableHTML)
    }
  }
  return ''
}

const normalizeTableHtmlForParse = (valueHtml: string): { html: string, strategy: ParsedWorkbook['diagnostics']['strategy'], reasonCode: string, reason: string } => {
  const raw = String(valueHtml || '')
  const rawTable = extractFirstTableHTML(raw)
  if (rawTable) {
    return {
      html: raw,
      strategy: 'raw',
      reasonCode: 'ok-raw',
      reason: '使用原始HTML解析表格',
    }
  }
  const decoded = decodeHtmlEntitiesOnce(raw)
  if (decoded && decoded !== raw) {
    const decodedTable = extractFirstTableHTML(decoded)
    if (decodedTable) {
      return {
        html: wrapWithTableContainer(decodedTable),
        strategy: 'decoded',
        reasonCode: 'ok-decoded',
        reason: '使用一次HTML实体解码后的内容解析表格',
      }
    }
  }
  const embedded = extractEmbeddedTableHTML(raw)
  if (embedded) {
    return {
      html: embedded,
      strategy: 'embedded-extracted',
      reasonCode: 'ok-embedded-extracted',
      reason: '从单元格/段落中提取嵌套表格并解析',
    }
  }
  return {
    html: raw,
    strategy: 'fallback-empty',
    reasonCode: 'no-table-found',
    reason: '未找到可解析的<table>结构',
  }
}

const collectTableRows = (table: HTMLTableElement): HTMLTableRowElement[] => {
  return Array.from(table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')) as HTMLTableRowElement[]
}

const inferTargetColumns = (rows: HTMLTableRowElement[]): number => {
  const sampleRows = rows.slice(0, 30)
  const frequencies = new Map<number, number>()
  const values: number[] = []
  for (const row of sampleRows) {
    const cells = Array.from(row.children).filter((node) => {
      const tag = (node as HTMLElement).tagName?.toLowerCase()
      return tag === 'td' || tag === 'th'
    }) as HTMLTableCellElement[]
    const effectiveCols = cells.reduce((sum, cell) => sum + parseSpan(cell.getAttribute('colspan')), 0)
    if (effectiveCols <= 0) {
      continue
    }
    frequencies.set(effectiveCols, (frequencies.get(effectiveCols) || 0) + 1)
    values.push(effectiveCols)
  }
  if (frequencies.size === 0) {
    return 4
  }
  const sortedValues = values.slice().sort((left, right) => left - right)
  const median = sortedValues[Math.floor(sortedValues.length / 2)] || 4
  let best = 4
  let bestFrequency = -1
  for (const [colCount, frequency] of frequencies.entries()) {
    if (frequency > bestFrequency) {
      best = colCount
      bestFrequency = frequency
      continue
    }
    if (frequency === bestFrequency) {
      const currentDistance = Math.abs(colCount - median)
      const bestDistance = Math.abs(best - median)
      if (currentDistance < bestDistance || (currentDistance === bestDistance && colCount < best)) {
        best = colCount
      }
    }
  }
  return Math.max(1, Math.min(64, best))
}

const isEmptyNoiseRow = (row: HTMLTableRowElement): boolean => {
  const cells = Array.from(row.children).filter((node) => {
    const tag = (node as HTMLElement).tagName?.toLowerCase()
    return tag === 'td' || tag === 'th'
  }) as HTMLTableCellElement[]
  if (cells.length === 0) {
    return true
  }
  for (const cell of cells) {
    const rowSpan = parseSpan(cell.getAttribute('rowspan'))
    const colSpan = parseSpan(cell.getAttribute('colspan'))
    if (rowSpan > 1 || colSpan > 1) {
      return false
    }
    if (normalizeCellText(cell.textContent || '') !== '') {
      return false
    }
  }
  return true
}

const compactNoiseRows = (rows: HTMLTableRowElement[]): HTMLTableRowElement[] => {
  const compacted: HTMLTableRowElement[] = []
  let previousWasEmpty = false
  for (const row of rows) {
    const currentEmpty = isEmptyNoiseRow(row)
    if (currentEmpty && previousWasEmpty) {
      continue
    }
    compacted.push(row)
    previousWasEmpty = currentEmpty
  }
  return compacted
}

const parseSingleTableElement = (table: HTMLTableElement, tableIndex: number): ParsedTable => {
  const rawRows = collectTableRows(table)
  if (rawRows.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[UniverTableEditor] table#${tableIndex + 1} parse failed: no <tr> rows found`)
    }
    return buildEmptyTable()
  }
  const rowNodes = compactNoiseRows(rawRows)
  if (rowNodes.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[UniverTableEditor] table#${tableIndex + 1} parse failed: all rows are empty/noise after sanitize`)
    }
    return buildEmptyTable()
  }
  const targetCols = inferTargetColumns(rowNodes)
  const warnings: ParsedTable['warnings'] = []
  const occupied = new Set<string>()
  const values: string[][] = []
  const merges: Array<{ row: number, col: number, rowSpan: number, colSpan: number }> = []
  for (let rowIndex = 0; rowIndex < rowNodes.length; rowIndex++) {
    const rowNode = rowNodes[rowIndex]
    values[rowIndex] = Array.from({ length: targetCols }, () => '')
    const cellNodes = Array.from(rowNode.children).filter((node) => {
      const tag = (node as HTMLElement).tagName?.toLowerCase()
      return tag === 'td' || tag === 'th'
    }) as HTMLTableCellElement[]
    let columnIndex = 0
    for (const cell of cellNodes) {
      while (columnIndex < targetCols && occupied.has(`${rowIndex}:${columnIndex}`)) {
        columnIndex++
      }
      if (columnIndex >= targetCols) {
        warnings.push({
          code: 'drop-overflow-cell',
          row: rowIndex,
          message: '列溢出，当前单元格已丢弃',
        })
        continue
      }
      const rawRowSpan = parseSpan(cell.getAttribute('rowspan'))
      const rawColSpan = parseSpan(cell.getAttribute('colspan'))
      const clippedRowSpan = Math.min(rawRowSpan, rowNodes.length - rowIndex)
      if (clippedRowSpan !== rawRowSpan) {
        warnings.push({
          code: 'clip-rowspan',
          row: rowIndex,
          col: columnIndex,
          message: `rowspan ${rawRowSpan} 已裁剪为 ${clippedRowSpan}`,
        })
      }
      const maxAvailableCols = targetCols - columnIndex
      let clippedColSpan = Math.min(rawColSpan, maxAvailableCols)
      if (clippedColSpan !== rawColSpan) {
        warnings.push({
          code: 'clip-colspan',
          row: rowIndex,
          col: columnIndex,
          message: `colspan ${rawColSpan} 已裁剪为 ${clippedColSpan}`,
        })
      }
      let safeColSpan = 0
      while (safeColSpan < clippedColSpan) {
        if (occupied.has(`${rowIndex}:${columnIndex + safeColSpan}`)) {
          break
        }
        safeColSpan++
      }
      if (safeColSpan <= 0) {
        warnings.push({
          code: 'drop-collision-cell',
          row: rowIndex,
          col: columnIndex,
          message: '单元格与已有跨行/跨列冲突，已丢弃',
        })
        continue
      }
      clippedColSpan = safeColSpan
      const text = normalizeCellText(cell.textContent || '')
      values[rowIndex][columnIndex] = text
      if (clippedRowSpan > 1 || clippedColSpan > 1) {
        merges.push({ row: rowIndex, col: columnIndex, rowSpan: clippedRowSpan, colSpan: clippedColSpan })
      }
      for (let rowOffset = 0; rowOffset < clippedRowSpan; rowOffset++) {
        for (let colOffset = 0; colOffset < clippedColSpan; colOffset++) {
          if (rowOffset === 0 && colOffset === 0) {
            continue
          }
          const targetRow = rowIndex + rowOffset
          const targetCol = columnIndex + colOffset
          if (targetRow >= rowNodes.length || targetCol >= targetCols) {
            continue
          }
          const key = `${targetRow}:${targetCol}`
          if (occupied.has(key)) {
            warnings.push({
              code: 'drop-overlap-merge',
              row: targetRow,
              col: targetCol,
              message: '跨行/跨列覆盖冲突，重叠区域已忽略',
            })
            continue
          }
          occupied.add(key)
        }
      }
      columnIndex += clippedColSpan
    }
  }
  if (process.env.NODE_ENV !== 'production' && warnings.length > 0) {
    console.warn(`[UniverTableEditor] table#${tableIndex + 1} sanitized: inputRows=${rawRows.length}, outputRows=${rowNodes.length}, targetCols=${targetCols}, warnings=${warnings.length}`)
  }
  return {
    values,
    merges,
    warnings,
    stats: {
      inputRows: rawRows.length,
      outputRows: rowNodes.length,
      targetCols,
    },
  }
}

const parseHtmlTablesToWorkbook = (valueHtml: string): ParsedWorkbook => {
  try {
    const normalized = normalizeTableHtmlForParse(valueHtml)
    const parser = new DOMParser()
    const doc = parser.parseFromString(normalized.html, 'text/html')
    const tables = Array.from(doc.querySelectorAll('table'))
    if (tables.length === 0) {
      const snippet = normalizeHtml(valueHtml).slice(0, 280)
      console.error(`[UniverTableEditor] parse failed: no <table> found. reasonCode=${normalized.reasonCode}, reason="${normalized.reason}", snippet="${snippet}"`)
      return {
        tables: [buildEmptyTable()],
        diagnostics: {
          strategy: 'fallback-empty',
          fallbackUsed: true,
          reasonCode: normalized.reasonCode,
          reason: normalized.reason,
          tableCount: 0,
        },
      }
    }
    const parsedTables = tables.map((table, index) => parseSingleTableElement(table as HTMLTableElement, index))
    const hasMeaningfulTable = parsedTables.some(table => table.stats.inputRows > 0 && table.stats.outputRows > 0)
    if (!hasMeaningfulTable) {
      const snippet = normalizeHtml(valueHtml).slice(0, 280)
      console.error(`[UniverTableEditor] parse failed: tables exist but rows invalid. strategy=${normalized.strategy}, snippet="${snippet}"`)
      return {
        tables: [buildEmptyTable()],
        diagnostics: {
          strategy: 'fallback-empty',
          fallbackUsed: true,
          reasonCode: 'invalid-table-rows',
          reason: '检测到<table>但无法提取有效行列',
          tableCount: tables.length,
        },
      }
    }
    return {
      tables: parsedTables,
      diagnostics: {
        strategy: normalized.strategy,
        fallbackUsed: false,
        reasonCode: normalized.reasonCode,
        reason: normalized.reason,
        tableCount: tables.length,
      },
    }
  } catch (error) {
    const snippet = normalizeHtml(valueHtml).slice(0, 280)
    const reason = error instanceof Error ? error.message : 'unknown error'
    console.error(`[UniverTableEditor] parse failed with exception: ${reason}. snippet="${snippet}"`, error)
    return {
      tables: [buildEmptyTable()],
      diagnostics: {
        strategy: 'fallback-empty',
        fallbackUsed: true,
        reasonCode: 'parse-exception',
        reason,
        tableCount: 0,
      },
    }
  }
}

const serializeSheetToHtml = (sheet: any): string => {
  const dataRange = sheet?.getDataRange?.()
  const matrix = (dataRange?.getDisplayValues?.() || dataRange?.getValues?.() || []) as unknown[][]
  const rows = Array.isArray(matrix) ? matrix : []
  if (rows.length === 0) {
    return '<div class="table-wrapper"><table><tbody><tr><td></td></tr></tbody></table></div>'
  }
  const colCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 1)
  const mergedRanges = Array.isArray(sheet?.getMergedRanges?.()) ? sheet.getMergedRanges() : []
  const mergeByStart = new Map<string, { rowSpan: number, colSpan: number }>()
  const coveredCells = new Set<string>()
  for (const range of mergedRanges) {
    const startRow = Number(range?.getRow?.() ?? 0)
    const startCol = Number(range?.getColumn?.() ?? 0)
    const rowSpan = Math.max(1, Number(range?.getHeight?.() ?? 1))
    const colSpan = Math.max(1, Number(range?.getWidth?.() ?? 1))
    mergeByStart.set(`${startRow}:${startCol}`, { rowSpan, colSpan })
    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset++) {
      for (let colOffset = 0; colOffset < colSpan; colOffset++) {
        if (rowOffset === 0 && colOffset === 0) {
          continue
        }
        coveredCells.add(`${startRow + rowOffset}:${startCol + colOffset}`)
      }
    }
  }
  const htmlRows = rows.map((row, rowIndex) => {
    const cells = Array.isArray(row) ? row : []
    const tds = Array.from({ length: colCount }, (_, colIndex) => {
      if (coveredCells.has(`${rowIndex}:${colIndex}`)) {
        return ''
      }
      const value = cells[colIndex]
      const text = value === null || value === undefined ? '' : String(value)
      const merge = mergeByStart.get(`${rowIndex}:${colIndex}`)
      const attrs = [
        merge && merge.rowSpan > 1 ? ` rowspan="${merge.rowSpan}"` : '',
        merge && merge.colSpan > 1 ? ` colspan="${merge.colSpan}"` : '',
      ].join('')
      return `<td${attrs}>${escapeHtml(text)}</td>`
    }).join('')
    return `<tr>${tds}</tr>`
  }).join('')
  return `<div class="table-wrapper"><table><tbody>${htmlRows}</tbody></table></div>`
}

const serializeWorkbookToHtml = (api: any): string => {
  const workbook = api?.getActiveWorkbook?.()
  const sheets = Array.isArray(workbook?.getSheets?.()) ? workbook.getSheets() : []
  if (sheets.length === 0) {
    return '<div class="table-wrapper"><table><tbody><tr><td></td></tr></tbody></table></div>'
  }
  return sheets.map((sheet: any) => serializeSheetToHtml(sheet)).join('')
}

const normalizeSelectionRange = (rawRange: any): SelectionRange | null => {
  if (!rawRange) {
    return null
  }
  const startRow = Number(rawRange?.startRow ?? rawRange?.startRowIndex ?? rawRange?.row)
  const endRow = Number(rawRange?.endRow ?? rawRange?.endRowIndex ?? rawRange?.row ?? startRow)
  const startCol = Number(rawRange?.startColumn ?? rawRange?.startColumnIndex ?? rawRange?.column ?? rawRange?.col)
  const endCol = Number(rawRange?.endColumn ?? rawRange?.endColumnIndex ?? rawRange?.column ?? rawRange?.col ?? startCol)
  if (![startRow, endRow, startCol, endCol].every(Number.isFinite)) {
    return null
  }
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  }
}

const collectSelectionRangesFromEvent = (event: any): SelectionRange[] => {
  const payload = event?.payload
  const candidates = [
    ...(Array.isArray(payload?.selections) ? payload.selections.map((item: any) => item?.range) : []),
    ...(Array.isArray(payload?.selectionRanges) ? payload.selectionRanges : []),
    ...(Array.isArray(payload?.ranges) ? payload.ranges : []),
    payload?.selection?.range,
    payload?.range,
    ...(Array.isArray(event?.selections) ? event.selections.map((item: any) => item?.range) : []),
    ...(Array.isArray(event?.selectionRanges) ? event.selectionRanges : []),
    event?.range,
  ]
  const ranges = candidates.map(normalizeSelectionRange).filter((range): range is SelectionRange => Boolean(range))
  const unique = new Map<string, SelectionRange>()
  for (const range of ranges) {
    unique.set(`${range.startRow}:${range.endRow}:${range.startCol}:${range.endCol}`, range)
  }
  return Array.from(unique.values())
}

export default function UniverTableEditor({
  editorSessionKey,
  valueHtml,
  disabled = false,
  onChange,
  onError,
  activeCell = null,
  onSelectionChange,
  onHoverCellChange,
  onInteractionDebug,
  exportFileNamePrefix = 'univer-export',
  hideExportButton = false,
}: UniverTableEditorProps) {
  const [exporting, setExporting] = useState(false)
  const [univerReady, setUniverReady] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const univerRef = useRef<any>(null)
  const apiRef = useRef<any>(null)
  const valueChangedListenerRef = useRef<any>(null)
  const selectionListenerRef = useRef<any>(null)
  const debounceRef = useRef<number>(0)
  const hoverTimerRef = useRef<number>(0)
  const lastHoverAtRef = useRef(0)
  const pointerHoverRef = useRef<{ row: number; col: number | null }>({ row: -1, col: null })
  const lastSelectionRef = useRef<{ row: number; col: number; rangeKey: string } | null>(null)
  const suppressSelectionEmitRef = useRef(false)
  const lastEmittedHTMLRef = useRef('')
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onHoverCellChangeRef = useRef(onHoverCellChange)
  const onInteractionDebugRef = useRef(onInteractionDebug)
  const lastErrorMessageRef = useRef('')
  const lastErrorAtRef = useRef(0)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    onHoverCellChangeRef.current = onHoverCellChange
  }, [onHoverCellChange])

  useEffect(() => {
    onInteractionDebugRef.current = onInteractionDebug
  }, [onInteractionDebug])

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        setUniverReady(false)
        const host = hostRef.current
        if (!host) {
          return
        }
        host.innerHTML = ''
        const parsedWorkbook = parseHtmlTablesToWorkbook(valueHtml)
        const emitError = (message: string) => {
          const now = Date.now()
          if (lastErrorMessageRef.current === message && now - lastErrorAtRef.current < 2000) {
            return
          }
          lastErrorMessageRef.current = message
          lastErrorAtRef.current = now
          onErrorRef.current?.(message)
        }
        if (parsedWorkbook.diagnostics.fallbackUsed) {
          emitError(`[${parsedWorkbook.diagnostics.reasonCode}] ${parsedWorkbook.diagnostics.reason}`)
        } else if (
          process.env.NODE_ENV !== 'production'
          && parsedWorkbook.diagnostics.strategy !== 'raw'
        ) {
          console.warn(
            `[UniverTableEditor] parse repaired by strategy=${parsedWorkbook.diagnostics.strategy}, reasonCode=${parsedWorkbook.diagnostics.reasonCode}`,
          )
        }
        const [
          core,
          facade,
          engineRender,
          engineFormula,
          ui,
          designZhCN,
          uiZhCN,
          docs,
          docsUi,
          docsUiZhCN,
          sheets,
          sheetsZhCN,
          sheetsUi,
          sheetsUiZhCN,
        ] = await Promise.all([
          import('@univerjs/core'),
          import('@univerjs/core/facade'),
          import('@univerjs/engine-render'),
          import('@univerjs/engine-formula'),
          import('@univerjs/ui'),
          import('@univerjs/design/locale/zh-CN'),
          import('@univerjs/ui/locale/zh-CN'),
          import('@univerjs/docs'),
          import('@univerjs/docs-ui'),
          import('@univerjs/docs-ui/locale/zh-CN'),
          import('@univerjs/sheets'),
          import('@univerjs/sheets/locale/zh-CN'),
          import('@univerjs/sheets-ui'),
          import('@univerjs/sheets-ui/locale/zh-CN'),
          import('@univerjs/sheets/facade'),
        ])
        if (cancelled) {
          return
        }
        const locale = (core.LocaleType as any)?.ZH_CN || core.LocaleType.EN_US
        const mergedZhCN = core.mergeLocales(
          (designZhCN as any).default || designZhCN,
          (uiZhCN as any).default || uiZhCN,
          (docsUiZhCN as any).default || docsUiZhCN,
          (sheetsZhCN as any).default || sheetsZhCN,
          (sheetsUiZhCN as any).default || sheetsUiZhCN,
        )
        const univer = new core.Univer({
          locale: locale as any,
          locales: {
            [locale]: mergedZhCN,
          },
        })
        univer.registerPlugin(engineRender.UniverRenderEnginePlugin)
        univer.registerPlugin(engineFormula.UniverFormulaEnginePlugin)
        univer.registerPlugin(ui.UniverUIPlugin, { container: host })
        univer.registerPlugin(docs.UniverDocsPlugin)
        univer.registerPlugin(docsUi.UniverDocsUIPlugin)
        univer.registerPlugin(sheets.UniverSheetsPlugin)
        univer.registerPlugin(sheetsUi.UniverSheetsUIPlugin)
        univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, {})
        const api = facade.FUniver.newAPI(univer)
        const workbook = api.getActiveWorkbook()
        if (!workbook) {
          throw new Error('Univer 工作簿初始化失败')
        }
        const firstSheet = workbook?.getActiveSheet?.()
        if (!firstSheet) {
          throw new Error('Univer 工作表初始化失败')
        }
        for (let index = 0; index < parsedWorkbook.tables.length; index++) {
          const parsed = parsedWorkbook.tables[index]
          let sheet = index === 0 ? firstSheet : null
          if (!sheet) {
            sheet = workbook.insertSheet(`Table ${index + 1}`)
          }
          sheet.clear()
          const rowCount = Math.max(parsed.values.length, 1)
          const colCount = Math.max(parsed.values[0]?.length || 1, 1)
          const normalizedValues = parsed.values.map(row => row.map(cell => normalizeCellValueForSheet(cell)))
          sheet.getRange(0, 0, rowCount, colCount).setValues(normalizedValues)
          for (const merge of parsed.merges) {
            if (merge.rowSpan <= 1 && merge.colSpan <= 1) {
              continue
            }
            const maxRowSpan = rowCount - merge.row
            const maxColSpan = colCount - merge.col
            if (maxRowSpan <= 0 || maxColSpan <= 0) {
              continue
            }
            const safeRowSpan = Math.max(1, Math.min(merge.rowSpan, maxRowSpan))
            const safeColSpan = Math.max(1, Math.min(merge.colSpan, maxColSpan))
            try {
              sheet.getRange(merge.row, merge.col, safeRowSpan, safeColSpan).merge(true)
            } catch (error) {
              if (process.env.NODE_ENV !== 'production') {
                console.warn('[UniverTableEditor] skip invalid merge range', {
                  merge,
                  safeRowSpan,
                  safeColSpan,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            }
          }
        }
        workbook.setActiveSheet(firstSheet)
        lastEmittedHTMLRef.current = normalizeHtml(serializeWorkbookToHtml(api))
        const scheduleEmit = () => {
          if (disabled) {
            return
          }
          if (debounceRef.current) {
            window.clearTimeout(debounceRef.current)
          }
          debounceRef.current = window.setTimeout(() => {
            const currentApi = apiRef.current
            if (!currentApi) {
              return
            }
            const normalized = normalizeHtml(serializeWorkbookToHtml(currentApi))
            if (normalized === lastEmittedHTMLRef.current) {
              return
            }
            lastEmittedHTMLRef.current = normalized
            onChangeRef.current(normalized)
          }, 300)
        }
        if (!disabled) {
          valueChangedListenerRef.current = api.addEvent(
            api.Event.SheetValueChanged,
            scheduleEmit,
          )
        }
        const selectionEventName = (api.Event as any)?.SheetSelectionChanged
          || (api.Event as any)?.SelectionChanged
          || (api.Event as any)?.SheetSelectionSet
        const emitSelection = (
          row: number,
          col: number,
          ranges: SelectionRange[],
          phase: 'selection-event' | 'selection-fallback',
          payload?: Record<string, unknown>,
        ) => {
          if (!Number.isFinite(row) || !Number.isFinite(col)) {
            return
          }
          const normalizedRanges = ranges.length > 0 ? ranges : [{ startRow: row, endRow: row, startCol: col, endCol: col }]
          const rangeKey = normalizedRanges.map(range => `${range.startRow}:${range.endRow}:${range.startCol}:${range.endCol}`).join('|')
          if (
            lastSelectionRef.current?.row === row
            && lastSelectionRef.current?.col === col
            && lastSelectionRef.current?.rangeKey === rangeKey
          ) {
            return
          }
          lastSelectionRef.current = { row, col, rangeKey }
          onSelectionChangeRef.current?.(row, col, {
            ranges: normalizedRanges,
            source: String(payload?.source || phase),
            fromKeyboard: Boolean(payload?.fromKeyboard),
          })
          onInteractionDebugRef.current?.(phase, { row, col, ranges: normalizedRanges, ...(payload || {}) })
        }
        const readActiveCellCoord = (): { row: number; col: number } | null => {
          try {
            const workbook = api?.getActiveWorkbook?.()
            const sheet = workbook?.getActiveSheet?.()
            const activeCell = sheet?.getActiveCell?.() as any
            const row = Number(activeCell?.getRow?.() ?? activeCell?.row ?? activeCell?.rowIndex)
            const col = Number(activeCell?.getColumn?.() ?? activeCell?.col ?? activeCell?.column ?? activeCell?.columnIndex)
            if (Number.isFinite(row) && Number.isFinite(col)) {
              return { row, col }
            }
            return null
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'unknown error'
            emitError(`[active-cell-read-failed] ${detail}`)
            return null
          }
        }
        const resolveSelection = (event: any): { row: number; col: number; ranges: SelectionRange[] } | null => {
          try {
            const ranges = collectSelectionRangesFromEvent(event)
            const primary = ranges[0]
            if (primary) {
              return { row: primary.startRow, col: primary.startCol, ranges }
            }
            const fallback = readActiveCellCoord()
            if (!fallback) {
              return null
            }
            return { row: fallback.row, col: fallback.col, ranges: [{ startRow: fallback.row, endRow: fallback.row, startCol: fallback.col, endCol: fallback.col }] }
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'unknown error'
            emitError(`[selection-parse-failed] ${detail}`)
            return null
          }
        }
        if (selectionEventName) {
          selectionListenerRef.current = api.addEvent(
            selectionEventName,
            (event: any) => {
            if (suppressSelectionEmitRef.current) {
              return
            }
            const selection = resolveSelection(event)
            if (!selection) {
              return
            }
            emitSelection(selection.row, selection.col, selection.ranges, 'selection-event', { source: 'selection-event', fromKeyboard: false })
            },
          )
        }
        const hostElement = hostRef.current
        const readCurrentSelection = (): { row: number; col: number; ranges: SelectionRange[] } | null => {
          try {
            const workbook = api?.getActiveWorkbook?.()
            const sheet = workbook?.getActiveSheet?.() as any
            const selectionRaw = sheet?.getSelections?.() || sheet?.getSelection?.() || []
            const selections = Array.isArray(selectionRaw) ? selectionRaw : [selectionRaw]
            const ranges = Array.isArray(selections)
              ? selections.map((selection: any) => normalizeSelectionRange(selection?.getRange?.() || selection?.range || selection)).filter((range): range is SelectionRange => Boolean(range))
              : []
            if (ranges.length > 0) {
              const primary = ranges[0]
              return { row: primary.startRow, col: primary.startCol, ranges }
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'unknown error'
            emitError(`[selection-read-failed] ${detail}`)
          }
          const active = readActiveCellCoord()
          if (!active) {
            return null
          }
          return { row: active.row, col: active.col, ranges: [{ startRow: active.row, endRow: active.row, startCol: active.col, endCol: active.col }] }
        }
        const syncSelectionFromCurrent = (phase: 'selection-fallback', source: string, fromKeyboard = false) => {
          if (suppressSelectionEmitRef.current) {
            return
          }
          const selection = readCurrentSelection()
          if (!selection) {
            emitError('[selection-sync-failed] 无法读取当前活动单元格')
            return
          }
          emitSelection(selection.row, selection.col, selection.ranges, phase, { source, fromKeyboard })
        }
        const tryEmitHover = (row: number, col: number | null) => {
          const previous = pointerHoverRef.current
          if (previous.row === row && previous.col === col) {
            return
          }
          pointerHoverRef.current = { row, col }
          onHoverCellChangeRef.current?.(row, col)
          onInteractionDebugRef.current?.('hover', { row, col })
        }
        const readCellFromTarget = (target: EventTarget | null): { row: number; col: number } | null => {
          const element = target as HTMLElement | null
          if (!element) {
            return null
          }
          const cellElement = element.closest('[data-row],[data-row-index]') as HTMLElement | null
          if (!cellElement) {
            return null
          }
          const row = Number(cellElement.dataset.row ?? cellElement.dataset.rowIndex)
          const col = Number(
            cellElement.dataset.col
            ?? cellElement.dataset.column
            ?? cellElement.dataset.colIndex
            ?? cellElement.dataset.columnIndex
          )
          if (!Number.isFinite(row) || !Number.isFinite(col)) {
            return null
          }
          return { row, col }
        }
        const handlePointerMove = (event: PointerEvent) => {
          const now = Date.now()
          if (now - lastHoverAtRef.current < 24) {
            return
          }
          lastHoverAtRef.current = now
          const hit = readCellFromTarget(event.target)
          if (!hit) {
            tryEmitHover(-1, null)
            return
          }
          tryEmitHover(hit.row, hit.col)
        }
        const handlePointerLeave = () => {
          tryEmitHover(-1, null)
        }
        const isFocusInsideHost = () => {
          const active = document.activeElement
          return Boolean(active && hostElement && hostElement.contains(active))
        }
        const focusEditableInHost = () => {
          if (!hostElement) {
            return
          }
          const target = hostElement.querySelector(
            '[contenteditable="true"], textarea, input, canvas, .univer-sheet-container, .univer-sheet-canvas, .univer-scrollbar__viewport',
          ) as HTMLElement | null
          if (target && typeof target.focus === 'function') {
            target.focus()
            onInteractionDebugRef.current?.('focus', { focused: true, target: target.tagName.toLowerCase() })
            return
          }
          hostElement.focus()
          onInteractionDebugRef.current?.('focus', { focused: true, target: 'host' })
        }
        const handlePointerUp = () => {
          focusEditableInHost()
          syncSelectionFromCurrent('selection-fallback', 'pointerup')
        }
        const handleMouseUp = () => {
          syncSelectionFromCurrent('selection-fallback', 'mouseup')
        }
        const handlePointerDown = () => {
          focusEditableInHost()
        }
        const handleKeySelection = (event: KeyboardEvent) => {
          const isArrowKey = event.key === 'ArrowUp'
            || event.key === 'ArrowDown'
            || event.key === 'ArrowLeft'
            || event.key === 'ArrowRight'
          if (!isArrowKey || !isFocusInsideHost()) {
            return
          }
          event.preventDefault()
          window.requestAnimationFrame(() => {
            syncSelectionFromCurrent('selection-fallback', event.type, true)
          })
        }
        hostElement?.addEventListener('pointermove', handlePointerMove, { passive: true })
        hostElement?.addEventListener('pointerleave', handlePointerLeave)
        hostElement?.addEventListener('pointerdown', handlePointerDown)
        hostElement?.addEventListener('pointerup', handlePointerUp)
        hostElement?.addEventListener('mouseup', handleMouseUp)
        hostElement?.addEventListener('keydown', handleKeySelection)
        hostElement?.addEventListener('keyup', handleKeySelection)
        window.addEventListener('keydown', handleKeySelection, true)
        window.addEventListener('keyup', handleKeySelection, true)
        hoverTimerRef.current = window.setTimeout(() => {
          if (!hostRef.current) {
            return
          }
          const nodes = hostRef.current.querySelectorAll('[data-row],[data-row-index]')
          if (!nodes.length) {
            onHoverCellChangeRef.current?.(-1, null)
          }
        }, 600)
        ;(hostElement as any).__univerHoverCleanup = () => {
          hostElement?.removeEventListener('pointermove', handlePointerMove as EventListener)
          hostElement?.removeEventListener('pointerleave', handlePointerLeave as EventListener)
          hostElement?.removeEventListener('pointerdown', handlePointerDown as EventListener)
          hostElement?.removeEventListener('pointerup', handlePointerUp as EventListener)
          hostElement?.removeEventListener('mouseup', handleMouseUp as EventListener)
          hostElement?.removeEventListener('keydown', handleKeySelection as EventListener)
          hostElement?.removeEventListener('keyup', handleKeySelection as EventListener)
          window.removeEventListener('keydown', handleKeySelection as EventListener, true)
          window.removeEventListener('keyup', handleKeySelection as EventListener, true)
        }
        univerRef.current = univer
        apiRef.current = api
        setUniverReady(true)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Univer 表格初始化失败'
        onErrorRef.current?.(`[univer-init-failed] ${message}`)
      }
    }
    void initialize()
    return () => {
      cancelled = true
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = 0
      }
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = 0
      }
      const hostElement = hostRef.current as (HTMLDivElement & { __univerHoverCleanup?: () => void }) | null
      hostElement?.__univerHoverCleanup?.()
      if (valueChangedListenerRef.current?.dispose) {
        valueChangedListenerRef.current.dispose()
      }
      if (selectionListenerRef.current?.dispose) {
        selectionListenerRef.current.dispose()
      }
      valueChangedListenerRef.current = null
      selectionListenerRef.current = null
      if (univerRef.current?.dispose) {
        univerRef.current.dispose()
      }
      univerRef.current = null
      apiRef.current = null
      setUniverReady(false)
      if (hostRef.current) {
        hostRef.current.innerHTML = ''
      }
    }
  }, [editorSessionKey, disabled])

  useEffect(() => {
    const api = apiRef.current
    if (!api || !activeCell) {
      return
    }
    const row = Number(activeCell.row)
    const col = Number(activeCell.col)
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      return
    }
    if (lastSelectionRef.current?.row === row && lastSelectionRef.current?.col === col) {
      return
    }
    try {
      const workbook = api.getActiveWorkbook?.()
      const sheet = workbook?.getActiveSheet?.() as any
      const selectionRaw = sheet?.getSelections?.() || sheet?.getSelection?.() || []
      const selections = Array.isArray(selectionRaw) ? selectionRaw : [selectionRaw]
      const ranges = selections
        .map((selection: any) => normalizeSelectionRange(selection?.getRange?.() || selection?.range || selection))
        .filter((range): range is SelectionRange => Boolean(range))
      const hasMultiRange = ranges.some((range) => (
        range.startRow !== range.endRow || range.startCol !== range.endCol
      ))
      if (hasMultiRange) {
        return
      }
    } catch {}
    suppressSelectionEmitRef.current = true
    try {
      const workbook = api.getActiveWorkbook?.()
      const sheet = workbook?.getActiveSheet?.()
      const range = sheet?.getRange?.(row, col, 1, 1)
      range?.activate?.()
      range?.focus?.()
      lastSelectionRef.current = { row, col, rangeKey: `${row}:${row}:${col}:${col}` }
    } finally {
      window.setTimeout(() => {
        suppressSelectionEmitRef.current = false
      }, 0)
    }
  }, [activeCell?.row, activeCell?.col])

  const downloadWorkbookAsExcel = async () => {
    const api = apiRef.current
    if (!api) {
      onErrorRef.current?.('Univer 尚未初始化，无法导出')
      return
    }
    setExporting(true)
    try {
      const workbook = api.getActiveWorkbook?.()
      const sheets = Array.isArray(workbook?.getSheets?.()) ? workbook.getSheets() : []
      if (!sheets.length) {
        throw new Error('当前工作簿为空，无法导出')
      }
      const xlsxWorkbook = XLSX.utils.book_new()
      for (const sheet of sheets) {
        const dataRange = sheet?.getDataRange?.()
        const values = (dataRange?.getValues?.() || []) as unknown[][]
        const formulaMatrix = (dataRange?.getFormulas?.() || []) as unknown[][]
        const rowCount = Math.max(values.length, 1)
        const colCount = Math.max(
          values.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0),
          1,
        )
        const aoa = Array.from({ length: rowCount }, (_, rowIndex) => (
          Array.from({ length: colCount }, (_, colIndex) => {
            const row = Array.isArray(values[rowIndex]) ? values[rowIndex] : []
            return row[colIndex] ?? null
          })
        ))
        const ws = XLSX.utils.aoa_to_sheet(aoa)
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
          for (let colIndex = 0; colIndex < colCount; colIndex++) {
            const formulaRow = Array.isArray(formulaMatrix[rowIndex]) ? formulaMatrix[rowIndex] : []
            const rawFormula = formulaRow[colIndex]
            const formula = typeof rawFormula === 'string' ? rawFormula.trim() : ''
            if (!formula) {
              continue
            }
            const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
            const cell = ws[address] || { t: 'n', v: 0 }
            const normalizedFormula = formula.startsWith('=') ? formula.slice(1) : formula
            ws[address] = { ...cell, f: normalizedFormula }
          }
        }
        const mergedRanges = Array.isArray(sheet?.getMergedRanges?.()) ? sheet.getMergedRanges() : []
        if (mergedRanges.length > 0) {
          ws['!merges'] = mergedRanges.map((range: any) => {
            const startRow = Number(range?.getRow?.() ?? 0)
            const startCol = Number(range?.getColumn?.() ?? 0)
            const rowSpan = Math.max(1, Number(range?.getHeight?.() ?? 1))
            const colSpan = Math.max(1, Number(range?.getWidth?.() ?? 1))
            return {
              s: { r: startRow, c: startCol },
              e: { r: startRow + rowSpan - 1, c: startCol + colSpan - 1 },
            }
          })
        }
        const sheetName = String(sheet?.getName?.() || `Sheet${xlsxWorkbook.SheetNames.length + 1}`)
        XLSX.utils.book_append_sheet(xlsxWorkbook, ws, sheetName.slice(0, 31))
      }
      const out = XLSX.write(xlsxWorkbook, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safePrefix = String(exportFileNamePrefix || 'univer-export').trim() || 'univer-export'
      link.href = href
      link.download = `${safePrefix}-${Date.now()}.xlsx`
      link.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出 Excel 失败'
      onErrorRef.current?.(message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="univer-table-editor-wrapper rounded border border-gray-200 bg-white">
      {!hideExportButton ? (
        <div className="flex justify-end border-b border-gray-100 px-3 py-2">
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={exporting || !univerReady}
            onClick={() => void downloadWorkbookAsExcel()}
          >
            {exporting ? '导出中...' : '导出 Excel'}
          </button>
        </div>
      ) : null}
      <div ref={hostRef} tabIndex={0} className="h-[620px] w-full overflow-hidden" />
    </div>
  )
}
