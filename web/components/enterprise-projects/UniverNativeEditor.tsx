'use client'

import { useEffect, useMemo, useRef } from 'react'

type UniverNativeEditorProps = {
  editorSessionKey: string
  valueHtml: string
  disabled?: boolean
  onChange: (nextHtml: string) => void
  onError?: (message: string) => void
}

type UniverRuntime = {
  univer: any
  api: any
  valueListener?: { dispose?: () => void } | null
}

const EMPTY_HTML = '<div class="table-wrapper"><table><tbody><tr><td></td></tr></tbody></table></div>'

const normalizeHtml = (value: string) => String(value || '').trim()

const parseHtmlToMatrix = (valueHtml: string): string[][] => {
  const html = normalizeHtml(valueHtml)
  if (!html) {
    return [['']]
  }
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (!table) {
      return [['']]
    }
    const rows = Array.from(table.querySelectorAll('tr'))
    if (!rows.length) {
      return [['']]
    }
    const matrix = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('th,td'))
      return cells.map(cell => String(cell.textContent || '').replaceAll('\u00A0', ' ').trim())
    })
    const width = Math.max(1, ...matrix.map(row => row.length))
    const normalized = matrix.map((row) => {
      if (row.length >= width) {
        return row.slice(0, width)
      }
      return [...row, ...Array.from({ length: width - row.length }, () => '')]
    })
    return normalized.length > 0 ? normalized : [['']]
  } catch {
    return [['']]
  }
}

const matrixToHtml = (matrix: string[][]): string => {
  const safe = matrix.length > 0 ? matrix : [['']]
  const rowHtml = safe.map((row) => {
    const safeRow = row.length > 0 ? row : ['']
    const cellHtml = safeRow.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')
    return `<tr>${cellHtml}</tr>`
  }).join('')
  return `<div class="table-wrapper"><table><tbody>${rowHtml}</tbody></table></div>`
}

const escapeHtml = (value: string): string => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const trimMatrix = (matrix: string[][]): string[][] => {
  const data = matrix.map(row => row.map(cell => String(cell || '')))
  let maxRow = data.length - 1
  let maxCol = Math.max(0, ...data.map(row => row.length - 1))

  while (maxRow >= 0) {
    const row = data[maxRow] || []
    if (row.some(cell => String(cell || '').trim() !== '')) {
      break
    }
    maxRow -= 1
  }

  while (maxCol >= 0) {
    let hasValue = false
    for (let rowIndex = 0; rowIndex <= Math.max(maxRow, 0); rowIndex += 1) {
      if (String(data[rowIndex]?.[maxCol] || '').trim() !== '') {
        hasValue = true
        break
      }
    }
    if (hasValue) {
      break
    }
    maxCol -= 1
  }

  if (maxRow < 0 || maxCol < 0) {
    return [['']]
  }

  return data.slice(0, maxRow + 1).map(row => {
    const sliced = row.slice(0, maxCol + 1)
    return sliced.length > 0 ? sliced : ['']
  })
}

const setSheetValues = (api: any, matrix: string[][]) => {
  const workbook = api?.getActiveWorkbook?.()
  const sheet = workbook?.getActiveSheet?.()
  if (!sheet) {
    return
  }
  const normalized = matrix.length > 0 ? matrix : [['']]
  const rowCount = normalized.length
  const colCount = Math.max(1, ...normalized.map(row => row.length))
  const values = normalized.map(row => {
    if (row.length >= colCount) {
      return row
    }
    return [...row, ...Array.from({ length: colCount - row.length }, () => '')]
  })
  sheet.getRange?.(0, 0, rowCount, colCount)?.setValues?.(values)
}

const readSheetValues = (api: any): string[][] => {
  const workbook = api?.getActiveWorkbook?.()
  const sheet = workbook?.getActiveSheet?.()
  const dataRange = sheet?.getDataRange?.()
  const raw = (dataRange?.getValues?.() || []) as unknown[][]
  if (!raw.length) {
    return [['']]
  }
  return trimMatrix(raw.map(row => (Array.isArray(row) ? row.map(cell => String(cell ?? '')) : [''])))
}

