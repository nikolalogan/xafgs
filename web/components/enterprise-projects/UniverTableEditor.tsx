'use client'

import { useEffect, useRef, useState } from 'react'
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
type DebugEvent = {
  at: string
  summary: string
}

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

const applyGridToWorkbook = (workbook: any, grid: Grid) => {
  const worksheet = workbook?.getActiveSheet?.()
  if (!worksheet) {
    throw new Error('未找到活动工作表')
  }
  worksheet.clear({ contentsOnly: true })
  const rows = Math.max(1, grid.length)
  const cols = Math.max(1, grid[0]?.length || 1)
  const normalizedValues = Array.from({ length: rows }, (_, rowIdx) =>
    Array.from({ length: cols }, (_, colIdx) => grid[rowIdx]?.[colIdx] ?? ''),
  )
  worksheet.getRange(0, 0, rows, cols).setValues(normalizedValues)
}

const forceWorkbookRender = (workbook: any) => {
  requestAnimationFrame(() => {
    try {
      const worksheet = workbook?.getActiveSheet?.()
      if (!worksheet) {
        return
      }
      const range = worksheet.getRange(0, 0, 1, 1)
      const values = typeof range?.getValues === 'function' ? range.getValues() : [['']]
      range.setValues(values)
    } catch {}
  })
  window.setTimeout(() => {
    try {
      const worksheet = workbook?.getActiveSheet?.()
      if (!worksheet) {
        return
      }
      const range = worksheet.getRange(0, 0, 1, 1)
      const values = typeof range?.getValues === 'function' ? range.getValues() : [['']]
      range.setValues(values)
    } catch {}
  }, 80)
}

