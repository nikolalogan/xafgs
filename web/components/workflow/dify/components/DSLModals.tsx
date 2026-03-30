type DSLModalsProps = {
  importOpen: boolean
  exportOpen: boolean
  importText: string
  exportText: string
  onChangeImportText: (text: string) => void
  onCloseImport: () => void
  onImport: () => void
  onCloseExport: () => void
}

export default function DSLModals({
  importOpen,
  exportOpen,
  importText,
  exportText,
  onChangeImportText,
  onCloseImport,
  onImport,
  onCloseExport,
}: DSLModalsProps) {
  return (
    <>
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-2 text-sm font-semibold">导入 DSL</div>
            <textarea className="h-[60vh] w-full rounded border border-gray-300 p-2 text-xs" value={importText} onChange={event => onChangeImportText(event.target.value)} />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={onCloseImport} className="rounded border border-gray-300 px-3 py-1.5 text-xs">取消</button>
              <button onClick={onImport} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white">导入</button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-2 text-sm font-semibold">导出 DSL</div>
            <textarea className="h-[60vh] w-full rounded border border-gray-300 p-2 text-xs" value={exportText} readOnly />
            <div className="mt-3 flex justify-end">
              <button onClick={onCloseExport} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white">关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