export default function UniverNativeEditor({
  editorSessionKey,
  valueHtml,
  disabled = false,
  onChange,
  onError,
}: UniverNativeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<UniverRuntime | null>(null)
  const lastInputRef = useRef<string>('')
  const lastOutputRef = useRef<string>('')
  const syncGuardRef = useRef(false)

  const normalizedInput = useMemo(() => normalizeHtml(valueHtml || EMPTY_HTML), [valueHtml])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const host = hostRef.current
      if (!host) {
        return
      }
      try {
        const [
          core,
          facade,
          engineRender,
          engineFormula,
          ui,
          localeCore,
          localeUI,
          sheets,
          localeSheets,
          sheetsUi,
          localeSheetsUi,
        ] = await Promise.all([
          import('@univerjs/core'),
          import('@univerjs/core/facade'),
          import('@univerjs/engine-render'),
          import('@univerjs/engine-formula'),
          import('@univerjs/ui'),
          import('@univerjs/design/locale/zh-CN'),
          import('@univerjs/ui/locale/zh-CN'),
          import('@univerjs/sheets'),
          import('@univerjs/sheets/locale/zh-CN'),
          import('@univerjs/sheets-ui'),
          import('@univerjs/sheets-ui/locale/zh-CN'),
        ])

        if (cancelled) {
          return
        }

        const univer = new core.Univer({
          locale: core.LocaleType.ZH_CN,
          locales: {
            [core.LocaleType.ZH_CN]: {
              ...localeCore.default,
              ...localeUI.default,
              ...localeSheets.default,
              ...localeSheetsUi.default,
            },
          },
        })

        univer.registerPlugin(engineRender.UniverRenderEnginePlugin)
        univer.registerPlugin(engineFormula.UniverFormulaEnginePlugin)
        univer.registerPlugin(ui.UniverUIPlugin, { container: host })
        univer.registerPlugin(sheets.UniverSheetsPlugin)
        univer.registerPlugin(sheetsUi.UniverSheetsUIPlugin)
        univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, {})

        const api = facade.FUniver.newAPI(univer) as any
        runtimeRef.current = { univer, api }

        const applyEditable = () => {
          const workbook = api?.getActiveWorkbook?.()
          const sheet = workbook?.getActiveSheet?.()
          const editable = !disabled
          workbook?.setEditable?.(editable)
          sheet?.setEditable?.(editable)
        }

        const emitChange = () => {
          if (syncGuardRef.current) {
            return
          }
          const matrix = readSheetValues(api)
          const html = normalizeHtml(matrixToHtml(matrix))
          if (html === lastOutputRef.current) {
            return
          }
          lastOutputRef.current = html
          onChange(html)
        }

        const eventName = (api.Event as any)?.CellValueChanged || (api.Event as any)?.SheetEditEnded
        if (eventName) {
          runtimeRef.current.valueListener = api.addEvent(eventName, () => {
            emitChange()
          })
        }

        syncGuardRef.current = true
        const initialMatrix = parseHtmlToMatrix(normalizedInput)
        setSheetValues(api, initialMatrix)
        lastInputRef.current = normalizedInput
        lastOutputRef.current = normalizeHtml(matrixToHtml(initialMatrix))
        applyEditable()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Univer 初始化失败'
        onError?.(`[univer-native-init] ${detail}`)
      } finally {
        syncGuardRef.current = false
      }
    }

    void init()

    return () => {
      cancelled = true
      try {
        runtimeRef.current?.valueListener?.dispose?.()
      } catch {
      }
      try {
        runtimeRef.current?.univer?.dispose?.()
      } catch {
      }
      runtimeRef.current = null
    }
  }, [editorSessionKey])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return
    }
    const workbook = runtime.api?.getActiveWorkbook?.()
    const sheet = workbook?.getActiveSheet?.()
    const editable = !disabled
    workbook?.setEditable?.(editable)
    sheet?.setEditable?.(editable)
  }, [disabled])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime?.api) {
      return
    }
    if (normalizedInput === lastInputRef.current) {
      return
    }
    syncGuardRef.current = true
    try {
      const matrix = parseHtmlToMatrix(normalizedInput)
      setSheetValues(runtime.api, matrix)
      lastInputRef.current = normalizedInput
      lastOutputRef.current = normalizeHtml(matrixToHtml(matrix))
    } catch (error) {
      const detail = error instanceof Error ? error.message : '写入表格失败'
      onError?.(`[univer-native-sync] ${detail}`)
    } finally {
      syncGuardRef.current = false
    }
  }, [normalizedInput, onError])

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div ref={hostRef} className="h-[620px] w-full overflow-hidden" />
    </div>
  )
}