export default function UniverTableEditor({
  editorSessionKey,
  valueHtml,
  disabled = false,
  onChange,
  onError,
}: UniverTableEditorProps) {
  const [initError, setInitError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isRenderRetrying, setIsRenderRetrying] = useState(false)
  const [rebuildNonce, setRebuildNonce] = useState(0)
  const [renderProbeFailed, setRenderProbeFailed] = useState(false)
  const [debugState, setDebugState] = useState<Record<'init-attempt' | 'init-success' | 'sync-applied' | 'sync-fallback', DebugEvent | null>>({
    'init-attempt': null,
    'init-success': null,
    'sync-applied': null,
    'sync-fallback': null,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const univerRef = useRef<Univer | null>(null)
  const univerApiRef = useRef<any>(null)
  const workbookRef = useRef<any>(null)
  const disposableRef = useRef<{ dispose?: () => void } | null>(null)
  const isMountedRef = useRef(false)
  const isApplyingExternalRef = useRef(false)
  const lastEmittedRef = useRef('')
  const lastSyncedExternalHtmlRef = useRef('')
  const pendingInitialHtmlRef = useRef<string | null>(null)
  const rebuildCountRef = useRef(0)
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
    let canceled = false
    let rafId = 0
    let probeTimer = 0
    setIsInitializing(true)
    setInitError(null)
    setIsRenderRetrying(false)
    setRenderProbeFailed(false)

    const pushDebug = (name: 'init-attempt' | 'init-success' | 'sync-applied' | 'sync-fallback', summary: string) => {
      const nextEvent: DebugEvent = { at: new Date().toLocaleTimeString(), summary }
      setDebugState(previous => ({ ...previous, [name]: nextEvent }))
    }

    const init = (attempt: number) => {
      if (canceled) {
        return
      }
      pushDebug('init-attempt', `attempt=${attempt}`)
      const container = containerRef.current
      if (!container || !container.isConnected || container.clientHeight <= 0 || container.clientWidth <= 0) {
        setIsRenderRetrying(true)
        rafId = window.requestAnimationFrame(() => init(attempt + 1))
        return
      }
      pushDebug('init-attempt', `attempt=${attempt}, size=${container.clientWidth}x${container.clientHeight}`)
      setIsRenderRetrying(false)
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
        const initialHtml = pendingInitialHtmlRef.current ?? valueHtml
        pendingInitialHtmlRef.current = null
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

        forceWorkbookRender(workbook)

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
        setIsInitializing(false)
        setInitError(null)
        pushDebug('init-success', `attempt=${attempt}, size=${container.clientWidth}x${container.clientHeight}`)
        probeTimer = window.setTimeout(() => {
          if (canceled) {
            return
          }
          const host = containerRef.current
          const workbookNow = workbookRef.current
          const hasDomChildren = Boolean(host && host.querySelector('*'))
          if (hasDomChildren && workbookNow) {
            forceWorkbookRender(workbookNow)
            return
          }
          setRenderProbeFailed(true)
          if (rebuildCountRef.current < 2) {
            rebuildCountRef.current += 1
            pendingInitialHtmlRef.current = lastSyncedExternalHtmlRef.current || valueHtml
            setDebugState(previous => ({
              ...previous,
              'sync-fallback': { at: new Date().toLocaleTimeString(), summary: `render-probe-failed, rebuild=${rebuildCountRef.current}` },
            }))
            setRebuildNonce(previous => previous + 1)
          }
        }, 240)
      } catch (error) {
        const message = error instanceof Error ? error.message : '初始化 Univer 失败'
        setInitError(message)
        setIsInitializing(false)
        onErrorRef.current?.(message)
      }
    }

    init(1)
    return () => {
      canceled = true
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      if (probeTimer) {
        window.clearTimeout(probeTimer)
      }
      safeDispose()
    }
  }, [editorSessionKey, rebuildNonce, valueHtml, disabled])

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
      applyGridToWorkbook(workbook, grid)
      forceWorkbookRender(workbook)
      lastSyncedExternalHtmlRef.current = valueHtml
      setInitError(null)
      const snapshot = workbook.getSnapshot()
      const nextHtml = serializeGridToHtml(snapshotToGrid(snapshot))
      setDebugState(previous => ({
        ...previous,
        'sync-applied': { at: new Date().toLocaleTimeString(), summary: `len=${valueHtml.length}` },
      }))
      if (!/<td[\s>]/i.test(nextHtml)) {
        pendingInitialHtmlRef.current = valueHtml
        setDebugState(previous => ({
          ...previous,
          'sync-fallback': { at: new Date().toLocaleTimeString(), summary: 'snapshot-empty, rebuild-session' },
        }))
        setRebuildNonce(previous => previous + 1)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步外部内容失败'
      setInitError(message)
      onErrorRef.current?.(message)
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

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const first = entries[0]
      if (!first) {
        return
      }
      const width = Math.round(first.contentRect.width)
      const height = Math.round(first.contentRect.height)
      if (width <= 0 || height <= 0) {
        return
      }
      const workbook = workbookRef.current
      if (workbook) {
        forceWorkbookRender(workbook)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="rounded border border-gray-200 bg-white">
      {initError ? (
        <div
          className="flex h-[560px] items-center justify-center rounded border border-red-300 bg-red-50 px-6 text-sm text-red-700"
          role="alert"
        >
          <div className="max-w-[640px] text-center">
            <p className="font-medium">表格编辑器初始化失败</p>
            <p className="mt-2 break-all">{initError}</p>
          </div>
        </div>
      ) : (
        <div className="relative">
          {isInitializing ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex h-[560px] items-center justify-center bg-white/85 text-sm text-gray-500">
              正在加载表格编辑器...
            </div>
          ) : null}
          {!isInitializing && isRenderRetrying ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex h-[560px] items-center justify-center bg-white/75 text-sm text-gray-500">
              编辑器已初始化，正在重试渲染...
            </div>
          ) : null}
          {!isInitializing && renderProbeFailed ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex h-[560px] items-center justify-center bg-white/70 text-sm text-amber-700">
              编辑器未检测到可见网格，正在自动恢复...
            </div>
          ) : null}
          <div ref={containerRef} style={{ height: 560 }} />
          {process.env.NODE_ENV === 'development' ? (
            <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-500">
              <div>init-attempt: {debugState['init-attempt'] ? `${debugState['init-attempt'].at} ${debugState['init-attempt'].summary}` : '-'}</div>
              <div>init-success: {debugState['init-success'] ? `${debugState['init-success'].at} ${debugState['init-success'].summary}` : '-'}</div>
              <div>sync-applied: {debugState['sync-applied'] ? `${debugState['sync-applied'].at} ${debugState['sync-applied'].summary}` : '-'}</div>
              <div>sync-fallback: {debugState['sync-fallback'] ? `${debugState['sync-fallback'].at} ${debugState['sync-fallback'].summary}` : '-'}</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
