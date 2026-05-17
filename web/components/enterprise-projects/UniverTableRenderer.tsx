'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TableAoa } from '@/lib/table-template-aoa'

type UniverTableRendererProps = {
  templateAoa: TableAoa
}

const moduleLoader = async () => {
  const [
    core,
    engineRender,
    ui,
    docs,
    docsUi,
    sheets,
    sheetsUi,
    formula,
    formulaEngine,
    formulaUi,
    zhCnUi,
    zhCnSheets,
    zhCnSheetsUi,
    zhCnFormula,
    zhCnDocsUi,
  ] = await Promise.all([
    import('@univerjs/core'),
    import('@univerjs/engine-render'),
    import('@univerjs/ui'),
    import('@univerjs/docs'),
    import('@univerjs/docs-ui'),
    import('@univerjs/sheets'),
    import('@univerjs/sheets-ui'),
    import('@univerjs/sheets-formula'),
    import('@univerjs/engine-formula'),
    import('@univerjs/sheets-formula-ui'),
    import('@univerjs/ui/locale/zh-CN'),
    import('@univerjs/sheets/locale/zh-CN'),
    import('@univerjs/sheets-ui/locale/zh-CN'),
    import('@univerjs/sheets-formula/locale/zh-CN'),
    import('@univerjs/docs-ui/locale/zh-CN'),
  ])
  return {
    Univer: core.Univer,
    LocaleType: core.LocaleType,
    UniverInstanceType: core.UniverInstanceType,
    merge: core.merge,
    UniverRenderEnginePlugin: engineRender.UniverRenderEnginePlugin,
    UniverUIPlugin: ui.UniverUIPlugin,
    UniverDocsPlugin: docs.UniverDocsPlugin,
    UniverDocsUIPlugin: docsUi.UniverDocsUIPlugin,
    UniverSheetsPlugin: sheets.UniverSheetsPlugin,
    UniverSheetsUIPlugin: sheetsUi.UniverSheetsUIPlugin,
    UniverSheetsFormulaPlugin: formula.UniverSheetsFormulaPlugin,
    UniverFormulaEnginePlugin: formulaEngine.UniverFormulaEnginePlugin,
    UniverSheetsFormulaUIPlugin: formulaUi.UniverSheetsFormulaUIPlugin,
    zhCnUi: zhCnUi.default,
    zhCnSheets: zhCnSheets.default,
    zhCnSheetsUi: zhCnSheetsUi.default,
    zhCnFormula: zhCnFormula.default,
    zhCnDocsUi: zhCnDocsUi.default,
  }
}

export default function UniverTableRenderer({ templateAoa }: UniverTableRendererProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const univerRef = useRef<{ dispose: () => void } | null>(null)
  const [error, setError] = useState('')

  const cellData = useMemo(() => {
    return Object.fromEntries(templateAoa.map((row, rowIndex) => {
      const rowData = row.reduce<Record<string, { v?: string | number, f?: string }>>((acc, cell, colIndex) => {
        if (cell === null)
          return acc
        const value = typeof cell === 'number' ? cell : String(cell)
        if (typeof value === 'string' && value.startsWith('='))
          acc[String(colIndex)] = { f: value.slice(1) }
        else
          acc[String(colIndex)] = { v: value }
        return acc
      }, {})
      return [String(rowIndex), rowData] as const
    }))
  }, [templateAoa])

  useEffect(() => {
    let disposed = false
    const mount = async () => {
      if (!hostRef.current)
        return
      if (univerRef.current) {
        univerRef.current.dispose()
        univerRef.current = null
      }
      try {
        setError('')
        const Univer = await moduleLoader()
        if (disposed || !hostRef.current)
          return
        const univer = new Univer.Univer({
          locale: Univer.LocaleType.ZH_CN,
          locales: {
            [Univer.LocaleType.ZH_CN]: Univer.merge(
              {},
              Univer.zhCnUi,
              Univer.zhCnSheets,
              Univer.zhCnSheetsUi,
              Univer.zhCnFormula,
              Univer.zhCnDocsUi,
            ),
          },
        })
        univer.registerPlugin(Univer.UniverRenderEnginePlugin)
        univer.registerPlugin(Univer.UniverUIPlugin, {
          container: hostRef.current,
        })
        univer.registerPlugin(Univer.UniverDocsPlugin)
        univer.registerPlugin(Univer.UniverDocsUIPlugin)
        univer.registerPlugin(Univer.UniverSheetsPlugin)
        univer.registerPlugin(Univer.UniverSheetsUIPlugin)
        univer.registerPlugin(Univer.UniverFormulaEnginePlugin)
        univer.registerPlugin(Univer.UniverSheetsFormulaPlugin)
        univer.registerPlugin(Univer.UniverSheetsFormulaUIPlugin)
        univer.createUnit(Univer.UniverInstanceType.UNIVER_SHEET, {
          id: 'sheet-render',
          name: 'Sheet1',
          sheetOrder: ['sheet-1'],
          appVersion: '1.0.0',
          locale: Univer.LocaleType.ZH_CN,
          styles: {},
          sheets: {
            'sheet-1': {
              id: 'sheet-1',
              name: 'Sheet1',
              cellData,
              rowCount: Math.max(templateAoa.length, 20),
              columnCount: Math.max(Math.max(...templateAoa.map(row => row.length), 0), 10),
              zoomRatio: 1,
            },
          },
        })
        univerRef.current = univer
      }
      catch (mountError) {
        setError(mountError instanceof Error ? mountError.message : 'Univer 初始化失败')
      }
    }
    mount()
    return () => {
      disposed = true
      if (univerRef.current) {
        univerRef.current.dispose()
        univerRef.current = null
      }
    }
  }, [cellData, templateAoa])

  if (error) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        Univer 初始化失败：{error}
      </div>
    )
  }

  return <div ref={hostRef} className="h-[560px] w-full overflow-hidden rounded-md border border-gray-200 bg-white" />
}
