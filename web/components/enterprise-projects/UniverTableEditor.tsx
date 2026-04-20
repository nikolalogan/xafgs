'use client'

import { useEffect, useRef } from 'react'

type UniverTableEditorProps = {
  valueHtml: string
  disabled?: boolean
  onChange: (nextHtml: string) => void
  onError?: (message: string) => void
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

export default function UniverTableEditor({ valueHtml, disabled = false, onChange, onError }: UniverTableEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const univerRef = useRef<any>(null)
  const apiRef = useRef<any>(null)
  const listenerRef = useRef<any>(null)
  const debounceRef = useRef<number>(0)
  const lastEmittedHTMLRef = useRef('')
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        const host = hostRef.current
        if (!host) {
          return
        }
        host.innerHTML = ''
        const parsedWorkbook = parseHtmlTablesToWorkbook(valueHtml)
        if (parsedWorkbook.diagnostics.fallbackUsed) {
          onErrorRef.current?.(`[${parsedWorkbook.diagnostics.reasonCode}] ${parsedWorkbook.diagnostics.reason}`)
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
          sheet.getRange(0, 0, rowCount, colCount).setValues(parsed.values)
          for (const merge of parsed.merges) {
            sheet.getRange(merge.row, merge.col, merge.rowSpan, merge.colSpan).merge()
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
          listenerRef.current = api.addEvent(
            api.Event.SheetValueChanged,
            scheduleEmit,
          )
        }
        univerRef.current = univer
        apiRef.current = api
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Univer 表格初始化失败'
        onErrorRef.current?.(message)
      }
    }
    void initialize()
    return () => {
      cancelled = true
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = 0
      }
      if (listenerRef.current?.dispose) {
        listenerRef.current.dispose()
      }
      listenerRef.current = null
      if (univerRef.current?.dispose) {
        univerRef.current.dispose()
      }
      univerRef.current = null
      apiRef.current = null
      if (hostRef.current) {
        hostRef.current.innerHTML = ''
      }
    }
  }, [valueHtml, disabled])

  return (
    <div className="univer-table-editor-wrapper rounded border border-gray-200 bg-white">
      <div ref={hostRef} className="h-[620px] w-full overflow-hidden" />
    </div>
  )
}
