'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

type UniverTableEditorProps = {
  workbook: Record<string, unknown>
}

export type UniverTableEditorRef = {
  getWorkbookSnapshot: () => Record<string, unknown> | null
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
    coreFacade,
    sheetsFacade,
    sheetsUiFacade,
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
    import('@univerjs/core/facade'),
    import('@univerjs/sheets/facade'),
    import('@univerjs/sheets-ui/facade'),
    import('@univerjs/ui/locale/zh-CN'),
    import('@univerjs/sheets/locale/zh-CN'),
    import('@univerjs/sheets-ui/locale/zh-CN'),
    import('@univerjs/sheets-formula/locale/zh-CN'),
    import('@univerjs/docs-ui/locale/zh-CN'),
  ])
  void sheetsFacade
  void sheetsUiFacade
  return {
    Univer: core.Univer,
    IPermissionService: core.IPermissionService,
    LocaleType: core.LocaleType,
    UniverInstanceType: core.UniverInstanceType,
    FUniver: coreFacade.FUniver,
    merge: core.merge,
    UniverRenderEnginePlugin: engineRender.UniverRenderEnginePlugin,
    UniverUIPlugin: ui.UniverUIPlugin,
    UniverDocsPlugin: docs.UniverDocsPlugin,
    UniverDocsUIPlugin: docsUi.UniverDocsUIPlugin,
    UniverSheetsPlugin: sheets.UniverSheetsPlugin,
    UniverSheetsUIPlugin: sheetsUi.UniverSheetsUIPlugin,
    UniverSheetsFormulaPlugin: formula.UniverSheetsFormulaPlugin,
    UniverFormulaEnginePlugin: formulaEngine.UniverFormulaEnginePlugin,
    getAllWorkbookPermissionPoint: sheets.getAllWorkbookPermissionPoint,
    getAllWorksheetPermissionPoint: sheets.getAllWorksheetPermissionPoint,
    getAllWorksheetPermissionPointByPointPanel: sheets.getAllWorksheetPermissionPointByPointPanel,
    zhCnUi: zhCnUi.default,
    zhCnSheets: zhCnSheets.default,
    zhCnSheetsUi: zhCnSheetsUi.default,
    zhCnFormula: zhCnFormula.default,
    zhCnDocsUi: zhCnDocsUi.default,
  }
}

const UniverTableEditor = forwardRef<UniverTableEditorRef, UniverTableEditorProps>(({ workbook }, ref) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState('')
  const runtimeRef = useRef<{
    dispose: () => void
    getSnapshot?: () => Record<string, unknown> | null
  } | null>(null)

  useImperativeHandle(ref, () => ({
    getWorkbookSnapshot: () => runtimeRef.current?.getSnapshot?.() || null,
  }), [])

  useEffect(() => {
    let disposed = false
    const mount = async () => {
      if (!hostRef.current)
        return
      if (runtimeRef.current) {
        runtimeRef.current.dispose()
        runtimeRef.current = null
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
        const workbookUnit = univer.createUnit(Univer.UniverInstanceType.UNIVER_SHEET, workbook)
        const univerAPI = Univer.FUniver.newAPI(univer)
        const permissionService = univer.__getInjector().get(Univer.IPermissionService)
        const facadeWorkbook = (
          (univerAPI as {
            getWorkbook?: (unitId: string) => { save?: () => Record<string, unknown>, setEditable?: (editable: boolean) => unknown } | null
            getActiveWorkbook?: () => { save?: () => Record<string, unknown>, setEditable?: (editable: boolean) => unknown } | null
          }).getWorkbook?.(workbookUnit.getUnitId())
          || (univerAPI as {
            getActiveWorkbook?: () => { save?: () => Record<string, unknown>, setEditable?: (editable: boolean) => unknown } | null
          }).getActiveWorkbook?.()
        )

        // Explicitly enable both workbook and worksheet permission points.
        const ensurePermissionEnabled = (permissionPoint: unknown) => {
          const point = permissionPoint as { id: string }
          if (!permissionService.getPermissionPoint(point.id))
            permissionService.addPermissionPoint(permissionPoint as never)
          permissionService.updatePermissionPoint(point.id, true)
        }
        Univer.getAllWorkbookPermissionPoint().forEach((PermissionPointCtor: new (unitId: string) => { id: string }) => {
          ensurePermissionEnabled(new PermissionPointCtor(workbookUnit.getUnitId()))
        })
        const workbookWithSheets = workbookUnit as { getSheets?: () => Array<{ getSheetId: () => string }> }
        workbookWithSheets.getSheets?.().forEach((sheet) => {
          const subUnitId = sheet.getSheetId()
          Univer.getAllWorksheetPermissionPoint().forEach((PermissionPointCtor: new (unitId: string, subUnitId: string) => { id: string }) => {
            ensurePermissionEnabled(new PermissionPointCtor(workbookUnit.getUnitId(), subUnitId))
          })
          Univer.getAllWorksheetPermissionPointByPointPanel().forEach((PermissionPointCtor: new (unitId: string, subUnitId: string) => { id: string }) => {
            ensurePermissionEnabled(new PermissionPointCtor(workbookUnit.getUnitId(), subUnitId))
          })
        })
        facadeWorkbook?.setEditable?.(true)
        runtimeRef.current = {
          dispose: () => univer.dispose(),
          getSnapshot: () => {
            const snapshotFromFacade = facadeWorkbook?.save?.()
            if (snapshotFromFacade)
              return snapshotFromFacade
            const snapshotFromWorkbook = (workbookUnit as { getSnapshot?: () => Record<string, unknown> }).getSnapshot?.()
            if (snapshotFromWorkbook)
              return snapshotFromWorkbook
            return null
          },
        }
      }
      catch (mountError) {
        setError(mountError instanceof Error ? mountError.message : 'Univer 初始化失败')
      }
    }
    mount()
    return () => {
      disposed = true
      if (runtimeRef.current) {
        runtimeRef.current.dispose()
        runtimeRef.current = null
      }
    }
  }, [workbook])

  if (error) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
        Univer 初始化失败：{error}
      </div>
    )
  }

  return <div ref={hostRef} className="h-[560px] w-full overflow-hidden rounded-md border border-gray-200 bg-white" />
})

UniverTableEditor.displayName = 'UniverTableEditor'

export default UniverTableEditor
